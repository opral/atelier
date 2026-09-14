import { isDocumentView } from "../extension-runtime/extension-instance-helpers";
import { EDITOR_REVISION_STATE_KEYS } from "../extension-runtime/editor-revision-state";
import type {
	ExtensionInstance,
	ExtensionKind,
	AreaState,
} from "../extension-runtime/types";

/** Reserved instance id of the pinned home tab. */
export const CENTRAL_HOME_INSTANCE = "main-home";

type CentralPlaceIntent = {
	readonly newTab?: boolean;
	readonly documentOrigin?: "existing" | "new";
};

/**
 * The main island's rules as one cohesive object: browser-style tabs with
 * an optional pinned home. All tab-model rules live here so the shell reads
 * `behavior.<rule>` instead of branching on flags at every call site.
 */
export type CentralSlotBehavior = {
	/** Extension pinned as the permanent first tab, when configured. */
	readonly homeKind: ExtensionKind | null;
	/** Whether the main island can host this view. */
	readonly canHost: (view: ExtensionInstance) => boolean;
	/** Canonicalizes the main panel state (idempotent, reference-stable). */
	readonly normalize: (area: AreaState) => AreaState;
	/** Places a view following the mode's navigation rules. */
	readonly place: (
		area: AreaState,
		view: ExtensionInstance,
		intent?: CentralPlaceIntent,
	) => AreaState;
	/**
	 * The instance to activate after a removal, given the REMAINING views and
	 * the removed view's former index.
	 */
	readonly closeFallback: (
		views: readonly ExtensionInstance[],
		removedIndex: number,
	) => string | null;
};

const panelViewsEqual = (left: AreaState, right: AreaState): boolean =>
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
 * Places a view into a tabbed main panel following the browser-like rules:
 * activate an existing instance (merging its state), otherwise navigate the
 * active tab in place; append a new tab when requested or when the pinned
 * home is active.
 */
const insertCentralTabView = (
	area: AreaState,
	view: ExtensionInstance,
	intent: CentralPlaceIntent = {},
): AreaState => {
	const existingIndex = area.views.findIndex(
		(entry) => entry.instance === view.instance,
	);
	if (existingIndex !== -1) {
		const existing = area.views[existingIndex] as ExtensionInstance;
		// Activation, not replacement: keep accumulated state, let the new
		// identity fields win. Revision keys ARE identity — a tab that once
		// showed a historical snapshot must not stay pinned to it when the
		// document is opened live again, so the merge never inherits them.
		const existingState = existing.state ? { ...existing.state } : undefined;
		if (existingState) {
			for (const key of EDITOR_REVISION_STATE_KEYS) {
				delete existingState[key];
			}
		}
		const mergedState =
			existingState || view.state
				? { ...(existingState ?? {}), ...(view.state ?? {}) }
				: undefined;
		const merged: ExtensionInstance = {
			...existing,
			...view,
			...(mergedState ? { state: mergedState } : {}),
			...(existing.isPinned ? { isPinned: true } : {}),
		};
		const views = area.views.map((entry, index) =>
			index === existingIndex ? merged : entry,
		);
		return { views, activeInstance: merged.instance };
	}
	const activeIndex = area.views.findIndex(
		(entry) => entry.instance === area.activeInstance,
	);
	const activeEntry = activeIndex !== -1 ? area.views[activeIndex] : null;
	const appendTab = intent.newTab ?? intent.documentOrigin === "new";
	if (appendTab || !activeEntry || activeEntry.isPinned) {
		// New tabs always join at the end of the strip, browser-style,
		// regardless of which tab is active.
		return { views: [...area.views, view], activeInstance: view.instance };
	}
	const views = area.views.map((entry, index) =>
		index === activeIndex ? view : entry,
	);
	return { views, activeInstance: view.instance };
};

export function createCentralSlotBehavior(config: {
	readonly homeKind: ExtensionKind | null;
	/** Extension kinds declaring main placement (beyond document editors). */
	readonly mainKinds: ReadonlySet<ExtensionKind>;
}): CentralSlotBehavior {
	const { homeKind, mainKinds } = config;
	// The Files view always lives in the sidebar; the main slot hosts
	// documents, host main views, and (when configured) the pinned home.
	const canHost = (view: ExtensionInstance): boolean =>
		isDocumentView(view) || view.kind === homeKind || mainKinds.has(view.kind);
	return {
		homeKind,
		canHost,
		normalize: (area) => {
			let views: ExtensionInstance[] = area.views.filter(canHost);
			if (homeKind) {
				views = ensurePinnedHomeView(views, homeKind);
			}
			const activeInstance = views.some(
				(view) => view.instance === area.activeInstance,
			)
				? area.activeInstance
				: (views[views.length - 1]?.instance ?? null);
			const next = { views, activeInstance };
			return panelViewsEqual(area, next) ? area : next;
		},
		place: insertCentralTabView,
		// Tabs close to the neighbor; the pinned home catches the last one.
		closeFallback: (views, removedIndex) =>
			views[removedIndex]?.instance ??
			views[removedIndex - 1]?.instance ??
			null,
	};
}
