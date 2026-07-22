import { isDocumentView } from "../extension-runtime/extension-instance-helpers";
import type {
	ExtensionInstance,
	ExtensionKind,
	PanelState,
} from "../extension-runtime/types";

/** Reserved instance id of the pinned home tab. */
export const CENTRAL_HOME_INSTANCE = "central-home";

type CentralPlaceIntent = {
	readonly newTab?: boolean;
	readonly documentOrigin?: "existing" | "new";
};

/**
 * The central island's rules as one cohesive object: browser-style tabs with
 * an optional pinned home. All tab-model rules live here so the shell reads
 * `behavior.<rule>` instead of branching on flags at every call site.
 */
export type CentralSlotBehavior = {
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

const panelViewsEqual = (left: PanelState, right: PanelState): boolean =>
	left.activeInstance === right.activeInstance &&
	left.views.length === right.views.length &&
	left.views.every((view, index) => view === right.views[index]);

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

export function createCentralSlotBehavior(config: {
	readonly homeKind: ExtensionKind | null;
	/** Extension kinds declaring central placement (beyond document editors). */
	readonly centralKinds: ReadonlySet<ExtensionKind>;
}): CentralSlotBehavior {
	const { homeKind, centralKinds } = config;
	// The Files view always lives in the sidebar; the central slot hosts
	// documents, host central views, and (when configured) the pinned home.
	const canHost = (view: ExtensionInstance): boolean =>
		isDocumentView(view) ||
		view.kind === homeKind ||
		centralKinds.has(view.kind);
	return {
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
