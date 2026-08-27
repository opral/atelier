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
import type {
	PanelSide,
	PanelState,
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
	panel,
	isFocused,
	onFocusPanel,
	onSelectView,
	onRemoveView,
	onAddView,
	onHidePanel,
	viewContext,
	tabLabel,
	emptyStatePlaceholder,
	onActiveViewInteraction,
	dropId,
	viewOverrides,
	showTabBar = side === "central",
	tabBarExtraContent,
	customTabStrip,
	contentVisible = true,
}: PanelV2Props) {
	const { extensionMap, visibleExtensions } = useExtensionRegistry();
	const { setNodeRef, isOver } = useDroppable({
		id: dropId ?? `${side}-panel`,
		data: { panel: side },
	});

	const activeEntry = panel.activeInstance
		? (panel.views.find((entry) => entry.instance === panel.activeInstance) ??
			null)
		: (panel.views[0] ?? null);

	const resolveViewDefinition = useCallback(
		(kind: ExtensionKind): ExtensionDefinition | null => {
			const override = viewOverrides?.find(
				(candidate) => candidate.kind === kind,
			);
			return override ?? extensionMap.get(kind) ?? null;
		},
		[viewOverrides, extensionMap],
	);

	const hasViews = panel.views.length > 0;
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
		() => availableExtensionsForPanel(visibleExtensions, panel, side),
		[panel, side, visibleExtensions],
	);
	const panelElementRef = useRef<HTMLElement | null>(null);
	const pendingAddedViewRef = useRef<{
		readonly kind: ExtensionKind;
		readonly focusAfterMenuClose: boolean;
		readonly previousInstances: ReadonlySet<string>;
		readonly previousViews: PanelState["views"];
		readonly previousActiveInstance: string | null;
	} | null>(null);
	const pendingRemovalFocusRef = useRef<{
		readonly instance: string;
		readonly previousViews: PanelState["views"];
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
				previousInstances: new Set(panel.views.map((entry) => entry.instance)),
				previousViews: panel.views,
				previousActiveInstance: panel.activeInstance,
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
		[onAddView, panel.activeInstance, panel.views],
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
	const handleRemoveView = useCallback(
		(instance: string) => {
			const pendingRemovalFocus = {
				instance,
				previousViews: panel.views,
				previousActiveInstance: panel.activeInstance,
			};
			pendingRemovalFocusRef.current = pendingRemovalFocus;
			onRemoveView(instance);
			window.setTimeout(() => {
				if (pendingRemovalFocusRef.current === pendingRemovalFocus) {
					pendingRemovalFocusRef.current = null;
				}
			}, 0);
		},
		[onRemoveView, panel.activeInstance, panel.views],
	);
	const { makeRuntime } = useExtensionViewRuntime({
		panel,
		panelSide: side,
		isFocused,
		host: viewContext,
	});

	const viewContexts = useMemo(() => {
		const map = new Map<string, ReturnType<typeof makeRuntime>>();
		for (const entry of panel.views) {
			map.set(entry.instance, makeRuntime(entry));
		}
		return map;
	}, [panel.views, makeRuntime]);

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
		side === "central" ? ("section" as const) : ("aside" as const);
	const hostTextClass =
		side === "central"
			? "text-[var(--color-text-primary)]"
			: "text-[var(--color-text-secondary)]";

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
			const addedEntry = panel.views.find(
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
				panel.views !== pendingAddedView.previousViews ||
				panel.activeInstance !== pendingAddedView.previousActiveInstance
			) {
				pendingAddedViewRef.current = null;
			}
		}

		const pendingRemovalFocus = pendingRemovalFocusRef.current;
		if (!pendingRemovalFocus) return;
		if (
			panel.views.some(
				(entry) => entry.instance === pendingRemovalFocus.instance,
			)
		) {
			if (
				panel.views !== pendingRemovalFocus.previousViews ||
				panel.activeInstance !== pendingRemovalFocus.previousActiveInstance
			) {
				pendingRemovalFocusRef.current = null;
			}
			return;
		}
		pendingRemovalFocusRef.current = null;
		const nextTarget = activeInstance
			? findTab(activeInstance)
			: (panelElement.querySelector<HTMLButtonElement>(
					'[data-attr="panel-empty-open-view"]',
				) ??
				panelElement.querySelector<HTMLButtonElement>(
					'[data-attr="panel-section-picker"]',
				) ??
				panelElement.querySelector<HTMLButtonElement>(
					'[data-attr="panel-add-view"]',
				));
		nextTarget?.focus({ preventScroll: true });
	}, [activeInstance, panel.activeInstance, panel.views]);

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
	const sideSectionPicker =
		side !== "central" && hasViews ? (
			<SidebarSectionPicker
				side={side}
				panel={panel}
				availableViews={availableViews}
				resolveViewDefinition={resolveViewDefinition}
				preferencesFor={viewContext.preferencesFor}
				onSelectView={onSelectView}
				onAddView={onAddView}
				onHidePanel={onHidePanel}
				tabLabel={tabLabel}
			/>
		) : null;

	return (
		<ContainerElement
			ref={setPanelElementRef}
			aria-label={ariaLabel}
			onClickCapture={() => onFocusPanel(side)}
			className={clsx("flex h-full w-full flex-col", hostTextClass)}
		>
			{sideSectionPicker}
			{/* Central tabs remain the only document tab strip. Side panels use the
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
						items={panel.views.map((entry) => entry.instance)}
						strategy={horizontalListSortingStrategy}
					>
						{panel.views.map((entry) => {
							const view = resolveViewDefinition(entry.kind);
							if (!view) return null;
							const isActive = activeInstance === entry.instance;
							const label = resolveLabel(view, entry, tabLabel);
							return (
								<SortableTab
									key={entry.instance}
									instance={entry.instance}
									panelSide={side}
									kind={entry.kind}
									icon={
										side === "central"
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
								/>
							);
						})}
					</SortableContext>
				</TabBar>
			) : null}

			{/* Every panel body shares the island geometry (rounded corners) so
			    the sides align with the central editor, but only central is the
			    elevated white surface with a border. Side islands are invisible —
			    the canvas shows through and their views style themselves for
			    that surface. */}
			<div
				className={clsx(
					"flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px]",
					side === "central"
						? "border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)]"
						: "bg-transparent",
					isOver && "ring-2 ring-[var(--color-ring-focus-visible)] ring-inset",
				)}
			>
				{hasViews ? (
					<PanelContent {...contentHandlers}>
						{panel.views.map((entry) => {
							const isActive = activeInstance === entry.instance;
							if (
								!(contentVisible && isActive) &&
								!mountedInstances.has(entry.instance)
							) {
								return null;
							}
							const view = resolveViewDefinition(entry.kind);
							if (!view) return null;
							const context = viewContexts.get(entry.instance);
							if (!context) return null;
							return (
								<div
									key={entry.instance}
									className={isActive ? "contents" : "hidden"}
									aria-hidden={isActive ? undefined : true}
								>
									<ViewRenderer
										view={view}
										instance={entry}
										atelier={context.atelier}
										extensionView={context.view}
										side={side}
										isActive={isActive}
									/>
								</div>
							);
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
	readonly side: PanelSide;
	readonly ariaLabel?: string;
	readonly panel: PanelState;
	readonly isFocused: boolean;
	readonly onFocusPanel: (side: PanelSide) => void;
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
	readonly emptyStatePlaceholder?: ReactNode;
	readonly onActiveViewInteraction?: (instance: string) => void;
	readonly dropId?: string;
	readonly viewOverrides?: ExtensionDefinition[];
	/**
	 * Renders a tab strip inside the panel body. The workspace never sets this:
	 * document tabs live in the top bar (`PanelTabStrip`) and side panels use
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
	"h-[30px] rounded-md px-2 text-[12.5px] font-normal text-[var(--color-text-secondary)] focus:bg-[var(--color-bg-hover)] focus:text-[var(--color-text-primary)]";
const sectionPickerIconClasses = "size-3.25 text-[var(--color-icon-tertiary)]";
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
	panel,
	availableViews,
	resolveViewDefinition,
	preferencesFor,
	onSelectView,
	onAddView,
	onHidePanel,
	tabLabel,
}: {
	readonly side: Exclude<PanelSide, "central">;
	readonly panel: PanelState;
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
}) {
	const activeEntry =
		panel.views.find((entry) => entry.instance === panel.activeInstance) ??
		panel.views[0] ??
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
					className="group/section flex w-fit items-center gap-[5px] self-start rounded-[5px] px-1.5 py-1 text-[11px] font-bold uppercase tracking-[0.07em] text-[var(--color-text-quaternary)] transition-colors hover:text-[var(--color-neutral-600)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] data-[state=open]:text-[var(--color-neutral-600)]"
				>
					<span>{activeLabel}</span>
					<ChevronDown
						aria-hidden="true"
						className="size-2.25 text-[var(--color-icon-quaternary)] transition-[transform,color] group-hover/section:text-[var(--color-neutral-600)] group-data-[state=open]/section:rotate-180 group-data-[state=open]/section:text-[var(--color-neutral-600)]"
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
				className="w-[212px] rounded-[10px] border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] p-1.5 shadow-lg"
			>
				{/* Open views and openable views read as one list: the picker answers
				    "what is this sidebar showing?", not "what is already loaded?". */}
				{panel.views.map((entry) => {
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
								isActive &&
									"bg-[var(--color-bg-hover)] font-semibold text-[var(--color-text-primary)]",
							)}
						>
							<definition.icon
								className={clsx(
									"size-3.25",
									isActive
										? "text-[var(--color-icon-secondary)]"
										: "text-[var(--color-icon-tertiary)]",
								)}
							/>
							<span className="truncate">{label}</span>
							{isActive ? (
								<Check
									aria-hidden="true"
									className="ml-auto size-3 text-[var(--color-icon-brand)]"
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
						<div className="my-1.5 mx-1 h-px bg-[var(--color-border-subtle)]" />
						<ExtensionDropdownMenuItems
							items={extensionMenuItems}
							itemClassName={sectionPickerItemClasses}
							separatorClassName="mx-1 my-1"
						/>
					</>
				) : null}
				{onHidePanel ? (
					<>
						<div className="my-1.5 mx-1 h-px bg-[var(--color-border-subtle)]" />
						<DropdownMenuItem
							onSelect={() => onHidePanel()}
							className={sectionPickerItemClasses}
						>
							<PanelIcon side={side} className={sectionPickerIconClasses} />
							<span>Hide sidebar</span>
							<span className="ml-auto text-[11px] font-medium text-[var(--color-text-quaternary)]">
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
 * workspace uses this for central document tabs in the top bar; it is the
 * workspace's only tab strip. Side panels use the section picker instead, so
 * their views never read as open documents.
 */
export function PanelTabStrip({
	side,
	panel,
	visibleExtensions,
	extensionMap,
	isFocused,
	onSelectView,
	onRemoveView,
	onAddView,
	tabLabel,
	preferencesFor,
}: {
	readonly side: PanelSide;
	readonly panel: PanelState;
	readonly visibleExtensions: readonly ExtensionDefinition[];
	readonly extensionMap: ReadonlyMap<ExtensionKind, ExtensionDefinition>;
	readonly isFocused: boolean;
	readonly onSelectView: (instance: string) => void;
	readonly onRemoveView: (instance: string) => void;
	/** Enables the trailing "+" — the same view menu the sidebars offer. */
	readonly onAddView?: (kind: ExtensionKind, state?: ExtensionState) => void;
	readonly tabLabel?: PanelV2Props["tabLabel"];
	readonly preferencesFor?: (
		extensionId: ExtensionKind,
	) => AtelierExtensionPreferences;
}) {
	const activeInstance =
		panel.activeInstance ?? panel.views[0]?.instance ?? null;
	const availableViews = availableExtensionsForPanel(
		visibleExtensions,
		panel,
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
	const previousInstancesRef = useRef<ReadonlySet<string> | null>(null);
	const handleMenuAddView = (kind: ExtensionKind, state?: ExtensionState) => {
		previousInstancesRef.current = new Set(
			panel.views.map((entry) => entry.instance),
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
				items={panel.views.map((entry) => entry.instance)}
				strategy={horizontalListSortingStrategy}
			>
				{panel.views.map((entry, index) => {
					const view = resolveViewDefinition(entry.kind);
					if (!view) return null;
					const label = resolveLabel(view, entry, tabLabel);
					const closableOthers = panel.views.filter(
						(sibling) =>
							!sibling.isPinned && sibling.instance !== entry.instance,
					);
					const closableRight = panel.views
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
							panelSide={side}
							kind={entry.kind}
							icon={fileGlyphForLabel(label) ?? view.icon}
							label={label}
							isActive={activeInstance === entry.instance}
							isFocused={isFocused && activeInstance === entry.instance}
							isPending={entry.isPending}
							isPinned={entry.isPinned}
							onClick={() => onSelectView(entry.instance)}
							onClose={
								entry.isPinned ? undefined : () => onRemoveView(entry.instance)
							}
							onCloseOthers={
								closableOthers.length > 0
									? () => {
											for (const sibling of closableOthers) {
												onRemoveView(sibling.instance);
											}
										}
									: undefined
							}
							onCloseRight={
								closableRight.length > 0
									? () => {
											for (const sibling of closableRight) {
												onRemoveView(sibling.instance);
											}
										}
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
	readonly side: PanelSide;
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
					className="flex size-[26px] flex-none items-center justify-center rounded-md text-[var(--color-icon-quaternary)] hover:bg-[var(--color-bg-hover-canvas)] hover:text-[var(--color-icon-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg-panel)]"
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
				className="w-44 border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] p-1 shadow-lg"
			>
				{availableViews.length === 0 ? (
					<DropdownMenuItem
						disabled
						className="h-7 rounded-[7px] px-2 text-xs font-medium text-[var(--color-text-tertiary)]"
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
							className="h-7 rounded-[7px] px-2 text-xs font-medium text-[var(--color-text-secondary)] focus:bg-[var(--color-bg-hover)] focus:text-[var(--color-text-primary)]"
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
	panel: PanelState,
	side?: PanelSide,
): ExtensionDefinition[] {
	const openKinds = new Set(panel.views.map((entry) => entry.kind));
	return visibleExtensions.filter(
		(view) =>
			(view.multiInstance || !openKinds.has(view.kind)) &&
			// Manifest placement gates the menus; the default is side panels only.
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
	readonly side: PanelSide;
	readonly availableViews: readonly ExtensionDefinition[];
	readonly onAddView: (kind: ExtensionKind, state?: ExtensionState) => void;
}) {
	const headingId = useId();
	const hasAvailableViews = availableViews.length > 0;
	const illustrationSide = side === "right" ? "right" : "left";
	const sideLabel =
		side === "central" ? "This is a panel." : `This is the ${side} sidebar.`;

	return (
		<div className="@container min-h-0 flex-1 overflow-y-auto">
			<div className="flex min-h-full items-center justify-center px-5 py-10 @max-[300px]:px-4 @max-[300px]:py-7">
				<section
					aria-labelledby={headingId}
					data-attr="panel-empty-state"
					data-panel-side={side}
					className="flex w-full max-w-64 flex-col items-center pb-10 text-center @max-[300px]:max-w-56 @max-[300px]:pb-4"
				>
					<SidebarIllustration
						side={illustrationSide}
						className="w-40 max-w-full @max-[300px]:w-32"
					/>
					<h2
						id={headingId}
						className="mt-6 text-xl font-bold tracking-[-0.025em] text-[var(--color-text-primary)] @max-[300px]:mt-5 @max-[300px]:text-lg"
					>
						{hasAvailableViews ? sideLabel : "No views available"}
					</h2>
					<p className="mt-2 text-sm leading-5 text-[var(--color-text-tertiary)]">
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
									className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--color-border-action-secondary)] bg-[var(--color-bg-panel)] px-3.5 text-[12.5px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg-app)]"
								>
									<ext.icon className="size-3.5 text-[var(--color-icon-tertiary)]" />
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
				fill="var(--color-bg-panel)"
				stroke="var(--color-border-panel)"
				strokeWidth="2"
			/>
			<rect
				x={columnX}
				y="7"
				width="46"
				height="90"
				rx="6"
				fill="var(--color-bg-hover-canvas)"
			/>
			<line
				x1={dividerX}
				y1="7"
				x2={dividerX}
				y2="97"
				stroke="var(--color-border-panel)"
				strokeWidth="1.5"
			/>
			{/* Sidebar rows — the top one active. */}
			<rect
				x={rowX}
				y="16"
				width="30"
				height="7"
				rx="3.5"
				fill="var(--color-brand-400)"
			/>
			<rect
				x={rowX}
				y="31"
				width="24"
				height="7"
				rx="3.5"
				fill="var(--color-neutral-300)"
			/>
			<rect
				x={rowX}
				y="46"
				width="27"
				height="7"
				rx="3.5"
				fill="var(--color-neutral-200)"
			/>
			{/* Document lines in the main area. */}
			<rect
				x={contentX}
				y="24"
				width="70"
				height="8"
				rx="4"
				fill="var(--color-neutral-200)"
			/>
			<rect
				x={contentX}
				y="41"
				width="46"
				height="8"
				rx="4"
				fill="var(--color-neutral-100)"
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
			className={clsx(styles.tabBar, height === "topbar" && "h-[46px]")}
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
				"flex min-h-0 flex-1 flex-col overflow-hidden",
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
}: {
	view: ExtensionDefinition;
	instance: ExtensionInstance;
	atelier: ExtensionRuntime;
	extensionView: ExtensionView;
	side: PanelSide;
	isActive: boolean;
}) {
	const registry = useExtensionHostRegistry();
	const containerRef = useRef<HTMLDivElement | null>(null);
	const hostRef = useRef<ExtensionHostRecord | null>(null);

	useLayoutEffect(() => {
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
			data-panel-side={side}
			data-active={isActive ? "true" : undefined}
			className="flex min-h-0 flex-1 flex-col overflow-hidden"
		/>
	);
}

interface SortableTabProps extends PanelTabPreviewProps {
	readonly instance: string;
	readonly panelSide: PanelSide;
	readonly kind: ExtensionKind;
	readonly onClick?: () => void;
	readonly onClose?: () => void;
	/** Close every closable sibling; absent when there is none. */
	readonly onCloseOthers?: () => void;
	/** Close every closable tab after this one; absent when there is none. */
	readonly onCloseRight?: () => void;
	readonly extensionMenuItems?: readonly AtelierExtensionMenuItem[];
	readonly isPending?: boolean;
}

const tabMenuItemClasses =
	"gap-2 rounded-[6px] px-2 py-[5px] text-[12.5px] leading-tight text-[var(--color-text-secondary)] [&_svg]:size-3.25 [&_svg]:text-[var(--color-icon-tertiary)]";

/**
 * Right-click menu for tab chips. Pinned tabs (no onClose) drop the Close
 * item but keep the bulk actions, which never touch pinned siblings.
 */
function TabContextMenu({
	children,
	extensionMenuItems = [],
	onClose,
	onCloseOthers,
	onCloseRight,
}: {
	readonly children: ReactNode;
	readonly extensionMenuItems?: readonly AtelierExtensionMenuItem[];
	readonly onClose?: () => void;
	readonly onCloseOthers?: () => void;
	readonly onCloseRight?: () => void;
}) {
	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
			<ContextMenuContent
				className="w-[182px] min-w-[182px] rounded-[9px] p-1 shadow-lg"
				data-attr="panel-tab-context-menu"
			>
				{extensionMenuItems.length > 0 ? (
					<>
						<ExtensionContextMenuItems
							items={extensionMenuItems}
							itemClassName={tabMenuItemClasses}
							separatorClassName="mx-1.5 my-1"
						/>
						<ContextMenuSeparator className="mx-1.5 my-1 bg-[var(--color-border-subtle)]" />
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
						<ContextMenuSeparator className="mx-1.5 my-1 bg-[var(--color-border-subtle)]" />
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
	panelSide,
	kind,
	icon,
	label,
	isActive,
	isFocused,
	isPending,
	isPinned,
	onClick,
	onClose,
	onCloseOthers,
	onCloseRight,
	extensionMenuItems,
}: SortableTabProps) {
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
			panel: panelSide,
			instance,
			kind,
			fromPanel: panelSide,
		},
	});

	const style: CSSProperties = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<TabContextMenu
			extensionMenuItems={extensionMenuItems}
			onClose={onClose}
			onCloseOthers={onCloseOthers}
			onCloseRight={onCloseRight}
		>
			<TabButtonBase
				ref={setNodeRef}
				icon={icon}
				label={label}
				isActive={isActive}
				isFocused={isFocused}
				isPending={isPending}
				isPinned={isPinned}
				closeOnHoverOnly={panelSide !== "central"}
				onClick={onClick}
				onClose={onClose}
				isDragging={isDragging}
				dataFocused={isFocused ? "true" : undefined}
				dataViewInstance={instance}
				dataViewKind={kind}
				style={style}
				buttonProps={{
					...(attributes as ButtonHTMLAttributes<HTMLButtonElement>),
					...(listeners as ButtonHTMLAttributes<HTMLButtonElement>),
				}}
			/>
		</TabContextMenu>
	);
}

/** Central document tabs show their file-type glyph, like a browser favicon. */
const fileGlyphForLabel = (label: string): TabIcon | null => {
	if (!/\.[a-z0-9]+$/i.test(label)) return null;
	const FileGlyph = ({ className }: { className?: string }) => (
		<img src={fileIconUrl(label)} alt="" className={className} />
	);
	return FileGlyph;
};

const tabBaseClasses =
	"group relative flex h-7 flex-none max-w-80 items-center rounded-[7px] border text-[12.5px] font-medium transition-[color,background-color,border-color,padding] duration-200 ease-out whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg-app)]";

const tabStateClasses = {
	// The visible view's chip always reads as a white card over the canvas;
	// keyboard focus adds a ring on top of the same look.
	focused:
		"border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] font-semibold text-[var(--color-text-primary)] [&_[data-tab-icon]]:text-[var(--color-icon-secondary)]",
	active:
		"border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] font-semibold text-[var(--color-text-primary)] [&_[data-tab-icon]]:text-[var(--color-icon-secondary)]",
	idle: "border-transparent bg-transparent text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover-canvas)] hover:text-[var(--color-text-primary)]",
} as const;

interface TabBaseProps extends PanelTabPreviewProps {
	readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
	readonly onClose?: () => void;
	/**
	 * Side-panel chips reveal close as a corner badge on hover; central
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
			isActive,
			isFocused,
			isPending,
			isPinned,
			closeOnHoverOnly,
			onClick,
			onClose,
			isDragging,
			dataFocused,
			dataViewInstance,
			dataViewKind,
			buttonProps = null,
			style,
			className,
			// Wrappers like the context-menu trigger slot extra DOM props onto
			// this button; they must reach the element for those to work.
			...rest
		},
		ref,
	) => {
		const state = isActive ? (isFocused ? "focused" : "active") : "idle";
		const { onClick: dragOnClick, ...restButtonProps } = buttonProps ?? {};
		// An inactive pinned tab compacts to its icon, like a browser home button.
		// Keep the label mounted so the native tab can animate between its full
		// and compact forms instead of popping in and out of the layout.
		const isCompact = isPinned && !isActive;
		return (
			<button
				type="button"
				aria-label={isCompact ? label : undefined}
				title={isCompact ? label : undefined}
				onClick={(event) => {
					dragOnClick?.(event);
					onClick?.(event);
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
					title={label}
				>
					{label}
				</span>
				{/* Side-panel tabs keep their floating hover affordance. Active
				    central tabs reserve inline space, while inactive central tabs
				    reveal an overlay without changing width. */}
				{isPinned || isCompact || !onClose ? null : closeOnHoverOnly ? (
					<span
						className="absolute -top-1 -right-1 z-10 hidden size-3.5 items-center justify-center rounded-full border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] text-[var(--color-icon-tertiary)] shadow-sm transition-colors group-hover:flex group-focus-visible:flex hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-icon-secondary)]"
						onClick={(event) => {
							event.stopPropagation();
							onClose();
						}}
					>
						<X data-attr="panel-tab-close" className="size-[9px]" />
					</span>
				) : isActive ? (
					<span
						className="ml-0.5 flex size-4 flex-none items-center justify-center rounded-[4px] text-[var(--color-icon-tertiary)] transition-colors hover:text-[var(--color-icon-secondary)]"
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
							className="pointer-events-none absolute inset-y-0 right-1.5 z-[1] w-12 bg-[linear-gradient(to_right,transparent_0%,var(--color-bg-hover-canvas)_72%)] opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
						/>
						<span
							className="pointer-events-none absolute right-1.5 top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-[5px] bg-[var(--color-bg-hover-canvas)] text-[var(--color-icon-tertiary)] opacity-0 transition-opacity duration-150 ease-out group-hover:pointer-events-auto group-hover:opacity-100 group-focus-visible:pointer-events-auto group-focus-visible:opacity-100 hover:text-[var(--color-icon-secondary)]"
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
	readonly isActive: boolean;
	readonly isFocused: boolean;
	readonly isPending?: boolean;
	readonly isPinned?: boolean;
};

export function PanelTabPreview(props: PanelTabPreviewProps) {
	return <TabButtonBase {...props} />;
}
