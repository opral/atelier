import type { Lix } from "@lix-js/sdk";
import type {
	AtelierDocumentOpenOptions,
	AtelierDocumentsApi,
	AtelierEvent,
	AtelierExtensionRegistration,
} from "./extension-api";
import { appendAgentTurnCommitRange } from "./shell/agent-turn-review-range";
import {
	createLixBranchSession,
	createMemoryPreferencesStore,
	createMemoryReviewStatusStore,
	createMemorySessionStateStore,
	type AtelierBranchSession,
	type AtelierPreferencesStore,
	type AtelierReviewStatusStore,
	type AtelierSessionStateStore,
} from "./state-adapters";

export type AtelierPanelSide = "left" | "central" | "right";
export type AtelierSidePanel = Exclude<AtelierPanelSide, "central">;

export type AtelierDiffSource = {
	/** Host-defined identifier such as "codex" or "claude". */
	readonly id: string;
	readonly sessionId?: string;
	readonly turnId?: string;
};

export type AtelierDiffOpenOptions = {
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly source: AtelierDiffSource;
};

export type AtelierDiffApi = {
	/** Creates a pending review and reveals its first changed document. */
	open(options: AtelierDiffOpenOptions): Promise<void>;
};

export type {
	AtelierDocumentOpenOptions,
	AtelierDocumentsApi,
} from "./extension-api";

export type AtelierOptions = {
	readonly lix: Lix;
	/**
	 * Presents workspace content without mutation affordances. Bundled editors
	 * remain visible and selectable while disabling writes.
	 */
	readonly readOnly?: boolean;
	readonly extensions?: readonly AtelierExtensionRegistration[];
	readonly filesViewMode?: "landing" | "sidebar";
	readonly defaultOpenPanels?: readonly AtelierSidePanel[];
	readonly onEvent?: (event: AtelierEvent) => void;
	/** Per-tab shell state. Hosts should normally back this with sessionStorage. */
	readonly sessionStateStore?: AtelierSessionStateStore;
	/** Private, account-scoped layout preferences. */
	readonly preferencesStore?: AtelierPreferencesStore;
	/** The active branch for this browsing context. */
	readonly branchSession?: AtelierBranchSession;
	/** Private, account-scoped review acknowledgement state. */
	readonly reviewStatusStore?: AtelierReviewStatusStore;
	/** Only expose review ranges tagged with this account or session id. */
	readonly reviewRangeSessionId?: string;
};

export type AtelierInstance = {
	/** The host-owned Lix backing this Atelier workspace. */
	readonly lix: Lix;
	readonly diff: AtelierDiffApi;
	readonly documents: AtelierDocumentsApi;
	readonly branches: {
		readonly activeId: () => string | null;
		readonly subscribe: (listener: () => void) => () => void;
		readonly create: (name: string) => Promise<string>;
		readonly switch: (branchId: string) => Promise<void>;
	};
};

export type AtelierConfiguration = Omit<AtelierOptions, "lix"> & {
	readonly sessionStateStore: AtelierSessionStateStore;
	readonly preferencesStore: AtelierPreferencesStore;
	readonly branchSession: AtelierBranchSession;
	readonly reviewStatusStore: AtelierReviewStatusStore;
};

// Symbol.for keeps an existing instance readable across development module reloads.
const CONFIGURATION = Symbol.for("@opral/atelier/configuration");
const DOCUMENTS_RUNTIME = Symbol.for("@opral/atelier/documents-runtime");

type AtelierDocumentsCommand =
	| {
			readonly kind: "open";
			readonly path: string;
			readonly options?: AtelierDocumentOpenOptions;
	  }
	| { readonly kind: "start-new" }
	| { readonly kind: "close-active" }
	| { readonly kind: "close-all" };

type QueuedAtelierDocumentsCommand = {
	readonly command: AtelierDocumentsCommand;
	readonly resolve: () => void;
	readonly reject: (error: unknown) => void;
};

/** @internal */
export type AtelierDocumentsRuntimeState = {
	readonly activePath: string | null;
	readonly openPaths: readonly string[];
};

/** @internal */
export type AtelierDocumentsRuntimeCompletion = {
	readonly isComplete: (state: AtelierDocumentsRuntimeState) => boolean;
};

type AtelierDocumentsRuntimeCommandResult =
	AtelierDocumentsRuntimeCompletion | void;

/** @internal */
export type AtelierDocumentsRuntimeBinding = {
	readonly open: (
		path: string,
		options?: AtelierDocumentOpenOptions,
	) =>
		| AtelierDocumentsRuntimeCommandResult
		| Promise<AtelierDocumentsRuntimeCommandResult>;
	readonly startNew: () =>
		| AtelierDocumentsRuntimeCommandResult
		| Promise<AtelierDocumentsRuntimeCommandResult>;
	readonly closeActive: () =>
		| AtelierDocumentsRuntimeCommandResult
		| Promise<AtelierDocumentsRuntimeCommandResult>;
	readonly closeAll: () =>
		| AtelierDocumentsRuntimeCommandResult
		| Promise<AtelierDocumentsRuntimeCommandResult>;
};

type AtelierDocumentsRuntime = {
	binding: AtelierDocumentsRuntimeBinding | null;
	readonly queue: QueuedAtelierDocumentsCommand[];
	draining: boolean;
	state: AtelierDocumentsRuntimeState;
	readonly listeners: Set<() => void>;
};

/** Creates one programmatically controllable Atelier runtime for a workspace. */
export function createAtelier(options: AtelierOptions): AtelierInstance {
	const documentsRuntime = createAtelierDocumentsRuntime();
	const branchSession =
		options.branchSession ?? createLixBranchSession(options.lix);
	const sessionStateStore =
		options.sessionStateStore ?? createMemorySessionStateStore();
	const preferencesStore = queuePreferenceSaves(
		options.preferencesStore ?? createMemoryPreferencesStore(),
	);
	const reviewStatusStore =
		options.reviewStatusStore ?? createMemoryReviewStatusStore();
	const instance: AtelierInstance = {
		lix: options.lix,
		diff: {
			open: async (diffOptions) => {
				if (diffOptions.beforeCommitId === diffOptions.afterCommitId) return;
				const scopedDiffOptions =
					options.reviewRangeSessionId !== undefined &&
					diffOptions.source.sessionId === undefined
						? {
								...diffOptions,
								source: {
									...diffOptions.source,
									sessionId: options.reviewRangeSessionId,
								},
							}
						: diffOptions;
				return openDiff(
					options.lix,
					scopedDiffOptions,
					await resolveBranchSessionId(branchSession),
				);
			},
		},
		documents: {
			open: (path, openOptions) => {
				if (typeof path !== "string" || path.trim().length === 0) {
					return Promise.reject(
						new TypeError(
							"atelier.documents.open() requires a non-empty path.",
						),
					);
				}
				return enqueueAtelierDocumentsCommand(documentsRuntime, {
					kind: "open",
					path,
					...(openOptions ? { options: openOptions } : {}),
				});
			},
			startNew: () =>
				enqueueAtelierDocumentsCommand(documentsRuntime, {
					kind: "start-new",
				}),
			closeActive: () =>
				enqueueAtelierDocumentsCommand(documentsRuntime, {
					kind: "close-active",
				}),
			closeAll: () =>
				enqueueAtelierDocumentsCommand(documentsRuntime, {
					kind: "close-all",
				}),
		},
		branches: {
			activeId: () => branchSession.getSnapshot(),
			subscribe: (listener) => branchSession.subscribe(listener),
			create: (name) => branchSession.createBranch(name),
			switch: (branchId) => branchSession.switchBranch(branchId),
		},
	};
	const configuration: AtelierConfiguration = {
		sessionStateStore,
		preferencesStore,
		branchSession,
		reviewStatusStore,
		...(options.readOnly !== undefined ? { readOnly: options.readOnly } : {}),
		...(options.extensions !== undefined
			? { extensions: [...options.extensions] }
			: {}),
		...(options.filesViewMode !== undefined
			? { filesViewMode: options.filesViewMode }
			: {}),
		...(options.defaultOpenPanels !== undefined
			? { defaultOpenPanels: [...options.defaultOpenPanels] }
			: {}),
		...(options.onEvent !== undefined ? { onEvent: options.onEvent } : {}),
		...(options.reviewRangeSessionId !== undefined
			? { reviewRangeSessionId: options.reviewRangeSessionId }
			: {}),
	};
	Object.defineProperty(instance, CONFIGURATION, {
		configurable: false,
		enumerable: false,
		value: configuration,
		writable: false,
	});
	Object.defineProperty(instance, DOCUMENTS_RUNTIME, {
		configurable: false,
		enumerable: false,
		value: documentsRuntime,
		writable: false,
	});
	return instance;
}

function queuePreferenceSaves(
	store: AtelierPreferencesStore,
): AtelierPreferencesStore {
	let pendingSave = Promise.resolve();
	return {
		load: () => store.load(),
		save: (value) => {
			const save = pendingSave
				.catch(() => undefined)
				.then(() => store.save(value));
			pendingSave = save;
			return save;
		},
	};
}

/** @internal Binds programmatic document commands to a mounted shell. */
export function bindAtelierDocumentsRuntime(
	instance: AtelierInstance,
	binding: AtelierDocumentsRuntimeBinding,
	initialState: AtelierDocumentsRuntimeState,
): () => void {
	const runtime = getAtelierDocumentsRuntime(instance);
	const previousBinding = runtime.binding;
	runtime.binding = binding;
	setAtelierDocumentsState(runtime, initialState);
	if (previousBinding && previousBinding !== binding) {
		notifyAtelierDocumentsRuntime(runtime);
	}
	void drainAtelierDocumentsCommands(runtime);
	return () => {
		if (runtime.binding !== binding) return;
		runtime.binding = null;
		notifyAtelierDocumentsRuntime(runtime);
	};
}

/** @internal Publishes mounted shell state for command acknowledgements. */
export function publishAtelierDocumentsState(
	instance: AtelierInstance,
	state: AtelierDocumentsRuntimeState,
): void {
	setAtelierDocumentsState(getAtelierDocumentsRuntime(instance), state);
}

/** @internal Used by the React view to render an Atelier instance. */
export function getAtelierConfiguration(
	instance: AtelierInstance,
): AtelierConfiguration {
	const configuration = (instance as unknown as Record<symbol, unknown>)[
		CONFIGURATION
	];
	if (!isAtelierConfiguration(configuration)) {
		throw new TypeError("Atelier requires an instance from createAtelier().");
	}
	return configuration;
}

function isAtelierConfiguration(value: unknown): value is AtelierConfiguration {
	return typeof value === "object" && value !== null;
}

function createAtelierDocumentsRuntime(): AtelierDocumentsRuntime {
	return {
		binding: null,
		queue: [],
		draining: false,
		state: freezeAtelierDocumentsState({
			activePath: null,
			openPaths: [],
		}),
		listeners: new Set(),
	};
}

function getAtelierDocumentsRuntime(
	instance: AtelierInstance,
): AtelierDocumentsRuntime {
	const runtime = (instance as unknown as Record<symbol, unknown>)[
		DOCUMENTS_RUNTIME
	];
	if (!isAtelierDocumentsRuntime(runtime)) {
		throw new TypeError("Atelier requires an instance from createAtelier().");
	}
	return runtime;
}

function isAtelierDocumentsRuntime(
	value: unknown,
): value is AtelierDocumentsRuntime {
	return (
		typeof value === "object" &&
		value !== null &&
		"queue" in value &&
		"listeners" in value
	);
}

function enqueueAtelierDocumentsCommand(
	runtime: AtelierDocumentsRuntime,
	command: AtelierDocumentsCommand,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		runtime.queue.push({ command, resolve, reject });
		void drainAtelierDocumentsCommands(runtime);
	});
}

async function drainAtelierDocumentsCommands(
	runtime: AtelierDocumentsRuntime,
): Promise<void> {
	if (runtime.draining) return;
	runtime.draining = true;
	try {
		while (runtime.binding && runtime.queue.length > 0) {
			const binding = runtime.binding;
			const queued = runtime.queue.shift();
			if (!queued) continue;
			try {
				const completion = await runAtelierDocumentsCommand(
					binding,
					queued.command,
				);
				if (completion) {
					await waitForAtelierDocumentsCompletion(runtime, binding, completion);
				}
				queued.resolve();
			} catch (error) {
				queued.reject(error);
			}
		}
	} finally {
		runtime.draining = false;
		if (runtime.binding && runtime.queue.length > 0) {
			void drainAtelierDocumentsCommands(runtime);
		}
	}
}

async function runAtelierDocumentsCommand(
	binding: AtelierDocumentsRuntimeBinding,
	command: AtelierDocumentsCommand,
): Promise<AtelierDocumentsRuntimeCommandResult> {
	switch (command.kind) {
		case "open":
			return command.options
				? binding.open(command.path, command.options)
				: binding.open(command.path);
		case "start-new":
			return binding.startNew();
		case "close-active":
			return binding.closeActive();
		case "close-all":
			return binding.closeAll();
	}
}

function waitForAtelierDocumentsCompletion(
	runtime: AtelierDocumentsRuntime,
	binding: AtelierDocumentsRuntimeBinding,
	completion: AtelierDocumentsRuntimeCompletion,
): Promise<void> {
	const checkCompletion = (): boolean => {
		if (runtime.binding !== binding) {
			throw new Error(
				"Atelier document command could not complete because the shell unmounted.",
			);
		}
		return completion.isComplete(runtime.state);
	};

	try {
		if (checkCompletion()) return Promise.resolve();
	} catch (error) {
		return Promise.reject(error);
	}

	return new Promise<void>((resolve, reject) => {
		const listener = () => {
			try {
				if (!checkCompletion()) return;
				runtime.listeners.delete(listener);
				resolve();
			} catch (error) {
				runtime.listeners.delete(listener);
				reject(error);
			}
		};
		runtime.listeners.add(listener);
		listener();
	});
}

function setAtelierDocumentsState(
	runtime: AtelierDocumentsRuntime,
	next: AtelierDocumentsRuntimeState,
): void {
	if (atelierDocumentsStatesEqual(runtime.state, next)) return;
	runtime.state = freezeAtelierDocumentsState(next);
	notifyAtelierDocumentsRuntime(runtime);
}

function notifyAtelierDocumentsRuntime(runtime: AtelierDocumentsRuntime): void {
	for (const listener of [...runtime.listeners]) listener();
}

function freezeAtelierDocumentsState(
	state: AtelierDocumentsRuntimeState,
): AtelierDocumentsRuntimeState {
	return Object.freeze({
		activePath: state.activePath,
		openPaths: Object.freeze([...new Set(state.openPaths)]),
	});
}

function atelierDocumentsStatesEqual(
	left: AtelierDocumentsRuntimeState,
	right: AtelierDocumentsRuntimeState,
): boolean {
	if (left.activePath !== right.activePath) return false;
	if (left.openPaths.length !== right.openPaths.length) return false;
	return left.openPaths.every((path, index) => path === right.openPaths[index]);
}

async function openDiff(
	lix: Lix,
	options: AtelierDiffOpenOptions,
	branchId: string,
): Promise<void> {
	if (options.beforeCommitId === options.afterCommitId) return;

	const openedAt = Date.now();
	await appendAgentTurnCommitRange(
		lix,
		{
			id: diffId(options),
			sourceId: options.source.id,
			beforeCommitId: options.beforeCommitId,
			afterCommitId: options.afterCommitId,
			...(options.source.sessionId !== undefined
				? { sessionId: options.source.sessionId }
				: {}),
			...(options.source.turnId !== undefined
				? { turnId: options.source.turnId }
				: {}),
			startedAt: openedAt,
			completedAt: openedAt,
		},
		{ branchId },
	);
}

function resolveBranchSessionId(
	branchSession: AtelierBranchSession,
): Promise<string> {
	const current = branchSession.getSnapshot();
	if (current) return Promise.resolve(current);
	return new Promise((resolve) => {
		const unsubscribe = branchSession.subscribe(() => {
			const branchId = branchSession.getSnapshot();
			if (!branchId) return;
			unsubscribe();
			resolve(branchId);
		});
	});
}

function diffId(options: AtelierDiffOpenOptions): string {
	return JSON.stringify([
		"atelier-diff",
		options.source.id,
		options.source.sessionId ?? null,
		options.source.turnId ?? null,
		options.beforeCommitId,
		options.afterCommitId,
	]);
}
