import type { PanelSide, PanelState } from "../extension-runtime/types";
import { FILES_EXTENSION_KIND } from "../extension-runtime/extension-instance-helpers";

/**
 * Complete in-memory layout snapshot. Hosts split this into per-tab shell
 * state and private account layout preferences before persisting it.
 *
 * The structure mirrors the in-memory panel model so we can revive the exact
 * view arrangement (active views, props, focused panel, and optional
 * panel sizes) when the prototype boots.
 *
 * @example
 * const uiState: AtelierUiState = {
 *   focusedPanel: "left",
 *   panels: {
 *     left: { views: [...], activeInstance: "files-1" },
 *     central: { views: [], activeInstance: null },
 *     right: { views: [], activeInstance: null },
 *   },
 *   layout: { sizes: { left: 20, central: 60, right: 20 } },
 * };
 */
export type AtelierUiState = {
	readonly focusedPanel: PanelSide;
	readonly panels: Record<PanelSide, PanelState>;
	readonly layout?: {
		/**
		 * Last known splitter percentages per panel side (0–100 range).
		 */
		readonly sizes?: Partial<Record<PanelSide, number>>;
	};
};

export type AtelierSessionUiState = Pick<
	AtelierUiState,
	"focusedPanel" | "panels"
>;

export type AtelierUserPreferencesV1 = {
	readonly version: 1;
	readonly layout: {
		readonly sizes: PanelLayoutSizes;
	};
};

/**
 * Default UI state used when no session snapshot exists.
 */
export type PanelLayoutSizes = Record<PanelSide, number>;
export type DefaultOpenPanel = Exclude<PanelSide, "central">;

// A fresh workspace opens on the centered, full-width Files view. Side panels
// remain available from the top-bar toggles.
const DEFAULT_LAYOUT_SIZES: PanelLayoutSizes = {
	left: 0,
	central: 100,
	right: 0,
};

export const DEFAULT_ATELIER_UI_STATE: AtelierUiState = {
	focusedPanel: "central",
	panels: {
		left: { views: [], activeInstance: null },
		central: {
			views: [{ instance: "files-default", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-default",
		},
		right: { views: [], activeInstance: null },
	},
	layout: { sizes: { ...DEFAULT_LAYOUT_SIZES } },
};

export const DEFAULT_ATELIER_USER_PREFERENCES: AtelierUserPreferencesV1 = {
	version: 1,
	layout: { sizes: { ...DEFAULT_LAYOUT_SIZES } },
};

/** Creates the fresh-workspace state with requested side panels visible. */
export function createInitialAtelierUiState(
	defaultOpenPanels: readonly DefaultOpenPanel[] = [],
): AtelierUiState {
	const sizes = { ...DEFAULT_LAYOUT_SIZES };
	for (const side of defaultOpenPanels) {
		if (sizes[side] > 0) continue;
		const sideSize = 20;
		sizes[side] = sideSize;
		sizes.central = Math.max(30, sizes.central - sideSize);
	}
	return {
		...DEFAULT_ATELIER_UI_STATE,
		layout: { sizes },
	};
}

function isPanelSide(value: unknown): value is PanelSide {
	return value === "left" || value === "central" || value === "right";
}

function isViewInstance(value: unknown): value is PanelState["views"][number] {
	if (!value || typeof value !== "object") {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.instance === "string" &&
		typeof candidate.kind === "string" &&
		(candidate.isPending === undefined ||
			typeof candidate.isPending === "boolean")
	);
}

function coercePanelState(raw: unknown, fallback: PanelState): PanelState {
	if (!raw || typeof raw !== "object") {
		return fallback;
	}
	const candidate = raw as Record<string, unknown>;
	const views = Array.isArray(candidate.views)
		? candidate.views.filter(isViewInstance)
		: fallback.views;
	const activeInstance =
		typeof candidate.activeInstance === "string" ||
		candidate.activeInstance === null
			? candidate.activeInstance
			: fallback.activeInstance;
	return { views, activeInstance };
}

/**
 * Coerces persisted session payloads into a safe `AtelierUiState`.
 *
 * Falls back to defaults for stale/invalid shapes so app boot does not crash.
 */
export function coerceAtelierUiState(raw: unknown): AtelierUiState {
	if (!raw || typeof raw !== "object") {
		return DEFAULT_ATELIER_UI_STATE;
	}

	const candidate = raw as Record<string, unknown>;
	const panelsCandidate =
		candidate.panels && typeof candidate.panels === "object"
			? (candidate.panels as Record<string, unknown>)
			: {};
	const layoutCandidate =
		candidate.layout && typeof candidate.layout === "object"
			? (candidate.layout as Record<string, unknown>)
			: {};

	const focusedPanel = isPanelSide(candidate.focusedPanel)
		? candidate.focusedPanel
		: DEFAULT_ATELIER_UI_STATE.focusedPanel;

	return {
		focusedPanel,
		panels: {
			left: coercePanelState(
				panelsCandidate.left,
				DEFAULT_ATELIER_UI_STATE.panels.left,
			),
			central: coercePanelState(
				panelsCandidate.central,
				DEFAULT_ATELIER_UI_STATE.panels.central,
			),
			right: coercePanelState(
				panelsCandidate.right,
				DEFAULT_ATELIER_UI_STATE.panels.right,
			),
		},
		layout: {
			sizes: normalizeLayoutSizes(
				(layoutCandidate.sizes as
					| Partial<Record<PanelSide, number>>
					| undefined) ?? undefined,
			),
		},
	};
}

export function coerceAtelierSessionUiState(
	raw: unknown,
): AtelierSessionUiState {
	const coerced = coerceAtelierUiState(raw);
	return {
		focusedPanel: coerced.focusedPanel,
		panels: coerced.panels,
	};
}

export function coerceAtelierUserPreferences(
	raw: unknown,
): AtelierUserPreferencesV1 {
	if (!raw || typeof raw !== "object") {
		return DEFAULT_ATELIER_USER_PREFERENCES;
	}
	const candidate = raw as Record<string, unknown>;
	const layout =
		candidate.layout && typeof candidate.layout === "object"
			? (candidate.layout as Record<string, unknown>)
			: {};
	return {
		version: 1,
		layout: {
			sizes: normalizeLayoutSizes(
				(layout.sizes as Partial<Record<PanelSide, number>> | undefined) ??
					undefined,
			),
		},
	};
}

export function normalizeLayoutSizes(
	sizes?: Partial<Record<PanelSide, number>>,
): PanelLayoutSizes {
	return {
		left: sizes?.left ?? DEFAULT_LAYOUT_SIZES.left,
		central: sizes?.central ?? DEFAULT_LAYOUT_SIZES.central,
		right: sizes?.right ?? DEFAULT_LAYOUT_SIZES.right,
	};
}
