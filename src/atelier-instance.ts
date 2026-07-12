import type { Lix } from "@lix-js/sdk";
import type {
	AtelierEvent,
	AtelierExtensionRegistration,
} from "./extension-api";
import { appendAgentTurnCommitRange } from "./shell/agent-turn-review-range";

export type AtelierPanelSide = "left" | "central" | "right";
export type AtelierSidePanel = Exclude<AtelierPanelSide, "central">;

export type AtelierDiffSource = {
	readonly kind: "agent";
	readonly agent: "claude" | "codex";
	readonly sessionId?: string;
	readonly turnId?: string;
};

export type AtelierDiffOpenOptions = {
	readonly before: string;
	readonly after: string;
	readonly source: AtelierDiffSource;
};

export type AtelierDiffApi = {
	/** Creates a pending review and reveals its first changed document. */
	open(options: AtelierDiffOpenOptions): Promise<void>;
};

export type AtelierFilesSnapshot = {
	/** Whether the React shell is mounted and can execute file commands. */
	readonly ready: boolean;
	/** Full path of the active document, or null when no document is active. */
	readonly active: string | null;
	/** Full paths of all documents currently open in Atelier. */
	readonly open: readonly string[];
};

export type AtelierFilesApi = {
	/** Opens and focuses a document already present in the workspace Lix. */
	open(path: string): Promise<void>;
	/** Starts Atelier's contextual new Markdown document flow. */
	create(): Promise<void>;
	/** Closes the active document. Does nothing when no document is active. */
	closeActive(): Promise<void>;
	/** Returns the current immutable document state snapshot. */
	getSnapshot(): AtelierFilesSnapshot;
	/** Subscribes to document state changes. */
	subscribe(listener: () => void): () => void;
};

export type AtelierOptions = {
	readonly lix: Lix;
	readonly extensions?: readonly AtelierExtensionRegistration[];
	readonly filesExtension?: string;
	readonly filesViewMode?: "landing" | "sidebar";
	readonly defaultOpenPanels?: readonly AtelierSidePanel[];
	readonly onEvent?: (event: AtelierEvent) => void;
};

export type AtelierInstance = {
	/** The host-owned Lix backing this Atelier workspace. */
	readonly lix: Lix;
	readonly diff: AtelierDiffApi;
	readonly files: AtelierFilesApi;
};

type AtelierConfiguration = Omit<AtelierOptions, "lix">;

// Symbol.for keeps an existing instance readable across development module reloads.
const CONFIGURATION = Symbol.for("@opral/atelier/configuration");
const FILES_RUNTIME = Symbol.for("@opral/atelier/files-runtime");

type AtelierFilesCommand =
	| { readonly kind: "open"; readonly path: string }
	| { readonly kind: "create" }
	| { readonly kind: "close-active" };

type QueuedAtelierFilesCommand = {
	readonly command: AtelierFilesCommand;
	readonly resolve: () => void;
	readonly reject: (error: unknown) => void;
};

/** @internal */
export type AtelierFilesRuntimeBinding = {
	readonly open: (path: string) => void | Promise<void>;
	readonly create: () => void | Promise<void>;
	readonly closeActive: () => void | Promise<void>;
};

/** @internal */
export type AtelierFilesRuntimeSnapshot = Pick<
	AtelierFilesSnapshot,
	"active" | "open"
>;

type AtelierFilesRuntime = {
	binding: AtelierFilesRuntimeBinding | null;
	readonly queue: QueuedAtelierFilesCommand[];
	draining: boolean;
	snapshot: AtelierFilesSnapshot;
	readonly listeners: Set<() => void>;
};

/** Creates one programmatically controllable Atelier runtime for a workspace. */
export function createAtelier(options: AtelierOptions): AtelierInstance {
	const filesRuntime = createAtelierFilesRuntime();
	const instance: AtelierInstance = {
		lix: options.lix,
		diff: {
			open: (diffOptions) => openDiff(options.lix, diffOptions),
		},
		files: {
			open: (path) => {
				if (typeof path !== "string" || path.trim().length === 0) {
					return Promise.reject(
						new TypeError("atelier.files.open() requires a non-empty path."),
					);
				}
				return enqueueAtelierFilesCommand(filesRuntime, { kind: "open", path });
			},
			create: () =>
				enqueueAtelierFilesCommand(filesRuntime, { kind: "create" }),
			closeActive: () =>
				enqueueAtelierFilesCommand(filesRuntime, { kind: "close-active" }),
			getSnapshot: () => filesRuntime.snapshot,
			subscribe: (listener) => {
				filesRuntime.listeners.add(listener);
				return () => filesRuntime.listeners.delete(listener);
			},
		},
	};
	const configuration: AtelierConfiguration = {
		...(options.extensions !== undefined
			? { extensions: [...options.extensions] }
			: {}),
		...(options.filesExtension !== undefined
			? { filesExtension: options.filesExtension }
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
	Object.defineProperty(instance, FILES_RUNTIME, {
		configurable: false,
		enumerable: false,
		value: filesRuntime,
		writable: false,
	});
	return instance;
}

/** @internal Binds the programmatic file controller to a mounted shell. */
export function bindAtelierFilesRuntime(
	instance: AtelierInstance,
	binding: AtelierFilesRuntimeBinding,
	initialSnapshot: AtelierFilesRuntimeSnapshot,
): () => void {
	const runtime = getAtelierFilesRuntime(instance);
	runtime.binding = binding;
	setAtelierFilesSnapshot(runtime, {
		ready: true,
		active: initialSnapshot.active,
		open: initialSnapshot.open,
	});
	void drainAtelierFilesCommands(runtime);
	return () => {
		if (runtime.binding !== binding) return;
		runtime.binding = null;
		setAtelierFilesSnapshot(runtime, {
			...runtime.snapshot,
			ready: false,
		});
	};
}

/** @internal Publishes mounted shell document state to the host instance. */
export function publishAtelierFilesSnapshot(
	instance: AtelierInstance,
	snapshot: AtelierFilesRuntimeSnapshot,
): void {
	const runtime = getAtelierFilesRuntime(instance);
	setAtelierFilesSnapshot(runtime, {
		ready: runtime.binding !== null,
		active: snapshot.active,
		open: snapshot.open,
	});
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

function createAtelierFilesRuntime(): AtelierFilesRuntime {
	return {
		binding: null,
		queue: [],
		draining: false,
		snapshot: freezeAtelierFilesSnapshot({
			ready: false,
			active: null,
			open: [],
		}),
		listeners: new Set(),
	};
}

function getAtelierFilesRuntime(
	instance: AtelierInstance,
): AtelierFilesRuntime {
	const runtime = (instance as unknown as Record<symbol, unknown>)[
		FILES_RUNTIME
	];
	if (!isAtelierFilesRuntime(runtime)) {
		throw new TypeError("Atelier requires an instance from createAtelier().");
	}
	return runtime;
}

function isAtelierFilesRuntime(value: unknown): value is AtelierFilesRuntime {
	return (
		typeof value === "object" &&
		value !== null &&
		"queue" in value &&
		"listeners" in value
	);
}

function enqueueAtelierFilesCommand(
	runtime: AtelierFilesRuntime,
	command: AtelierFilesCommand,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		runtime.queue.push({ command, resolve, reject });
		void drainAtelierFilesCommands(runtime);
	});
}

async function drainAtelierFilesCommands(
	runtime: AtelierFilesRuntime,
): Promise<void> {
	if (runtime.draining) return;
	runtime.draining = true;
	try {
		while (runtime.binding && runtime.queue.length > 0) {
			const queued = runtime.queue.shift();
			if (!queued) continue;
			try {
				await runAtelierFilesCommand(runtime.binding, queued.command);
				queued.resolve();
			} catch (error) {
				queued.reject(error);
			}
		}
	} finally {
		runtime.draining = false;
		if (runtime.binding && runtime.queue.length > 0) {
			void drainAtelierFilesCommands(runtime);
		}
	}
}

async function runAtelierFilesCommand(
	binding: AtelierFilesRuntimeBinding,
	command: AtelierFilesCommand,
): Promise<void> {
	switch (command.kind) {
		case "open":
			await binding.open(command.path);
			return;
		case "create":
			await binding.create();
			return;
		case "close-active":
			await binding.closeActive();
	}
}

function setAtelierFilesSnapshot(
	runtime: AtelierFilesRuntime,
	next: AtelierFilesSnapshot,
): void {
	if (atelierFilesSnapshotsEqual(runtime.snapshot, next)) return;
	runtime.snapshot = freezeAtelierFilesSnapshot(next);
	for (const listener of [...runtime.listeners]) listener();
}

function freezeAtelierFilesSnapshot(
	snapshot: AtelierFilesSnapshot,
): AtelierFilesSnapshot {
	return Object.freeze({
		ready: snapshot.ready,
		active: snapshot.active,
		open: Object.freeze([...new Set(snapshot.open)]),
	});
}

function atelierFilesSnapshotsEqual(
	left: AtelierFilesSnapshot,
	right: AtelierFilesSnapshot,
): boolean {
	if (left.ready !== right.ready || left.active !== right.active) return false;
	if (left.open.length !== right.open.length) return false;
	return left.open.every((path, index) => path === right.open[index]);
}

async function openDiff(
	lix: Lix,
	options: AtelierDiffOpenOptions,
): Promise<void> {
	if (options.before === options.after) return;

	const openedAt = Date.now();
	await appendAgentTurnCommitRange(lix, {
		id: diffId(options),
		agent: options.source.agent,
		beforeCommitId: options.before,
		afterCommitId: options.after,
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
		options.source.kind,
		options.source.agent,
		options.source.sessionId ?? null,
		options.source.turnId ?? null,
		options.before,
		options.after,
	]);
}
