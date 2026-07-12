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
};

type AtelierConfiguration = Omit<AtelierOptions, "lix">;

// Symbol.for keeps an existing instance readable across development module reloads.
const CONFIGURATION = Symbol.for("@opral/atelier/configuration");

/** Creates one programmatically controllable Atelier runtime for a workspace. */
export function createAtelier(options: AtelierOptions): AtelierInstance {
	const instance: AtelierInstance = {
		lix: options.lix,
		diff: {
			open: (diffOptions) => openDiff(options.lix, diffOptions),
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
	return instance;
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
