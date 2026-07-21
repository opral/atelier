import {
	FILES_EXTENSION_KIND,
	isDocumentView,
} from "../extension-runtime/extension-instance-helpers";
import type {
	ExtensionInstance,
	ExtensionKind,
	PanelState,
} from "../extension-runtime/types";

/** Reserved instance id of the pinned home tab in tabbed mode. */
export const CENTRAL_HOME_INSTANCE = "central-home";

export type CentralPlaceIntent = {
	readonly newTab?: boolean;
	readonly documentOrigin?: "existing" | "new";
};

/**
 * The central island's mode as one cohesive object: the document-slot default
 * (one view, switched from the Files list) or browser-style tabs with an
 * optional pinned home. All tab-model rules live here so the shell reads
 * `behavior.<rule>` instead of branching on flags at every call site.
 */
export type CentralSlotBehavior = {
	/** True in tabbed mode; drives the tab strip UI. */
	readonly tabs: boolean;
	/** Extension pinned as the permanent first tab, when configured. */
	readonly homeKind: ExtensionKind | null;
	/** Whether the central island can host this view. */
	readonly canHost: (view: ExtensionInstance) => boolean;
	/** Canonicalizes the central panel state (idempotent, reference-stable). */
	readonly normalize: (panel: PanelState) => PanelState;
	/** Places a view following the mode's navigation rules. */
	readonly place: (
		panel: PanelState,
		view: ExtensionInstance,
		intent?: CentralPlaceIntent,
	) => PanelState;
	/**
	 * The instance to activate after a removal, given the REMAINING views and
	 * the removed view's former index.
	 */
	readonly closeFallback: (
		views: readonly ExtensionInstance[],
		removedIndex: number,
	) => string | null;
};

const activeEntryOf = (panel: PanelState): ExtensionInstance | null => {
	if (panel.activeInstance) {
		const active = panel.views.find(
			(entry) => entry.instance === panel.activeInstance,
		);
		if (active) return active;
	}
	return panel.views[0] ?? null;
};

const panelViewsEqual = (left: PanelState, right: PanelState): boolean =>
	left.activeInstance === right.activeInstance &&
	left.views.length === right.views.length &&
	left.views.every((view, index) => view === right.views[index]);

/** The single-document slot: exactly one document (or Files landing) view. */
export const DOCUMENT_SLOT_BEHAVIOR: CentralSlotBehavior = {
	tabs: false,
	homeKind: null,
	canHost: (view) => isDocumentView(view) || view.kind === FILES_EXTENSION_KIND,
	normalize: (panel) => {
		const activeEntry = activeEntryOf(panel);
		if (!activeEntry || !DOCUMENT_SLOT_BEHAVIOR.canHost(activeEntry)) {
			return panel.views.length === 0 && panel.activeInstance === null
				? panel
				: { views: [], activeInstance: null };
		}
		if (
			panel.views.length === 1 &&
			panel.views[0] === activeEntry &&
			panel.activeInstance === activeEntry.instance
		) {
			return panel;
		}
		return {
			views: [activeEntry],
			activeInstance: activeEntry.instance,
		};
	},
	place: (_panel, view) => ({
		views: [view],
		activeInstance: view.instance,
	}),
	closeFallback: (views) => views[views.length - 1]?.instance ?? null,
};

/**
 * Keeps the configured home pinned as the permanent first view with the
 * reserved instance id, dropping any stray duplicates from persisted state.
 */
const ensurePinnedHomeView = (
	views: readonly ExtensionInstance[],
	homeKind: ExtensionKind,
): ExtensionInstance[] => {
	const candidates = views.filter(
		(view) => view.instance === CENTRAL_HOME_INSTANCE || view.kind === homeKind,
	);
	const canonical =
		candidates.find(
			(view) =>
				view.instance === CENTRAL_HOME_INSTANCE && view.kind === homeKind,
		) ?? candidates[0];
	const home: ExtensionInstance =
		canonical &&
		canonical.instance === CENTRAL_HOME_INSTANCE &&
		canonical.kind === homeKind &&
		canonical.isPinned
			? canonical
			: {
					...(canonical?.kind === homeKind ? canonical : {}),
					instance: CENTRAL_HOME_INSTANCE,
					kind: homeKind,
					isPinned: true,
				};
	return [home, ...views.filter((view) => !candidates.includes(view))];
};

/**
 * Places a view into a tabbed central panel following the browser-like rules:
 * activate an existing instance (merging its state), otherwise navigate the
 * active tab in place; append a new tab when requested or when the pinned
 * home is active.
 */
const insertCentralTabView = (
	panel: PanelState,
	view: ExtensionInstance,
	intent: CentralPlaceIntent = {},
): PanelState => {
	const existingIndex = panel.views.findIndex(
		(entry) => entry.instance === view.instance,
	);
	if (existingIndex !== -1) {
		const existing = panel.views[existingIndex] as ExtensionInstance;
		// Activation, not replacement: keep accumulated state, let the new
		// identity fields win.
		const mergedState =
			existing.state || view.state
				? { ...(existing.state ?? {}), ...(view.state ?? {}) }
				: undefined;
		const merged: ExtensionInstance = {
			...existing,
			...view,
			...(mergedState ? { state: mergedState } : {}),
			...(existing.isPinned ? { isPinned: true } : {}),
		};
		const views = panel.views.map((entry, index) =>
			index === existingIndex ? merged : entry,
		);
		return { views, activeInstance: merged.instance };
	}
	const activeIndex = panel.views.findIndex(
		(entry) => entry.instance === panel.activeInstance,
	);
	const activeEntry = activeIndex !== -1 ? panel.views[activeIndex] : null;
	const appendTab = intent.newTab ?? intent.documentOrigin === "new";
	if (appendTab || !activeEntry || activeEntry.isPinned) {
		// New tabs always join at the end of the strip, browser-style,
		// regardless of which tab is active.
		return { views: [...panel.views, view], activeInstance: view.instance };
	}
	const views = panel.views.map((entry, index) =>
		index === activeIndex ? view : entry,
	);
	return { views, activeInstance: view.instance };
};

export function createTabbedCentralSlotBehavior(config: {
	readonly homeKind: ExtensionKind | null;
	/** Extension kinds declaring central placement (beyond document editors). */
	readonly centralKinds: ReadonlySet<ExtensionKind>;
}): CentralSlotBehavior {
	const { homeKind, centralKinds } = config;
	const canHost = (view: ExtensionInstance): boolean =>
		isDocumentView(view) ||
		// A configured home replaces the Files landing view in the central slot.
		(view.kind === FILES_EXTENSION_KIND && homeKind === null) ||
		view.kind === homeKind ||
		centralKinds.has(view.kind);
	return {
		tabs: true,
		homeKind,
		canHost,
		normalize: (panel) => {
			let views: ExtensionInstance[] = panel.views.filter(canHost);
			if (homeKind) {
				views = ensurePinnedHomeView(views, homeKind);
			}
			const activeInstance = views.some(
				(view) => view.instance === panel.activeInstance,
			)
				? panel.activeInstance
				: (views[views.length - 1]?.instance ?? null);
			const next = { views, activeInstance };
			return panelViewsEqual(panel, next) ? panel : next;
		},
		place: insertCentralTabView,
		// Tabs close to the neighbor; the pinned home catches the last one.
		closeFallback: (views, removedIndex) =>
			views[removedIndex]?.instance ??
			views[removedIndex - 1]?.instance ??
			null,
	};
}
