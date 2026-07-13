import type { Lix } from "@lix-js/sdk";
import type {
	AtelierDocumentOpenOptions,
	AtelierDocumentsApi,
	AtelierEvent,
	AtelierExtensionRegistration,
} from "./extension-api";
import { appendAgentTurnCommitRange } from "./shell/agent-turn-review-range";

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

export type AtelierFileOpenOptions = {
	/** Workspace-relative path of an existing Lix file. */
	readonly path: string;
};

export type AtelierFileApi = {
	/** Opens an existing file in Atelier's central document view. */
	open(options: AtelierFileOpenOptions): Promise<void>;
};

export type {
	AtelierDocumentOpenOptions,
	AtelierDocumentsApi,
} from "./extension-api";

export type AtelierOptions = {
	readonly lix: Lix;
	readonly extensions?: readonly AtelierExtensionRegistration[];
	readonly filesViewMode?: "landing" | "sidebar";
	readonly defaultOpenPanels?: readonly AtelierSidePanel[];
	readonly onEvent?: (event: AtelierEvent) => void;
};

export type AtelierInstance = {
	/** The host-owned Lix backing this Atelier workspace. */
	readonly lix: Lix;
	readonly file: AtelierFileApi;
	readonly diff: AtelierDiffApi;
	readonly documents: AtelierDocumentsApi;
};

type AtelierConfiguration = Omit<AtelierOptions, "lix">;

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
	| { readonly kind: "close-active" };

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
	const openDocument = (
		path: string,
		openOptions?: AtelierDocumentOpenOptions,
	): Promise<void> => {
		if (typeof path !== "string" || path.trim().length === 0) {
			return Promise.reject(
				new TypeError("atelier.documents.open() requires a non-empty path."),
			);
		}
		return enqueueAtelierDocumentsCommand(documentsRuntime, {
			kind: "open",
			path,
			...(openOptions ? { options: openOptions } : {}),
		});
	};
	const instance: AtelierInstance = {
		lix: options.lix,
		file: {
			open: (fileOptions) => {
				if (
					!fileOptions ||
					typeof fileOptions !== "object" ||
					typeof fileOptions.path !== "string" ||
					fileOptions.path.trim().length === 0
				) {
					return Promise.reject(
						new TypeError("atelier.file.open() requires a non-empty path."),
					);
				}
				return openDocument(fileOptions.path);
			},
		},
		diff: {
			open: (diffOptions) => openDiff(options.lix, diffOptions),
		},
		documents: {
			open: openDocument,
			startNew: () =>
				enqueueAtelierDocumentsCommand(documentsRuntime, {
					kind: "start-new",
				}),
			closeActive: () =>
				enqueueAtelierDocumentsCommand(documentsRuntime, {
					kind: "close-active",
				}),
		},
	};
	const configuration: AtelierConfiguration = {
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
): Promise<void> {
	if (options.beforeCommitId === options.afterCommitId) return;

	const openedAt = Date.now();
	await appendAgentTurnCommitRange(lix, {
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
