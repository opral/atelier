import { DeclarativeExtension } from "../extension-runtime/declarative-extension";
import clsx from "clsx";
import {
	forwardRef,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type ComponentType,
	type CSSProperties,
	type HTMLAttributes,
	type MouseEvent,
	type ReactNode,
	type RefObject,
} from "react";
import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
	ArrowRightToLine,
	Check,
	ChevronDown,
	CopyMinus,
	Pencil,
	Plus,
	X,
} from "lucide-react";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
	AtelierExtensionMenuItem,
	AtelierExtensionPreferences,
} from "../extension-api";
import {
	ExtensionContextMenuItems,
	ExtensionDropdownMenuItems,
	resolveExtensionMenuItems,
} from "../extension-runtime/extension-menu-items";
import { panelShortcutHint } from "@/lib/platform";
import { tabRenameTarget } from "./tab-rename";
import type {
	Area,
	AreaState,
	ExtensionDefinition,
	ExtensionHostContext,
	ExtensionInstance,
	ExtensionKind,
	ExtensionRuntime,
	ExtensionState,
	ExtensionView,
} from "../extension-runtime/types";
import { useExtensionRegistry } from "../extension-runtime/extension-registry";
import styles from "./panel.module.css";

/** Lucide icons and image-based brand icons both fit this shape. */
type TabIcon = ComponentType<{ className?: string }>;
import { useExtensionViewRuntime } from "../extension-runtime/extension-view-runtime";
import { fileIconUrl } from "../file-icons";
import {
	useExtensionHostRegistry,
	type ExtensionHostRecord,
} from "../extension-runtime/extension-host-registry";

/** Where a panel puts the keyboard when its last view closes. */
const PANEL_REMOVAL_FOCUS_FALLBACKS = [
	'[data-attr="panel-empty-open-view"]',
	'[data-attr="panel-section-picker"]',
	'[data-attr="panel-add-view"]',
] as const;

/**
 * Keeps the keyboard somewhere after a tab closes.
 *
 * The removal is a state change an area above owns, so what to focus is only
 * known once the area comes back without the removed view: the tab that took
 * over, or the strip's own affordance when the last one goes. Without this the
 * closed tab's button leaves the document with focus on it, and focus falls to
 * `<body>` — the next Tab then restarts at the top of the page.
 *
 * @example
 * const removeView = useTabRemovalFocus({ area, activeInstance, containerRef, onRemoveView });
 */
function useTabRemovalFocus({
	area,
	activeInstance,
	containerRef,
	onRemoveView,
	fallbackSelectors = [],
}: {
	readonly area: AreaState;
	readonly activeInstance: string | null;
	readonly containerRef: RefObject<HTMLElement | null>;
	readonly onRemoveView: (instance: string) => void;
	/** Where the keyboard goes when the last tab closes, in order of preference. */
	readonly fallbackSelectors?: readonly string[];
}): (instance: string) => void {
	const pendingRef = useRef<{
		readonly instance: string;
		readonly previousViews: AreaState["views"];
		readonly previousActiveInstance: string | null;
	} | null>(null);
	const removeView = useCallback(
		(instance: string) => {
			const pending = {
				instance,
				previousViews: area.views,
				previousActiveInstance: area.activeInstance,
			};
			pendingRef.current = pending;
			onRemoveView(instance);
			// A removal the area declines leaves the claim behind; drop it
			// rather than move focus on the next unrelated change.
			window.setTimeout(() => {
				if (pendingRef.current === pending) pendingRef.current = null;
			}, 0);
		},
		[area.activeInstance, area.views, onRemoveView],
	);
	const fallbacks = fallbackSelectors.join(",");
	useLayoutEffect(() => {
		const container = containerRef.current;
		const pending = pendingRef.current;
		if (!container || !pending) return;
		if (area.views.some((entry) => entry.instance === pending.instance)) {
			if (
				area.views !== pending.previousViews ||
				area.activeInstance !== pending.previousActiveInstance
			) {
				pendingRef.current = null;
			}
			return;
		}
		pendingRef.current = null;
		const nextTab = activeInstance
			? (Array.from(
					container.querySelectorAll<HTMLButtonElement>(
						"button[data-view-instance]",
					),
				).find((button) => button.dataset.viewInstance === activeInstance) ??
				null)
			: null;
		// The fallbacks are in order of preference, not document order.
		const fallback = fallbacks
			.split(",")
			.filter(Boolean)
			.reduce<HTMLButtonElement | null>(
				(found, selector) =>
					found ?? container.querySelector<HTMLButtonElement>(selector),
				null,
			);
		(nextTab ?? fallback)?.focus({ preventScroll: true });
	}, [
		activeInstance,
		area.activeInstance,
		area.views,
		containerRef,
		fallbacks,
	]);
	return removeView;
}

/**
 * Unified panel host that renders the shared tab strip and body layout for any side.
 *
 * Pass callbacks and slots for customizing tabs, interaction behavior, and empty
 * placeholders so parents only supply their unique behavior.
 *
 * @example
 * <PanelV2
 *   side="left"
 *   panel={panelState}
 *   onSelectView={selectView}
 *   onRemoveView={removeView}
 *   emptyStatePlaceholder={<EmptyState />}
 *   extraTabBarContent={<AddViewButton />}
 * />
 */
export function PanelV2({
	side,
	ariaLabel,
	area,
	isFocused,
	onFocusArea,
	onSelectView,
	onRemoveView,
	onAddView,
	onHidePanel,
	viewContext,
	tabLabel,
	tabTooltip,
	onRenameTab,
	emptyStatePlaceholder,
	onActiveViewInteraction,
	dropId,
	viewOverrides,
	showTabBar = side === "main",
	tabBarExtraContent,
	customTabStrip,
	contentVisible = true,
}: PanelV2Props) {
	const { extensionMap, visibleExtensions } = useExtensionRegistry();
	const { setNodeRef, isOver } = useDroppable({
		id: dropId ?? `${side}-panel`,
		data: { area: side },
	});

	const activeEntry = area.activeInstance
		? (area.views.find((entry) => entry.instance === area.activeInstance) ??
			null)
		: (area.views[0] ?? null);

	const resolveViewDefinition = useCallback(
		(kind: ExtensionKind): ExtensionDefinition | null => {
			const override = viewOverrides?.find(
				(candidate) => candidate.kind === kind,
			);
			return override ?? extensionMap.get(kind) ?? null;
		},
		[viewOverrides, extensionMap],
	);

	const hasViews = area.views.length > 0;
	const activeInstance = activeEntry?.instance ?? null;
	const [mountedInstances, setMountedInstances] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	useEffect(() => {
		if (
			!contentVisible ||
			!activeInstance ||
			mountedInstances.has(activeInstance)
		) {
			return;
		}
		setMountedInstances((current) => {
			if (current.has(activeInstance)) return current;
			return new Set([...current, activeInstance]);
		});
	}, [activeInstance, contentVisible, mountedInstances]);
	const availableViews = useMemo(
		() => availableExtensionsForPanel(visibleExtensions, area, side),
		[area, side, visibleExtensions],
	);
	const panelElementRef = useRef<HTMLElement | null>(null);
	const pendingAddedViewRef = useRef<{
		readonly kind: ExtensionKind;
		readonly focusAfterMenuClose: boolean;
		readonly previousInstances: ReadonlySet<string>;
		readonly previousViews: AreaState["views"];
		readonly previousActiveInstance: string | null;
	} | null>(null);
	const setPanelElementRef = useCallback(
		(node: HTMLElement | null) => {
			panelElementRef.current = node;
			setNodeRef(node);
		},
		[setNodeRef],
	);
	const requestAddView = useCallback(
		(
			kind: ExtensionKind,
			state: ExtensionState | undefined,
			focusAfterMenuClose: boolean,
		) => {
			if (!onAddView) return;
			const pendingAddedView = {
				kind,
				focusAfterMenuClose,
				previousInstances: new Set(area.views.map((entry) => entry.instance)),
				previousViews: area.views,
				previousActiveInstance: area.activeInstance,
			};
			pendingAddedViewRef.current = pendingAddedView;
			if (state === undefined) {
				onAddView(kind);
			} else {
				onAddView(kind, state);
			}
			if (!focusAfterMenuClose) {
				window.setTimeout(() => {
					if (pendingAddedViewRef.current === pendingAddedView) {
						pendingAddedViewRef.current = null;
					}
				}, 0);
			}
		},
		[onAddView, area.activeInstance, area.views],
	);
	const handleMenuAddView = useCallback(
		(kind: ExtensionKind, state?: ExtensionState) => {
			requestAddView(kind, state, true);
		},
		[requestAddView],
	);
	const findPendingAddedTab = useCallback(() => {
		const panelElement = panelElementRef.current;
		const pendingAddedView = pendingAddedViewRef.current;
		if (!panelElement || !pendingAddedView) return null;
		return (
			Array.from(
				panelElement.querySelectorAll<HTMLButtonElement>(
					"button[data-view-instance][data-view-key]",
				),
			).find(
				(button) =>
					button.dataset.viewKey === pendingAddedView.kind &&
					!pendingAddedView.previousInstances.has(
						button.dataset.viewInstance ?? "",
					),
			) ?? null
		);
	}, []);
	const focusPendingAddedTab = useCallback(() => {
		const nextTab = findPendingAddedTab();
		pendingAddedViewRef.current = null;
		if (!nextTab) return false;
		nextTab.focus({ preventScroll: true });
		return true;
	}, [findPendingAddedTab]);
	const handleRemoveView = useTabRemovalFocus({
		area,
		activeInstance,
		containerRef: panelElementRef,
		onRemoveView,
		fallbackSelectors: PANEL_REMOVAL_FOCUS_FALLBACKS,
	});
	const { makeRuntime } = useExtensionViewRuntime({
		areaState: area,
		area: side,
		isFocused,
		host: viewContext,
	});

	const viewContexts = useMemo(() => {
		const map = new Map<string, ReturnType<typeof makeRuntime>>();
		for (const entry of area.views) {
			map.set(entry.instance, makeRuntime(entry));
		}
		return map;
	}, [area.views, makeRuntime]);
	// A review steps through its files by navigating the tab in place. The
	// document it lands on keeps the mounted view when the same extension
	// shows it; otherwise the view leaving stays on screen until the one
	// arriving has its document.
	const { keys: viewSlots, handover: pendingHandover } = useViewSlots(
		area.views,
		viewContext.atelier.diff?.session != null,
	);
	const [shownInstance, setShownInstance] = useState<string | null>(null);
	const handover =
		pendingHandover && shownInstance !== pendingHandover.incoming
			? pendingHandover
			: null;
	const outgoingContext = useMemo(
		() => (handover ? makeRuntime(handover.outgoing) : null),
		[handover, makeRuntime],
	);

	const handleInteraction = (event: { target: EventTarget | null }) => {
		if (!onActiveViewInteraction || !activeInstance) return;
		// Activate the view the interaction happened IN — programmatic focus
		// inside a just-revealed (still hidden) view must not re-select the
		// previously active one.
		const targetView =
			event.target instanceof Element
				? event.target
						.closest("[data-view-instance]")
						?.getAttribute("data-view-instance")
				: null;
		onActiveViewInteraction(targetView ?? activeInstance);
	};

	const ContainerElement =
		side === "main" ? ("section" as const) : ("aside" as const);
	const hostTextClass = side === "main" ? "text-fg" : "text-fg-muted";

	const contentHandlers =
		onActiveViewInteraction && activeInstance
			? {
					onPointerDownCapture: handleInteraction,
					onFocusCapture: handleInteraction,
				}
			: undefined;

	useLayoutEffect(() => {
		const panelElement = panelElementRef.current;
		if (!panelElement) return;
		const findTab = (instance: string) =>
			Array.from(
				panelElement.querySelectorAll<HTMLButtonElement>(
					"button[data-view-instance]",
				),
			).find((button) => button.dataset.viewInstance === instance) ?? null;

		const pendingAddedView = pendingAddedViewRef.current;
		if (pendingAddedView) {
			const addedEntry = area.views.find(
				(entry) =>
					entry.kind === pendingAddedView.kind &&
					!pendingAddedView.previousInstances.has(entry.instance),
			);
			if (addedEntry && activeInstance === addedEntry.instance) {
				if (pendingAddedView.focusAfterMenuClose) return;
				pendingAddedViewRef.current = null;
				findTab(addedEntry.instance)?.focus({ preventScroll: true });
				return;
			}
			if (
				area.views !== pendingAddedView.previousViews ||
				area.activeInstance !== pendingAddedView.previousActiveInstance
			) {
				pendingAddedViewRef.current = null;
			}
		}
	}, [activeInstance, area.activeInstance, area.views]);

	const resolvedEmptyState =
		emptyStatePlaceholder === undefined && onAddView ? (
			<DefaultPanelEmptyState
				side={side}
				availableViews={availableViews}
				onAddView={(kind) => requestAddView(kind, undefined, false)}
			/>
		) : (
			emptyStatePlaceholder
		);
	// The active section may contribute a control at the header's trailing
	// end (a scope switch); it renders with that view's own runtime.
	const activeSectionEntry =
		area.views.find((entry) => entry.instance === area.activeInstance) ??
		area.views[0] ??
		null;
	const activeSectionDefinition = activeSectionEntry
		? resolveViewDefinition(activeSectionEntry.kind)
		: null;
	const activeSectionContext = activeSectionEntry
		? viewContexts.get(activeSectionEntry.instance)
		: undefined;
	const HeaderAccessory = activeSectionDefinition?.HeaderAccessory;
	const sectionAccessory =
		HeaderAccessory && activeSectionContext ? (
			<HeaderAccessory
				atelier={activeSectionContext.atelier}
				view={activeSectionContext.view}
			/>
		) : null;
	// A collapsed panel is 0 wide and shows nothing, so its header leaves with
	// its content: a section picker inside it was still tabbable and still in
	// the accessibility tree, and opening it floated a menu over the main area
	// for a sidebar that is not on screen — "Hide sidebar" included, which from
	// there would have shown it.
	const sideSectionPicker =
		side !== "main" && hasViews && contentVisible ? (
			<div
				data-atelier-part="section-header"
				className="flex items-start justify-between gap-2"
			>
				<SidebarSectionPicker
					side={side}
					area={area}
					availableViews={availableViews}
					resolveViewDefinition={resolveViewDefinition}
					preferencesFor={viewContext.preferencesFor}
					onSelectView={onSelectView}
					onAddView={onAddView}
					onHidePanel={onHidePanel}
					tabLabel={tabLabel}
					tabTooltip={tabTooltip}
				/>
				{sectionAccessory}
			</div>
		) : null;

	return (
		<ContainerElement
			ref={setPanelElementRef}
			aria-label={ariaLabel}
			onClickCapture={() => onFocusArea(side)}
			className={clsx("flex h-full w-full flex-col", hostTextClass)}
		>
			{sideSectionPicker}
			{/* Main tabs remain the only document tab strip. Side areas use the
			    section picker above so their views do not read as documents. */}
			{showTabBar && customTabStrip !== undefined ? (
				<div data-atelier-part="custom-tab-strip" className="w-full min-w-0">
					{customTabStrip}
				</div>
			) : showTabBar ? (
				<TabBar
					activeInstance={activeInstance}
					extraContent={
						tabBarExtraContent !== undefined ? (
							tabBarExtraContent
						) : onAddView ? (
							<AddViewMenu
								side={side}
								availableViews={availableViews}
								onAddView={handleMenuAddView}
								onSelectedViewSettled={focusPendingAddedTab}
							/>
						) : null
					}
				>
					<SortableContext
						id={`panel-${side}`}
						items={area.views.map((entry) => entry.instance)}
						strategy={horizontalListSortingStrategy}
					>
						{area.views.map((entry) => {
							const view = resolveViewDefinition(entry.kind);
							if (!view) return null;
							const isActive = activeInstance === entry.instance;
							const label = resolveLabel(view, entry, tabLabel);
							return (
								<SortableTab
									key={entry.instance}
									instance={entry.instance}
									area={side}
									kind={entry.kind}
									icon={
										side === "main"
											? (fileGlyphForLabel(label) ?? view.icon)
											: view.icon
									}
									label={label}
									isActive={isActive}
									isFocused={isFocused && isActive}
									isPending={entry.isPending}
									isPinned={entry.isPinned}
									onClick={() => onSelectView(entry.instance)}
									onClose={
										entry.isPinned
											? undefined
											: () => handleRemoveView(entry.instance)
									}
									onRename={
										onRenameTab && typeof entry.state?.filePath === "string"
											? (nextName) => onRenameTab(entry, nextName)
											: undefined
									}
								/>
							);
						})}
					</SortableContext>
				</TabBar>
			) : null}

			{/* Every panel body shares the island geometry (rounded corners) so
			    the sides align with the main editor, but only main is the
			    elevated white surface with a border. Side islands are invisible —
			    the canvas shows through and their views style themselves for
			    that surface. */}
			<div
				className={clsx(
					"flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px]",
					side === "main" ? "border border-border bg-panel" : "bg-transparent",
					isOver && "ring-2 ring-ring ring-inset",
				)}
			>
				{hasViews ? (
					<PanelContent {...contentHandlers}>
						{area.views.flatMap((entry) => {
							const isActive = activeInstance === entry.instance;
							if (
								!(contentVisible && isActive) &&
								!mountedInstances.has(entry.instance)
							) {
								return [];
							}
							const view = resolveViewDefinition(entry.kind);
							if (!view) return [];
							const context = viewContexts.get(entry.instance);
							if (!context) return [];
							// The view arriving in a hand-over is laid out in the same
							// box as the one leaving, out of sight, so it can read its
							// document and take its measurements before it is shown.
							// Both are siblings under their own keys, so the leaving
							// view's node is the one it always was.
							const arriving = handover?.incoming === entry.instance;
							const outgoing =
								arriving && handover && outgoingContext
									? resolveViewDefinition(handover.outgoing.kind)
									: null;
							return [
								outgoing && handover && outgoingContext ? (
									<div
										key={handover.outgoingKey}
										className="contents"
										data-atelier-view-leaving=""
									>
										<ViewRenderer
											view={outgoing}
											instance={handover.outgoing}
											atelier={outgoingContext.atelier}
											extensionView={outgoingContext.view}
											side={side}
											isActive={false}
										/>
									</div>
								) : null,
								<div
									key={viewSlots.get(entry.instance) ?? entry.instance}
									className={
										arriving
											? "pointer-events-none absolute inset-0 flex min-h-0 flex-col opacity-0"
											: isActive
												? "contents"
												: "hidden"
									}
									aria-hidden={isActive && !arriving ? undefined : true}
									data-atelier-view-arriving={arriving || undefined}
								>
									<ViewRenderer
										view={view}
										instance={entry}
										atelier={context.atelier}
										extensionView={context.view}
										side={side}
										isActive={isActive}
										onShown={() => setShownInstance(entry.instance)}
									/>
								</div>,
							];
						})}
					</PanelContent>
				) : (
					<PanelContent>{resolvedEmptyState}</PanelContent>
				)}
			</div>
		</ContainerElement>
	);
}

export type PanelV2Props = {
	readonly side: Area;
	readonly ariaLabel?: string;
	readonly area: AreaState;
	readonly isFocused: boolean;
	readonly onFocusArea: (side: Area) => void;
	readonly onSelectView: (instance: string) => void;
	readonly onRemoveView: (instance: string) => void;
	/** Enables the "+" add-view menu in the tab row. */
	readonly onAddView?: (kind: ExtensionKind, state?: ExtensionState) => void;
	/** Adds "Hide sidebar" to a side panel's section picker. */
	readonly onHidePanel?: () => void;
	readonly viewContext: ExtensionHostContext;
	readonly tabLabel?: (
		view: ExtensionDefinition,
		instance: ExtensionInstance,
	) => string;
	/** Hover text for a tab when it should say more than its label (a file's path). */
	readonly tabTooltip?: (
		view: ExtensionDefinition,
		instance: ExtensionInstance,
	) => string | undefined;
	/**
	 * Renames the file a document tab is on, from the tab. Resolves false
	 * when the workspace refuses the name and the field stays open on it.
	 * Absent means tabs do not rename — a read-only workspace, or a host that
	 * owns naming itself.
	 */
	readonly onRenameTab?: (
		instance: ExtensionInstance,
		nextName: string,
	) => Promise<boolean>;
	readonly emptyStatePlaceholder?: ReactNode;
	readonly onActiveViewInteraction?: (instance: string) => void;
	readonly dropId?: string;
	readonly viewOverrides?: ExtensionDefinition[];
	/**
	 * Renders a tab strip inside the panel body. The workspace never sets this:
	 * document tabs live in the top bar (`PanelTabStrip`) and side areas use
	 * the section picker, so the workspace has exactly one tab strip.
	 */
	readonly showTabBar?: boolean;
	/** Replaces the default add-view menu at the end of the tab strip. */
	readonly tabBarExtraContent?: ReactNode;
	/** Host-rendered strip replacing the built-in tab row entirely. */
	readonly customTabStrip?: ReactNode;
	/** Defers a panel's first extension mount until its content is visible. */
	readonly contentVisible?: boolean;
};

// Reference rows are regular-weight with muted icons; only the active row is
// semibold. Anything heavier makes the whole menu read as bold.
const sectionPickerItemClasses =
	"h-[30px] rounded-md px-2 text-[12.5px] font-normal text-fg-muted focus:bg-bg-hover focus:text-fg";
const sectionPickerIconClasses = "size-3.25 text-fg-subtle";
const EMPTY_EXTENSION_PREFERENCES: AtelierExtensionPreferences = {
	get: () => undefined,
	set: () => undefined,
	delete: () => undefined,
};

/**
 * A side panel's only chrome: a caption-weight label that opens the view
 * picker in place. Switching views swaps the sidebar's content and relabels
 * the caption — the top bar never changes, so side views never read as
 * documents.
 */
function SidebarSectionPicker({
	side,
	area,
	availableViews,
	resolveViewDefinition,
	preferencesFor,
	onSelectView,
	onAddView,
	onHidePanel,
	tabLabel,
}: {
	readonly side: Exclude<Area, "main">;
	readonly area: AreaState;
	readonly availableViews: readonly ExtensionDefinition[];
	readonly resolveViewDefinition: (
		kind: ExtensionKind,
	) => ExtensionDefinition | null;
	readonly preferencesFor: (
		extensionId: ExtensionKind,
	) => AtelierExtensionPreferences;
	readonly onSelectView: (instance: string) => void;
	readonly onAddView?: (kind: ExtensionKind, state?: ExtensionState) => void;
	readonly onHidePanel?: () => void;
	readonly tabLabel?: PanelV2Props["tabLabel"];
	readonly tabTooltip?: PanelV2Props["tabTooltip"];
}) {
	const activeEntry =
		area.views.find((entry) => entry.instance === area.activeInstance) ??
		area.views[0] ??
		null;
	const activeDefinition = activeEntry
		? resolveViewDefinition(activeEntry.kind)
		: null;
	const activeLabel = activeDefinition
		? resolveLabel(activeDefinition, activeEntry, tabLabel)
		: "Views";
	const extensionMenuItems = activeEntry
		? resolveExtensionMenuItems(
				activeDefinition,
				preferencesFor(activeEntry.kind),
			)
		: [];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={`${activeLabel} panel view menu`}
					data-attr="panel-section-picker"
					// Mouse clicks never take focus, so a later keypress cannot
					// paint the keyboard focus ring on a pointer interaction.
					onMouseDown={(event) => event.preventDefault()}
					// Caption, not chrome: no fill, no border. It darkens on hover and
					// while open, which is the whole affordance. px-1.5 puts the label
					// text on the sidebar's content column — the same x as the tree
					// rows' icons, whose centers sit under the top bar's mark.
					className="group/section flex w-fit items-center gap-[5px] self-start rounded-[5px] px-1.5 py-1 text-[11px] font-bold uppercase tracking-[0.07em] text-fg-faint transition-colors hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-fg-muted"
				>
					<span>{activeLabel}</span>
					<ChevronDown
						aria-hidden="true"
						className="size-2.25 text-fg-faint transition-[transform,color] group-hover/section:text-fg-muted group-data-[state=open]/section:rotate-180 group-data-[state=open]/section:text-fg-muted"
						strokeWidth={2.6}
					/>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				// Always anchored to the label, on either side: the picker replaces
				// the sidebar's content ambiguity in place.
				align="start"
				sideOffset={2}
				// Closing does not hand focus back to the trigger: the restore is
				// programmatic and would paint the keyboard focus ring after any
				// pointer-driven open/close. Tabbing to the trigger still rings.
				onCloseAutoFocus={(event) => event.preventDefault()}
				className="w-[212px] rounded-[10px] border border-border bg-panel p-1.5 shadow-lg"
			>
				{/* Open views and openable views read as one list: the picker answers
				    "what is this sidebar showing?", not "what is already loaded?". */}
				{area.views.map((entry) => {
					const definition = resolveViewDefinition(entry.kind);
					if (!definition) return null;
					const label = resolveLabel(definition, entry, tabLabel);
					const isActive = entry.instance === (activeEntry?.instance ?? null);
					return (
						<DropdownMenuItem
							key={entry.instance}
							onSelect={() => onSelectView(entry.instance)}
							className={clsx(
								sectionPickerItemClasses,
								isActive && "bg-bg-hover font-semibold text-fg",
							)}
						>
							<definition.icon
								className={clsx(
									"size-3.25",
									isActive ? "text-fg-muted" : "text-fg-subtle",
								)}
							/>
							<span className="truncate">{label}</span>
							{isActive ? (
								<Check
									aria-hidden="true"
									className="ml-auto size-3 text-link"
									strokeWidth={2.6}
								/>
							) : null}
						</DropdownMenuItem>
					);
				})}
				{onAddView
					? availableViews.map((definition) => (
							<DropdownMenuItem
								key={definition.kind}
								onSelect={() => onAddView(definition.kind)}
								className={sectionPickerItemClasses}
							>
								<definition.icon className={sectionPickerIconClasses} />
								<span className="truncate">{definition.label}</span>
							</DropdownMenuItem>
						))
					: null}
				{extensionMenuItems.length > 0 ? (
					<>
						<div className="my-1.5 mx-1 h-px bg-border-subtle" />
						<ExtensionDropdownMenuItems
							items={extensionMenuItems}
							itemClassName={sectionPickerItemClasses}
							separatorClassName="mx-1 my-1"
						/>
					</>
				) : null}
				{onHidePanel ? (
					<>
						<div className="my-1.5 mx-1 h-px bg-border-subtle" />
						<DropdownMenuItem
							onSelect={() => onHidePanel()}
							className={sectionPickerItemClasses}
						>
							<PanelIcon side={side} className={sectionPickerIconClasses} />
							<span>Hide sidebar</span>
							<span className="ml-auto text-[11px] font-medium text-fg-faint">
								{panelShortcutHint(side)}
							</span>
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Matches the top bar's panel toggles, so "Hide sidebar" reads as the same act. */
function PanelIcon({
	side,
	className,
}: {
	readonly side: "left" | "right";
	readonly className?: string;
}) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<path d={side === "left" ? "M9 3v18" : "M15 3v18"} />
		</svg>
	);
}

/**
 * Renders a panel's tab strip independently from its content island. The
 * workspace uses this for main document tabs in the top bar; it is the
 * workspace's only tab strip. Side areas use the section picker instead, so
 * their views never read as open documents.
 */
export function PanelTabStrip({
	side,
	area,
	visibleExtensions,
	extensionMap,
	isFocused,
	onSelectView,
	onRemoveView,
	onAddView,
	tabLabel,
	tabTooltip,
	onRenameTab,
	preferencesFor,
}: {
	readonly side: Area;
	readonly area: AreaState;
	readonly visibleExtensions: readonly ExtensionDefinition[];
	readonly extensionMap: ReadonlyMap<ExtensionKind, ExtensionDefinition>;
	readonly isFocused: boolean;
	readonly onSelectView: (instance: string) => void;
	readonly onRemoveView: (instance: string) => void;
	/** Enables the trailing "+" — the same view menu the sidebars offer. */
	readonly onAddView?: (kind: ExtensionKind, state?: ExtensionState) => void;
	readonly tabLabel?: PanelV2Props["tabLabel"];
	readonly tabTooltip?: PanelV2Props["tabTooltip"];
	readonly onRenameTab?: PanelV2Props["onRenameTab"];
	readonly preferencesFor?: (
		extensionId: ExtensionKind,
	) => AtelierExtensionPreferences;
}) {
	const activeInstance = area.activeInstance ?? area.views[0]?.instance ?? null;
	const availableViews = availableExtensionsForPanel(
		visibleExtensions,
		area,
		side,
	);
	const resolveViewDefinition = (kind: ExtensionKind) =>
		extensionMap.get(kind) ??
		visibleExtensions.find((definition) => definition.kind === kind) ??
		null;

	// After the "+" menu adds a view, focus moves to the new tab. Without this
	// the menu's close-focus lands back on the "+" and paints a stray
	// focus-visible ring there.
	const stripRef = useRef<HTMLDivElement | null>(null);
	// Closing a tab is the same act here as in a panel, so it keeps the
	// keyboard the same way: on the tab that takes over, or on "+" when the
	// strip empties.
	const handleRemoveView = useTabRemovalFocus({
		area,
		activeInstance,
		containerRef: stripRef,
		onRemoveView,
		fallbackSelectors: PANEL_REMOVAL_FOCUS_FALLBACKS,
	});
	const previousInstancesRef = useRef<ReadonlySet<string> | null>(null);
	const handleMenuAddView = (kind: ExtensionKind, state?: ExtensionState) => {
		previousInstancesRef.current = new Set(
			area.views.map((entry) => entry.instance),
		);
		onAddView?.(kind, state);
	};
	const focusAddedTab = () => {
		const previousInstances = previousInstancesRef.current;
		previousInstancesRef.current = null;
		const strip = stripRef.current;
		if (!previousInstances || !strip) return false;
		const addedTab = Array.from(
			strip.querySelectorAll<HTMLButtonElement>("button[data-view-instance]"),
		).find(
			(button) => !previousInstances.has(button.dataset.viewInstance ?? ""),
		);
		if (!addedTab) return false;
		// Move focus without painting a ring — adding a tab is not a keyboard
		// navigation moment, and the ring on the fresh tab read as a glitch.
		addedTab.focus({
			preventScroll: true,
			focusVisible: false,
		} as FocusOptions);
		return true;
	};

	return (
		<TabBar
			rootRef={stripRef}
			activeInstance={activeInstance}
			extraContent={
				onAddView ? (
					<AddViewMenu
						side={side}
						availableViews={availableViews}
						onAddView={handleMenuAddView}
						onSelectedViewSettled={focusAddedTab}
					/>
				) : null
			}
			height="topbar"
		>
			<SortableContext
				id={`panel-${side}`}
				items={area.views.map((entry) => entry.instance)}
				strategy={horizontalListSortingStrategy}
			>
				{area.views.map((entry, index) => {
					const view = resolveViewDefinition(entry.kind);
					if (!view) return null;
					const label = resolveLabel(view, entry, tabLabel);
					const closableOthers = area.views.filter(
						(sibling) =>
							!sibling.isPinned && sibling.instance !== entry.instance,
					);
					const closableRight = area.views
						.slice(index + 1)
						.filter((sibling) => !sibling.isPinned);
					const extensionMenuItems = resolveExtensionMenuItems(
						view,
						preferencesFor?.(entry.kind) ?? EMPTY_EXTENSION_PREFERENCES,
					);
					return (
						<SortableTab
							key={entry.instance}
							instance={entry.instance}
							area={side}
							kind={entry.kind}
							icon={fileGlyphForLabel(label) ?? view.icon}
							label={label}
							tooltip={
								tabTooltip?.(view, entry) ??
								(typeof entry.state?.filePath === "string"
									? entry.state.filePath
									: undefined)
							}
							isActive={activeInstance === entry.instance}
							isFocused={isFocused && activeInstance === entry.instance}
							isPending={entry.isPending}
							isPinned={entry.isPinned}
							onClick={() => onSelectView(entry.instance)}
							onClose={
								entry.isPinned
									? undefined
									: () => handleRemoveView(entry.instance)
							}
							onCloseOthers={
								closableOthers.length > 0
									? () => {
											for (const sibling of closableOthers) {
												handleRemoveView(sibling.instance);
											}
										}
									: undefined
							}
							onCloseRight={
								closableRight.length > 0
									? () => {
											for (const sibling of closableRight) {
												handleRemoveView(sibling.instance);
											}
										}
									: undefined
							}
							onRename={
								onRenameTab && typeof entry.state?.filePath === "string"
									? (nextName) => onRenameTab(entry, nextName)
									: undefined
							}
							extensionMenuItems={extensionMenuItems}
						/>
					);
				})}
			</SortableContext>
		</TabBar>
	);
}

/** The "+" button lists views that are not already open in this panel. */
function AddViewMenu({
	side,
	availableViews,
	onAddView,
	onSelectedViewSettled,
}: {
	readonly side: Area;
	readonly availableViews: readonly ExtensionDefinition[];
	readonly onAddView: (kind: ExtensionKind, state?: ExtensionState) => void;
	readonly onSelectedViewSettled: () => boolean;
}) {
	const selectedViewRef = useRef(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					ref={triggerRef}
					type="button"
					title="Add view"
					aria-label="Add view"
					data-attr="panel-add-view"
					className="flex size-[26px] flex-none items-center justify-center rounded-md text-fg-faint hover:bg-bg-hover-strong hover:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-panel"
				>
					<Plus aria-hidden="true" className="size-3.25" strokeWidth={2} />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align={side === "right" ? "end" : "start"}
				onCloseAutoFocus={(event) => {
					if (!selectedViewRef.current) return;
					selectedViewRef.current = false;
					event.preventDefault();
					window.setTimeout(() => {
						if (onSelectedViewSettled()) return;
						triggerRef.current?.focus({ preventScroll: true });
					}, 0);
				}}
				className="w-44 border border-border bg-panel p-1 shadow-lg"
			>
				{availableViews.length === 0 ? (
					<DropdownMenuItem
						disabled
						className="h-7 rounded-control px-2 text-xs font-medium text-fg-subtle"
					>
						No views available
					</DropdownMenuItem>
				) : (
					availableViews.map((ext) => (
						<DropdownMenuItem
							key={ext.kind}
							onSelect={() => {
								selectedViewRef.current = true;
								onAddView(ext.kind);
							}}
							className="h-7 rounded-control px-2 text-xs font-medium text-fg-muted focus:bg-bg-hover focus:text-fg"
						>
							<ext.icon className="h-4 w-4" />
							<span>{ext.label}</span>
						</DropdownMenuItem>
					))
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function availableExtensionsForPanel(
	visibleExtensions: readonly ExtensionDefinition[],
	area: AreaState,
	side?: Area,
): ExtensionDefinition[] {
	const openKinds = new Set(area.views.map((entry) => entry.kind));
	return visibleExtensions.filter(
		(view) =>
			(view.multiInstance || !openKinds.has(view.kind)) &&
			// Manifest placement gates the menus; the default is side areas only.
			(side === undefined ||
				view.placement === undefined ||
				view.placement.includes(side)),
	);
}

function DefaultPanelEmptyState({
	side,
	availableViews,
	onAddView,
}: {
	readonly side: Area;
	readonly availableViews: readonly ExtensionDefinition[];
	readonly onAddView: (kind: ExtensionKind, state?: ExtensionState) => void;
}) {
	const headingId = useId();
	const hasAvailableViews = availableViews.length > 0;
	const illustrationSide = side === "right" ? "right" : "left";
	const sideLabel =
		side === "main" ? "This is a panel." : `This is the ${side} sidebar.`;

	return (
		<div className="@container min-h-0 flex-1 overflow-y-auto">
			<div className="flex min-h-full items-center justify-center px-5 py-10 @max-[300px]:px-4 @max-[300px]:py-7">
				<section
					aria-labelledby={headingId}
					data-attr="panel-empty-state"
					data-area-side={side}
					className="flex w-full max-w-64 flex-col items-center pb-10 text-center @max-[300px]:max-w-56 @max-[300px]:pb-4"
				>
					<SidebarIllustration
						side={illustrationSide}
						className="w-40 max-w-full @max-[300px]:w-32"
					/>
					<h2
						id={headingId}
						className="mt-6 text-xl font-bold tracking-[-0.025em] text-fg @max-[300px]:mt-5 @max-[300px]:text-lg"
					>
						{hasAvailableViews ? sideLabel : "No views available"}
					</h2>
					<p className="mt-2 text-sm leading-5 text-fg-subtle">
						{hasAvailableViews
							? "Open a view to get started."
							: "Available views will appear here."}
					</p>
					{hasAvailableViews ? (
						// One chip per view: opening is a single click, and the chips
						// double as the list of what this sidebar can show.
						<div className="mt-7 flex flex-wrap items-center justify-center gap-2 @max-[300px]:mt-6">
							{availableViews.map((ext) => (
								<button
									key={ext.kind}
									type="button"
									data-attr="panel-empty-open-view"
									data-view-kind={ext.kind}
									onClick={() => onAddView(ext.kind)}
									className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong bg-panel px-3.5 text-[12.5px] font-semibold text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
								>
									<ext.icon className="size-3.5 text-fg-subtle" />
									{ext.label}
								</button>
							))}
						</div>
					) : null}
				</section>
			</div>
		</div>
	);
}

/**
 * Miniature of the workspace with the matching sidebar column highlighted, so
 * the empty state explains where the reader is standing.
 */
function SidebarIllustration({
	side,
	className,
}: {
	readonly side: "left" | "right";
	readonly className?: string;
}) {
	const columnX = side === "left" ? 7 : 107;
	const dividerX = side === "left" ? 53 : 107;
	const rowX = columnX + 8;
	const contentX = side === "left" ? 65 : 19;
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 160 104"
			fill="none"
		>
			<rect
				x="1"
				y="1"
				width="158"
				height="102"
				rx="10"
				fill="var(--atelier-panel)"
				stroke="var(--atelier-border)"
				strokeWidth="2"
			/>
			<rect
				x={columnX}
				y="7"
				width="46"
				height="90"
				rx="6"
				fill="var(--atelier-bg-hover-strong)"
			/>
			<line
				x1={dividerX}
				y1="7"
				x2={dividerX}
				y2="97"
				stroke="var(--atelier-border)"
				strokeWidth="1.5"
			/>
			{/* Sidebar rows — the top one active. */}
			<rect
				x={rowX}
				y="16"
				width="30"
				height="7"
				rx="3.5"
				fill="var(--atelier-link)"
			/>
			<rect
				x={rowX}
				y="31"
				width="24"
				height="7"
				rx="3.5"
				fill="var(--atelier-border-strong)"
			/>
			<rect
				x={rowX}
				y="46"
				width="27"
				height="7"
				rx="3.5"
				fill="var(--atelier-border)"
			/>
			{/* Document lines in the main area. */}
			<rect
				x={contentX}
				y="24"
				width="70"
				height="8"
				rx="4"
				fill="var(--atelier-border)"
			/>
			<rect
				x={contentX}
				y="41"
				width="46"
				height="8"
				rx="4"
				fill="var(--atelier-bg-hover)"
			/>
		</svg>
	);
}

const resolveLabel = (
	view: ExtensionDefinition,
	instance: ExtensionInstance,
	tabLabel?: PanelV2Props["tabLabel"],
): string => {
	if (tabLabel) {
		return tabLabel(view, instance);
	}
	return (instance.state?.atelier?.label as string | undefined) ?? view.label;
};

interface TabBarProps {
	readonly children: ReactNode;
	readonly extraContent?: ReactNode;
	/** Instance whose tab is kept scrolled into view. */
	readonly activeInstance?: string | null;
	readonly height?: "default" | "topbar";
	/** Exposes the strip's root element (e.g. to find a freshly added tab). */
	readonly rootRef?: RefObject<HTMLDivElement | null>;
}

function TabBar({
	children,
	extraContent,
	activeInstance,
	height = "default",
	rootRef,
}: TabBarProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [thumb, setThumb] = useState({ width: "0%", left: "0%" });
	const [thumbVisible, setThumbVisible] = useState(false);
	const [overflow, setOverflow] = useState({ left: false, right: false });
	const hideTimeoutRef = useRef<number | null>(null);

	const updateThumb = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const { scrollWidth, clientWidth, scrollLeft } = el;
		const overflowLeft = scrollLeft > 1;
		const overflowRight = scrollLeft < scrollWidth - clientWidth - 1;
		setOverflow((previous) =>
			previous.left === overflowLeft && previous.right === overflowRight
				? previous
				: { left: overflowLeft, right: overflowRight },
		);
		if (scrollWidth <= clientWidth) {
			setThumb({ width: "0%", left: "0%" });
			setThumbVisible(false);
			return;
		}
		const ratio = clientWidth / scrollWidth;
		const widthPercent = Math.max(ratio * 100, 10);
		const maxLeft = 100 - widthPercent;
		const leftPercent = Math.min(
			maxLeft,
			(scrollLeft / (scrollWidth - clientWidth)) * maxLeft,
		);
		setThumb({ width: `${widthPercent}%`, left: `${leftPercent}%` });
		setThumbVisible(true);
		if (hideTimeoutRef.current !== null) {
			window.clearTimeout(hideTimeoutRef.current);
		}
		hideTimeoutRef.current = window.setTimeout(
			() => setThumbVisible(false),
			250,
		);
	}, []);

	useLayoutEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		updateThumb();
		el.addEventListener("scroll", updateThumb);
		let resizeObserver: ResizeObserver | undefined;
		if (typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(updateThumb);
			resizeObserver.observe(el);
		}
		return () => {
			el.removeEventListener("scroll", updateThumb);
			resizeObserver?.disconnect();
			if (hideTimeoutRef.current !== null) {
				window.clearTimeout(hideTimeoutRef.current);
				hideTimeoutRef.current = null;
			}
		};
	}, [updateThumb]);

	useLayoutEffect(() => {
		updateThumb();
	}, [children, extraContent, updateThumb]);

	// Keep the active tab visible: a freshly added tab lands at the far end of
	// the strip and selection can land on a clipped chip. A margin leaves the
	// neighboring chip peeking out as the cue that the strip scrolls. Guarded
	// per instance so unrelated re-renders never fight a manual scroll.
	const lastEnsuredInstanceRef = useRef<string | null>(null);
	const hasScrolledRef = useRef(false);
	useLayoutEffect(() => {
		const container = scrollRef.current;
		if (!container || activeInstance == null) return;
		if (lastEnsuredInstanceRef.current === activeInstance) return;
		const tab = Array.from(
			container.querySelectorAll<HTMLButtonElement>(
				"button[data-view-instance]",
			),
		).find((button) => button.dataset.viewInstance === activeInstance);
		if (!tab) return;
		lastEnsuredInstanceRef.current = activeInstance;
		const behavior = hasScrolledRef.current
			? ("smooth" as const)
			: ("auto" as const);
		hasScrolledRef.current = true;
		// The margin only widens a scroll that is needed anyway (so the next
		// chip peeks out); a fully visible tab never triggers scrolling.
		const margin = 28;
		const tabStart = tab.offsetLeft;
		const tabEnd = tabStart + tab.offsetWidth;
		const viewStart = container.scrollLeft;
		const viewEnd = viewStart + container.clientWidth;
		if (tabStart < viewStart) {
			container.scrollTo({ left: Math.max(0, tabStart - margin), behavior });
		} else if (tabEnd > viewEnd) {
			container.scrollTo({
				left: tabEnd + margin - container.clientWidth,
				behavior,
			});
		}
	}, [activeInstance, children]);

	return (
		<div
			ref={rootRef}
			className={clsx(styles.tabBar, height === "topbar" && "h-[40px]")}
			data-height={height}
			data-overflow-left={overflow.left ? "true" : undefined}
			data-overflow-right={overflow.right ? "true" : undefined}
		>
			<div className={styles.indicatorTrack}>
				<div
					className={styles.indicatorThumb}
					style={{
						...thumb,
						opacity: thumbVisible ? 1 : 0,
						transition: "width 0.12s ease, left 0.12s ease, opacity 0.18s ease",
					}}
				/>
			</div>
			<div ref={scrollRef} className={styles.scrollContainer}>
				{children}
				{extraContent}
			</div>
		</div>
	);
}

/**
 * The mounted view each tab renders into, by tab instance.
 *
 * A view's identity in an area is its slot, not the document it shows. A tab
 * that navigates in place — the active tab replaced by another document,
 * which is how a review steps from one changed file to the next — keeps its
 * slot when the next document is handled by the same extension, so the
 * mounted view receives the new document as props instead of being torn
 * down around the shell's loading state and mounted again: its frame,
 * toolbar and layout stay where they are. Slot keys are opaque, so a
 * document reopened in a tab of its own never collides with the slot that
 * once showed it. The hand-over is limited to a diff session for now; plain
 * navigation still mounts every document fresh.
 */
type ViewHandover = {
	/** The tab instance arriving in the slot. */
	readonly incoming: string;
	/** The view it replaces, kept on screen until the arriving one has shown. */
	readonly outgoing: ExtensionInstance;
	readonly outgoingKey: string;
};

type ViewSlots = {
	readonly keys: ReadonlyMap<string, string>;
	/**
	 * A navigation in place to another extension: the leaving view has no
	 * successor to hand its document to, so it stays until the arriving one
	 * has read its own. Null when nothing is being handed over.
	 */
	readonly handover: ViewHandover | null;
};

function useViewSlots(
	views: readonly ExtensionInstance[],
	retainAcrossNavigation: boolean,
): ViewSlots {
	const memory = useRef<{
		views: readonly ExtensionInstance[];
		slots: ViewSlots;
		next: number;
	}>({ views: [], slots: { keys: new Map(), handover: null }, next: 0 });
	return useMemo(() => {
		const previous = memory.current;
		if (previous.views === views) return previous.slots;
		const keys = new Map<string, string>();
		let next = previous.next;
		let handover: ViewHandover | null = previous.slots.handover;
		const stillOpen = (instance: string) =>
			views.some((candidate) => candidate.instance === instance);
		if (
			handover &&
			(!stillOpen(handover.incoming) || stillOpen(handover.outgoing.instance))
		) {
			handover = null;
		}
		views.forEach((entry, index) => {
			const known = previous.slots.keys.get(entry.instance);
			if (known !== undefined) {
				keys.set(entry.instance, known);
				return;
			}
			const replaced = previous.views[index];
			const replacedKey =
				retainAcrossNavigation &&
				replaced !== undefined &&
				!stillOpen(replaced.instance)
					? previous.slots.keys.get(replaced.instance)
					: undefined;
			if (replacedKey !== undefined && replaced?.kind === entry.kind) {
				keys.set(entry.instance, replacedKey);
				return;
			}
			keys.set(entry.instance, `view-slot-${(next += 1)}`);
			if (replacedKey !== undefined && replaced) {
				handover = {
					incoming: entry.instance,
					outgoing: replaced,
					outgoingKey: replacedKey,
				};
			}
		});
		const slots = { keys, handover };
		memory.current = { views, slots, next };
		return slots;
	}, [retainAcrossNavigation, views]);
}

interface PanelContentProps extends HTMLAttributes<HTMLDivElement> {
	readonly children: ReactNode;
}

function PanelContent({
	children,
	className = "",
	...rest
}: PanelContentProps) {
	return (
		<div
			className={clsx(
				"relative flex min-h-0 flex-1 flex-col overflow-hidden",
				className,
			)}
			{...rest}
		>
			{children}
		</div>
	);
}

function ViewRenderer({
	view,
	instance,
	atelier,
	extensionView,
	side,
	isActive,
	onShown,
}: {
	view: ExtensionDefinition;
	instance: ExtensionInstance;
	atelier: ExtensionRuntime;
	extensionView: ExtensionView;
	side: Area;
	isActive: boolean;
	/** The view has its document on screen (or its error): a hand-over may end. */
	onShown?: () => void;
}) {
	const registry = useExtensionHostRegistry();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const hostRef = useRef<ExtensionHostRecord | null>(null);

	useLayoutEffect(() => {
		if (view.Component) return;
		hostRef.current = registry.ensureHost({
			view,
			instance,
			atelier,
			extensionView,
		});
	}, [registry, view, instance, atelier, extensionView]);

	useLayoutEffect(() => {
		const mountPoint = containerRef.current;
		const node = hostRef.current?.container;
		if (!mountPoint || !node) return;
		mountPoint.appendChild(node);
		return () => {
			if (node.parentElement === mountPoint) {
				mountPoint.removeChild(node);
			}
		};
	}, [registry, instance.instance]);

	return (
		<div
			ref={containerRef}
			data-testid={`atelier-view:${instance.instance}`}
			data-view-instance={instance.instance}
			data-view-key={instance.kind}
			data-area-side={side}
			data-active={isActive ? "true" : undefined}
			className="flex min-h-0 flex-1 flex-col overflow-hidden"
		>
			{view.Component ? (
				<DeclarativeExtension
					definition={view}
					atelier={atelier}
					view={extensionView}
					onShown={onShown}
				/>
			) : null}
		</div>
	);
}

interface SortableTabProps extends PanelTabPreviewProps {
	readonly instance: string;
	readonly area: Area;
	readonly kind: ExtensionKind;
	readonly onClick?: () => void;
	readonly onClose?: () => void;
	/** Close every closable sibling; absent when there is none. */
	readonly onCloseOthers?: () => void;
	/** Close every closable tab after this one; absent when there is none. */
	readonly onCloseRight?: () => void;
	readonly extensionMenuItems?: readonly AtelierExtensionMenuItem[];
	readonly isPending?: boolean;
	/**
	 * Renames the file this tab is on. Resolves false when the name is taken
	 * or refused, and the field stays open on it. Absent for a tab that is not
	 * a file, and for a read-only workspace.
	 */
	readonly onRename?: (nextName: string) => Promise<boolean>;
}

const tabMenuItemClasses =
	"gap-2 rounded-[6px] px-2 py-[5px] text-[12.5px] leading-tight text-fg-muted [&_svg]:size-3.25 [&_svg]:text-fg-subtle";

/**
 * Right-click menu for tab chips. Pinned tabs (no onClose) drop the Close
 * item but keep the bulk actions, which never touch pinned siblings.
 */
function TabContextMenu({
	children,
	extensionMenuItems = [],
	onRename,
	onClose,
	onCloseOthers,
	onCloseRight,
}: {
	readonly children: ReactNode;
	readonly extensionMenuItems?: readonly AtelierExtensionMenuItem[];
	readonly onRename?: () => void;
	readonly onClose?: () => void;
	readonly onCloseOthers?: () => void;
	readonly onCloseRight?: () => void;
}) {
	// Closing the menu hands focus back to the chip it was opened on. After
	// Rename that chip is a field, and the restore would take the focus off
	// it the moment it arrived.
	const renameSelected = useRef(false);
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent
				className="w-[182px] min-w-[182px] rounded-[9px] p-1 shadow-lg"
				data-attr="panel-tab-context-menu"
				onCloseAutoFocus={(event) => {
					if (!renameSelected.current) return;
					renameSelected.current = false;
					event.preventDefault();
				}}
			>
				{extensionMenuItems.length > 0 ? (
					<>
						<ExtensionContextMenuItems
							items={extensionMenuItems}
							itemClassName={tabMenuItemClasses}
							separatorClassName="mx-1.5 my-1"
						/>
						<ContextMenuSeparator className="mx-1.5 my-1 bg-border-subtle" />
					</>
				) : null}
				{onRename ? (
					<>
						<ContextMenuItem
							className={tabMenuItemClasses}
							onSelect={() => {
								renameSelected.current = true;
								onRename();
							}}
							data-attr="panel-tab-context-rename"
						>
							<Pencil aria-hidden="true" />
							Rename
						</ContextMenuItem>
						<ContextMenuSeparator className="mx-1.5 my-1 bg-border-subtle" />
					</>
				) : null}
				{onClose ? (
					<>
						<ContextMenuItem
							className={tabMenuItemClasses}
							onSelect={onClose}
							data-attr="panel-tab-context-close"
						>
							<X aria-hidden="true" />
							Close
						</ContextMenuItem>
						<ContextMenuSeparator className="mx-1.5 my-1 bg-border-subtle" />
					</>
				) : null}
				<ContextMenuItem
					className={tabMenuItemClasses}
					disabled={!onCloseOthers}
					onSelect={onCloseOthers}
					data-attr="panel-tab-context-close-others"
				>
					<CopyMinus aria-hidden="true" />
					Close other tabs
				</ContextMenuItem>
				<ContextMenuItem
					className={tabMenuItemClasses}
					disabled={!onCloseRight}
					onSelect={onCloseRight}
					data-attr="panel-tab-context-close-right"
				>
					<ArrowRightToLine aria-hidden="true" />
					Close tabs to the right
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function SortableTab({
	instance,
	area,
	kind,
	icon,
	label,
	tooltip,
	isActive,
	isFocused,
	isPending,
	isPinned,
	onClick,
	onClose,
	onCloseOthers,
	onCloseRight,
	extensionMenuItems,
	onRename,
}: SortableTabProps) {
	const [renaming, setRenaming] = useState(false);
	// The field replaces the chip, so ending the rename takes the focused
	// element out of the document: Enter and Escape left the keyboard on
	// `<body>` and the next Tab restarted at the top of the page. The chip
	// that comes back is where the rename started, so that is where the
	// keyboard goes — but only when the field still had it, because a rename
	// ended by clicking elsewhere must not pull the focus off what was clicked.
	const tabButtonRef = useRef<HTMLButtonElement | null>(null);
	const restoreFocusRef = useRef(false);
	useLayoutEffect(() => {
		if (renaming || !restoreFocusRef.current) return;
		restoreFocusRef.current = false;
		tabButtonRef.current?.focus({ preventScroll: true });
	}, [renaming]);
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: instance,
		disabled: isPinned,
		data: {
			type: "panel-tab",
			area: area,
			instance,
			kind,
			fromPanel: area,
		},
	});

	const style: CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	const setTabButtonRef = (node: HTMLButtonElement | null) => {
		tabButtonRef.current = node;
		setNodeRef(node);
	};

	// The field replaces the chip rather than sitting inside it: a tab is a
	// button, and a button is no place to type.
	if (renaming && onRename)
		return (
			<TabRenameField
				ref={setNodeRef}
				icon={icon}
				name={label}
				style={style}
				onRename={onRename}
				onDone={(keptFocus) => {
					restoreFocusRef.current = keptFocus;
					setRenaming(false);
				}}
			/>
		);

	return (
		<TabContextMenu
			extensionMenuItems={extensionMenuItems}
			onRename={onRename ? () => setRenaming(true) : undefined}
			onClose={onClose}
			onCloseOthers={onCloseOthers}
			onCloseRight={onCloseRight}
		>
			<TabButtonBase
				ref={setTabButtonRef}
				icon={icon}
				label={label}
				onRenameRequest={onRename ? () => setRenaming(true) : undefined}
				tooltip={tooltip}
				isActive={isActive}
				isFocused={isFocused}
				isPending={isPending}
				isPinned={isPinned}
				closeOnHoverOnly={area !== "main"}
				onClick={onClick}
				onClose={onClose}
				isDragging={isDragging}
				dataFocused={isFocused ? "true" : undefined}
				dataViewInstance={instance}
				dataViewKind={kind}
				style={style}
				// Pinned tabs are not draggable, but their navigation stays enabled.
				buttonProps={
					isPinned
						? undefined
						: {
								...(attributes as ButtonHTMLAttributes<HTMLButtonElement>),
								...(listeners as ButtonHTMLAttributes<HTMLButtonElement>),
							}
				}
			/>
		</TabContextMenu>
	);
}

/** Main document tabs show their file-type glyph, like a browser favicon. */
const fileGlyphForLabel = (label: string): TabIcon | null => {
	if (!/\.[a-z0-9]+$/i.test(label)) return null;
	const FileGlyph = ({ className }: { className?: string }) => (
		<img src={fileIconUrl(label)} alt="" className={className} />
	);
	return FileGlyph;
};

/**
 * The tab, as a field.
 *
 * It opens with the name selected up to the extension — the part anyone
 * means to change — commits on Enter or when it loses focus, gives up on
 * Escape, and stays open and marked when the name is taken, where the next
 * click away abandons the rename rather than asking again.
 */
const TabRenameField = forwardRef<
	HTMLSpanElement,
	{
		readonly icon: TabIcon;
		readonly name: string;
		readonly style?: CSSProperties;
		readonly onRename: (nextName: string) => Promise<boolean>;
		/**
		 * The rename is over. `keptFocus` says the field still had the keyboard
		 * as it closed — Enter or Escape, not a click elsewhere — so the chip
		 * taking its place is the one that should have it next.
		 */
		readonly onDone: (keptFocus: boolean) => void;
	}
>(({ icon: Icon, name, style, onRename, onDone }, ref) => {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [value, setValue] = useState(name);
	const [busy, setBusy] = useState(false);
	const [rejected, setRejected] = useState(false);
	const settled = useRef(false);
	// The menu's focus restore lands after the field mounts; a blur before
	// the field has had the focus at all is that, not the reader leaving.
	const focused = useRef(false);

	useEffect(() => {
		// The context menu hands focus back to the chip as it closes, and the
		// chip is gone: take the focus on the next frame, once it has.
		const frame = requestAnimationFrame(() => {
			const input = inputRef.current;
			if (!input) return;
			input.focus();
			const target = tabRenameTarget(name);
			input.setSelectionRange(0, target ? target.stem.length : name.length);
		});
		return () => cancelAnimationFrame(frame);
	}, [name]);

	// Whether the field still holds the keyboard is the caller's to say, not
	// `document.activeElement`'s: the field disables itself while the rename
	// is in flight, and disabling a focused input blurs it, so by the time a
	// commit settles the keyboard has left an input the reader never left.
	const finish = (keptFocus: boolean) => {
		if (settled.current) return;
		settled.current = true;
		onDone(keptFocus);
	};

	const commit = async (keptFocus: boolean) => {
		if (settled.current || busy) return;
		const next = value.trim();
		if (next.length === 0 || next === name) return finish(keptFocus);
		setBusy(true);
		const renamed = await onRename(next);
		setBusy(false);
		if (renamed) return finish(keptFocus);
		setRejected(true);
		// The field stays open on the refused name, so it takes the keyboard
		// back: `select()` alone marks the text in an input nothing is typing
		// into, because the disabled spell above blurred it.
		if (keptFocus) inputRef.current?.focus();
		inputRef.current?.select();
	};

	return (
		<span
			ref={ref}
			style={style}
			data-attr="panel-tab-rename"
			className={clsx(
				tabBaseClasses,
				tabStateClasses.focused,
				"gap-1.5 px-2.5",
				rejected && "border-danger",
			)}
		>
			<span
				data-tab-icon
				className="relative flex size-3.25 items-center justify-center"
			>
				<Icon className="size-3.25" />
			</span>
			<input
				ref={inputRef}
				value={value}
				aria-label="File name"
				aria-invalid={rejected || undefined}
				disabled={busy}
				spellCheck={false}
				autoComplete="off"
				data-attr="panel-tab-rename-input"
				style={{ width: `${Math.max(value.length, 6)}ch` }}
				className="max-w-40 min-w-0 bg-transparent text-[12.5px] font-semibold text-fg outline-none"
				onChange={(event) => {
					setRejected(false);
					setValue(event.target.value);
				}}
				onFocus={() => {
					focused.current = true;
				}}
				onBlur={() => {
					// A name the workspace refused is abandoned by clicking away;
					// asking again on every blur would be a trap.
					if (busy || !focused.current) return;
					// The keyboard has gone to whatever was clicked; the chip that
					// comes back must not take it off there.
					if (rejected) finish(false);
					else void commit(false);
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						void commit(true);
						return;
					}
					if (event.key === "Escape") {
						event.preventDefault();
						finish(true);
					}
				}}
			/>
		</span>
	);
});
TabRenameField.displayName = "TabRenameField";

const tabBaseClasses =
	"group relative flex h-7 flex-none max-w-80 items-center rounded-control border text-[12.5px] font-medium transition-[color,background-color,border-color,padding] duration-200 ease-out whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg";

const tabStateClasses = {
	// The visible view's chip always reads as a white card over the canvas;
	// keyboard focus adds a ring on top of the same look.
	focused:
		"border-border bg-panel font-semibold text-fg [&_[data-tab-icon]]:text-fg-muted",
	active:
		"border-border bg-panel font-semibold text-fg [&_[data-tab-icon]]:text-fg-muted",
	idle: "border-transparent bg-transparent text-fg-subtle hover:bg-bg-hover-strong hover:text-fg",
} as const;

interface TabBaseProps extends PanelTabPreviewProps {
	readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
	readonly onClose?: () => void;
	/** F2 on the focused chip, the shortcut a file tree renames with. */
	readonly onRenameRequest?: () => void;
	/**
	 * Side-panel chips reveal close as a corner badge on hover; main
	 * document tabs use an inline X when active and reveal it on hover otherwise.
	 */
	readonly closeOnHoverOnly?: boolean;
	readonly isDragging?: boolean;
	readonly dataFocused?: string;
	readonly dataViewInstance?: string;
	readonly dataViewKind?: string;
	readonly buttonProps?: ButtonHTMLAttributes<HTMLButtonElement> | null;
	readonly style?: CSSProperties;
}

const TabButtonBase = forwardRef<
	HTMLButtonElement,
	TabBaseProps & ButtonHTMLAttributes<HTMLButtonElement>
>(
	(
		{
			icon: Icon,
			label,
			tooltip,
			isActive,
			isFocused,
			isPending,
			isPinned,
			closeOnHoverOnly,
			onClick,
			onClose,
			onRenameRequest,
			isDragging,
			dataFocused,
			dataViewInstance,
			dataViewKind,
			buttonProps = null,
			style,
			className,
			onKeyDown: outerOnKeyDown,
			// Wrappers like the context-menu trigger slot extra DOM props onto
			// this button; they must reach the element for those to work.
			...rest
		},
		ref,
	) => {
		const state = isActive ? (isFocused ? "focused" : "active") : "idle";
		const {
			onClick: dragOnClick,
			onKeyDown: dragOnKeyDown,
			...restButtonProps
		} = buttonProps ?? {};
		// An inactive pinned tab compacts to its icon, like a browser home button.
		// Keep the label mounted so the native tab can animate between its full
		// and compact forms instead of popping in and out of the layout.
		const isCompact = isPinned && !isActive;
		return (
			<button
				type="button"
				// Named outright, not from its contents: the close control inside
				// carries a label of its own, and a name built from content would
				// read "one.md Close one.md".
				aria-label={label}
				// Which document is open was conveyed by colour alone.
				aria-current={isActive ? "true" : undefined}
				title={isCompact ? (tooltip ?? label) : undefined}
				onClick={(event) => {
					dragOnClick?.(event);
					onClick?.(event);
				}}
				onKeyDown={(event) => {
					outerOnKeyDown?.(event);
					if (event.key === "F2" && onRenameRequest) {
						event.preventDefault();
						onRenameRequest();
						return;
					}
					dragOnKeyDown?.(event);
				}}
				ref={ref}
				data-focused={dataFocused}
				data-view-instance={dataViewInstance}
				data-view-key={dataViewKind}
				data-pinned={isPinned ? "true" : undefined}
				className={clsx(
					tabBaseClasses,
					tabStateClasses[state],
					// A compact pinned tab is icon-only; center the icon so the chip
					// (and its hover fill) stays a square instead of a wide pill.
					isCompact ? "px-[6.5px]" : "px-2.5",
					// The label animates via margin, so pinned tabs opt out of gap;
					// the classes are mutually exclusive because stylesheet order,
					// not clsx order, would decide a gap-1.5/gap-0 conflict.
					isPinned ? "gap-0" : "gap-1.5",
					isDragging && "opacity-50 cursor-grabbing",
					className,
				)}
				style={style}
				{...restButtonProps}
				{...rest}
			>
				<span
					data-tab-icon
					data-attr="panel-tab-select"
					className="relative flex size-3.25 items-center justify-center"
				>
					<Icon className="size-3.25" />
				</span>
				<span
					data-attr="panel-tab-select"
					aria-hidden={isCompact ? true : undefined}
					className={clsx(
						"overflow-hidden truncate whitespace-nowrap transition-[max-width,opacity,margin-left] duration-200 ease-out",
						isPinned
							? isCompact
								? "ml-0 max-w-0 opacity-0"
								: "ml-1.5 max-w-[10rem] opacity-100"
							: "max-w-[10rem]",
						isPending && "italic",
					)}
					title={tooltip ?? label}
				>
					{label}
				</span>
				{/* Side-panel tabs keep their floating hover affordance. Active
				    main tabs reserve inline space, while inactive main tabs
				    reveal an overlay without changing width. */}
				{isPinned || isCompact || !onClose ? null : closeOnHoverOnly ? (
					// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- The tab button owns the keyboard, and its context menu (Shift+F10) carries Close; a focus stop on every × would double the strip's tab ring. The role and the label are here so the affordance is announced at all.
					<span
						role="button"
						aria-label={`Close ${label}`}
						className="absolute -top-1 -right-1 z-10 hidden size-3.5 items-center justify-center rounded-full border border-border bg-panel text-fg-subtle shadow-sm transition-colors group-hover:flex group-focus-visible:flex hover:bg-bg-hover hover:text-fg-muted"
						onClick={(event) => {
							event.stopPropagation();
							onClose();
						}}
					>
						<X data-attr="panel-tab-close" className="size-[9px]" />
					</span>
				) : isActive ? (
					// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- The tab button owns the keyboard, and its context menu (Shift+F10) carries Close; a focus stop on every × would double the strip's tab ring. The role and the label are here so the affordance is announced at all.
					<span
						role="button"
						aria-label={`Close ${label}`}
						className="ml-0.5 flex size-4 flex-none items-center justify-center rounded-[4px] text-fg-subtle transition-colors hover:text-fg-muted"
						onClick={(event) => {
							event.stopPropagation();
							onClose();
						}}
					>
						<X data-attr="panel-tab-close" className="size-[11px]" />
					</span>
				) : (
					<>
						<span
							aria-hidden="true"
							data-attr="panel-tab-close-fade"
							className="pointer-events-none absolute inset-y-0 right-1.5 z-[1] w-12 bg-[linear-gradient(to_right,transparent_0%,var(--atelier-bg-hover-strong)_72%)] opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
						/>
						{/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- The tab button owns the keyboard, and its context menu (Shift+F10) carries Close; a focus stop on every × would double the strip's tab ring. The role and the label are here so the affordance is announced at all. */}
						<span
							role="button"
							aria-label={`Close ${label}`}
							className="pointer-events-none absolute right-1.5 top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-[5px] bg-bg-hover-strong text-fg-subtle opacity-0 transition-opacity duration-150 ease-out group-hover:pointer-events-auto group-hover:opacity-100 group-focus-visible:pointer-events-auto group-focus-visible:opacity-100 hover:text-fg-muted"
							onClick={(event) => {
								event.stopPropagation();
								onClose();
							}}
						>
							<X data-attr="panel-tab-close" className="size-[11px]" />
						</span>
					</>
				)}
			</button>
		);
	},
);

TabButtonBase.displayName = "PanelTabButton";

export type PanelTabPreviewProps = {
	readonly icon: TabIcon;
	readonly label: string;
	/** Hover text when it should say more than the label (a file's full path). */
	readonly tooltip?: string;
	readonly isActive: boolean;
	readonly isFocused: boolean;
	readonly isPending?: boolean;
	readonly isPinned?: boolean;
};

export function PanelTabPreview(props: PanelTabPreviewProps) {
	return <TabButtonBase {...props} />;
}
