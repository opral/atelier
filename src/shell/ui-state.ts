import type { PanelSide, PanelState } from "../extension-runtime/types";
import type { AtelierJsonValue } from "../extension-api";
import {
	FILES_EXTENSION_KIND,
	HISTORY_EXTENSION_KIND,
} from "../extension-runtime/extension-instance-helpers";

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
 *     main: { views: [], activeInstance: null },
 *     right: { views: [], activeInstance: null },
 *   },
 *   layout: { sizes: { left: 20, main: 60, right: 20 } },
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
	/**
	 * Review behavior is private to the current client. Optional keeps v1
	 * preferences written by older Atelier builds forwards-compatible.
	 */
	readonly review?: {
		readonly autoAcceptAgentChanges: boolean;
	};
	/** JSON preferences, namespaced by extension id and then local key. */
	readonly extensions?: Readonly<
		Record<string, Readonly<Record<string, AtelierJsonValue>>>
	>;
};

/**
 * Default UI state used when no session snapshot exists.
 */
export type PanelLayoutSizes = Record<PanelSide, number>;
export type DefaultOpenPanel = Exclude<PanelSide, "main">;

// A fresh workspace opens on the centered, full-width Files view. Side panels
// remain available from the top-bar toggles.
const DEFAULT_LAYOUT_SIZES: PanelLayoutSizes = {
	left: 0,
	main: 100,
	right: 0,
};

// The right sidebar defaults to History: opening it should show the
// repository's timeline, not an empty placeholder asking for a view.
const DEFAULT_RIGHT_PANEL_STATE: PanelState = {
	views: [{ instance: "history-default", kind: HISTORY_EXTENSION_KIND }],
	activeInstance: "history-default",
};

/** Seeds the History default into a right panel persisted with no views. */
function withDefaultRightView(panel: PanelState): PanelState {
	return panel.views.length === 0 ? DEFAULT_RIGHT_PANEL_STATE : panel;
}

export const DEFAULT_ATELIER_UI_STATE: AtelierUiState = {
	focusedPanel: "main",
	panels: {
		left: {
			views: [{ instance: "files-default", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-default",
		},
		main: { views: [], activeInstance: null },
		right: DEFAULT_RIGHT_PANEL_STATE,
	},
	layout: { sizes: { ...DEFAULT_LAYOUT_SIZES } },
};

const DEFAULT_ATELIER_USER_PREFERENCES: AtelierUserPreferencesV1 = {
	version: 1,
	layout: { sizes: { ...DEFAULT_LAYOUT_SIZES } },
	review: { autoAcceptAgentChanges: false },
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
		sizes.main = Math.max(30, sizes.main - sideSize);
	}
	return {
		...DEFAULT_ATELIER_UI_STATE,
		layout: { sizes },
	};
}

/**
 * Workspaces stored before the middle area was named "main" carry a
 * "central" key. Read it once here, so a saved layout survives the rename
 * rather than silently reverting to the default.
 */
function withMainArea(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object") return {};
	const candidate = { ...(value as Record<string, unknown>) };
	if (candidate.main === undefined && candidate.central !== undefined)
		candidate.main = candidate.central;
	delete candidate.central;
	return candidate;
}

function isPanelSide(value: unknown): value is PanelSide {
	return value === "left" || value === "main" || value === "right";
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
			typeof candidate.isPending === "boolean") &&
		(candidate.isPinned === undefined ||
			typeof candidate.isPinned === "boolean")
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
	const panelsCandidate = withMainArea(candidate.panels);
	const layoutCandidate =
		candidate.layout && typeof candidate.layout === "object"
			? (candidate.layout as Record<string, unknown>)
			: {};
	if (layoutCandidate.sizes)
		layoutCandidate.sizes = withMainArea(layoutCandidate.sizes);

	const focused =
		candidate.focusedPanel === "central" ? "main" : candidate.focusedPanel;
	const focusedPanel = isPanelSide(focused)
		? focused
		: DEFAULT_ATELIER_UI_STATE.focusedPanel;

	// One instance id must appear in one panel: duplicates (from the old
	// per-load id counter) render as a single view, leaving the other panel's
	// host empty. First occurrence wins, panel order left → main → right.
	const seenInstances = new Set<string>();
	const dedupePanel = (panel: PanelState): PanelState => {
		const views = panel.views.filter((view) => {
			if (seenInstances.has(view.instance)) return false;
			seenInstances.add(view.instance);
			return true;
		});
		if (views.length === panel.views.length) return panel;
		return {
			views,
			activeInstance: views.some(
				(view) => view.instance === panel.activeInstance,
			)
				? panel.activeInstance
				: (views[0]?.instance ?? null),
		};
	};
	return {
		focusedPanel,
		panels: {
			left: dedupePanel(
				coercePanelState(
					panelsCandidate.left,
					DEFAULT_ATELIER_UI_STATE.panels.left,
				),
			),
			main: dedupePanel(
				coercePanelState(
					panelsCandidate.main,
					DEFAULT_ATELIER_UI_STATE.panels.main,
				),
			),
			right: withDefaultRightView(
				dedupePanel(
					coercePanelState(
						panelsCandidate.right,
						DEFAULT_ATELIER_UI_STATE.panels.right,
					),
				),
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
	const extensions = coerceExtensionPreferences(candidate.extensions);
	return {
		version: 1,
		layout: {
			sizes: normalizeLayoutSizes(
				(layout.sizes as Partial<Record<PanelSide, number>> | undefined) ??
					undefined,
			),
		},
		review: {
			autoAcceptAgentChanges:
				candidate.review !== null &&
				typeof candidate.review === "object" &&
				(candidate.review as Record<string, unknown>).autoAcceptAgentChanges ===
					true,
		},
		...(Object.keys(extensions).length > 0 ? { extensions } : {}),
	};
}

function coerceExtensionPreferences(
	raw: unknown,
): Record<string, Record<string, AtelierJsonValue>> {
	if (!isPlainRecord(raw)) return {};
	const result: Record<string, Record<string, AtelierJsonValue>> = {};
	for (const [extensionId, namespace] of Object.entries(raw)) {
		if (!extensionId || !isPlainRecord(namespace)) continue;
		const values: Record<string, AtelierJsonValue> = {};
		for (const [key, value] of Object.entries(namespace)) {
			if (!key) continue;
			const json = coerceJsonValue(value, new Set<object>());
			if (json !== undefined) values[key] = json;
		}
		if (Object.keys(values).length > 0) result[extensionId] = values;
	}
	return result;
}

function coerceJsonValue(
	value: unknown,
	seen: Set<object>,
): AtelierJsonValue | undefined {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : undefined;
	}
	if (typeof value !== "object" || seen.has(value)) return undefined;
	seen.add(value);
	if (Array.isArray(value)) {
		const result: AtelierJsonValue[] = [];
		for (const entry of value) {
			const json = coerceJsonValue(entry, seen);
			if (json === undefined) {
				seen.delete(value);
				return undefined;
			}
			result.push(json);
		}
		seen.delete(value);
		return result;
	}
	if (!isPlainRecord(value)) {
		seen.delete(value);
		return undefined;
	}
	const result: Record<string, AtelierJsonValue> = {};
	for (const [key, entry] of Object.entries(value)) {
		const json = coerceJsonValue(entry, seen);
		if (json === undefined) {
			seen.delete(value);
			return undefined;
		}
		result[key] = json;
	}
	seen.delete(value);
	return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

export function normalizeLayoutSizes(
	sizes?: Partial<Record<PanelSide, number>>,
): PanelLayoutSizes {
	return {
		left: sizes?.left ?? DEFAULT_LAYOUT_SIZES.left,
		main: sizes?.main ?? DEFAULT_LAYOUT_SIZES.main,
		right: sizes?.right ?? DEFAULT_LAYOUT_SIZES.right,
	};
}
