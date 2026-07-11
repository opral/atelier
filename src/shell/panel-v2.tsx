import clsx from "clsx";
import {
	forwardRef,
	useCallback,
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
} from "react";
import { useDroppable } from "@dnd-kit/core";
import {
	SortableContext,
	useSortable,
	horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, X } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
	useExtensionHostRegistry,
	type ExtensionHostRecord,
} from "../extension-runtime/extension-host-registry";
import { Activity } from "react";

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
	panel,
	isFocused,
	onFocusPanel,
	onSelectView,
	onRemoveView,
	onAddView,
	viewContext,
	tabLabel,
	emptyStatePlaceholder,
	onActiveViewInteraction,
	dropId,
	viewOverrides,
	showTabBar = true,
}: PanelV2Props) {
	const { extensionMap } = useExtensionRegistry();
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

	const handleInteraction = () => {
		if (!onActiveViewInteraction || !activeInstance) return;
		onActiveViewInteraction(activeInstance);
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

	return (
		<ContainerElement
			ref={setNodeRef}
			onClickCapture={() => onFocusPanel(side)}
			className={clsx("flex h-full w-full flex-col", hostTextClass)}
		>
			<div
				className={clsx(
					"flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)]",
					isOver && "ring-2 ring-[var(--color-ring-focus-visible)] ring-inset",
				)}
			>
				{/* Most islands render the identical 40px tab row; the central
				    editor hides it and switches files from the left file list. */}
				{showTabBar ? (
					<TabBar
						extraContent={
							onAddView ? (
								<AddViewMenu side={side} panel={panel} onAddView={onAddView} />
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
										icon={view.icon}
										label={label}
										isActive={isActive}
										isFocused={isFocused && isActive}
										isPending={entry.isPending}
										onClick={() => onSelectView(entry.instance)}
										onClose={() => onRemoveView(entry.instance)}
									/>
								);
							})}
						</SortableContext>
					</TabBar>
				) : null}

				{hasViews ? (
					<PanelContent {...contentHandlers}>
						{panel.views.map((entry) => {
							const view = resolveViewDefinition(entry.kind);
							if (!view) return null;
							const context = viewContexts.get(entry.instance);
							if (!context) return null;
							const isActive = activeInstance === entry.instance;
							return (
								<Activity
									key={entry.instance}
									mode={isActive ? "visible" : "hidden"}
								>
									<ViewRenderer
										view={view}
										instance={entry}
										atelier={context.atelier}
										extensionView={context.view}
										side={side}
										isActive={isActive}
									/>
								</Activity>
							);
						})}
					</PanelContent>
				) : (
					<PanelContent>{emptyStatePlaceholder}</PanelContent>
				)}
			</div>
		</ContainerElement>
	);
}

export type PanelV2Props = {
	readonly side: PanelSide;
	readonly panel: PanelState;
	readonly isFocused: boolean;
	readonly onFocusPanel: (side: PanelSide) => void;
	readonly onSelectView: (instance: string) => void;
	readonly onRemoveView: (instance: string) => void;
	/** Enables the "+" add-view menu in the tab row. */
	readonly onAddView?: (kind: ExtensionKind, state?: ExtensionState) => void;
	readonly viewContext: ExtensionHostContext;
	readonly tabLabel?: (
		view: ExtensionDefinition,
		instance: ExtensionInstance,
	) => string;
	readonly emptyStatePlaceholder?: ReactNode;
	readonly onActiveViewInteraction?: (instance: string) => void;
	readonly dropId?: string;
	readonly viewOverrides?: ExtensionDefinition[];
	/** Hide the tab strip (central editor switches files from the file list). */
	readonly showTabBar?: boolean;
};

/** The "+" button lists views that are not already open in this panel. */
function AddViewMenu({
	side,
	panel,
	onAddView,
}: {
	readonly side: PanelSide;
	readonly panel: PanelState;
	readonly onAddView: (kind: ExtensionKind, state?: ExtensionState) => void;
}) {
	const { visibleExtensions } = useExtensionRegistry();
	const openKinds = useMemo(
		() => new Set(panel.views.map((entry) => entry.kind)),
		[panel.views],
	);
	const availableViews = useMemo(
		() => visibleExtensions.filter((view) => !openKinds.has(view.kind)),
		[visibleExtensions, openKinds],
	);
	if (availableViews.length === 0) return null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					title="Add view"
					aria-label="Add view"
					data-attr="panel-add-view"
					className="flex size-6 flex-none items-center justify-center rounded-md text-[var(--color-icon-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-icon-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg-panel)]"
				>
					<Plus className="size-3.25" strokeWidth={2} />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align={side === "right" ? "end" : "start"}
				className="w-44 border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] p-1 shadow-lg"
			>
				{availableViews.map((ext) => (
					<DropdownMenuItem
						key={ext.kind}
						onSelect={() => onAddView(ext.kind)}
						className="flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:bg-[var(--color-bg-hover)]"
					>
						<ext.icon className="h-4 w-4" />
						<span>{ext.label}</span>
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
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
}

function TabBar({ children, extraContent }: TabBarProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const [thumb, setThumb] = useState({ width: "0%", left: "0%" });
	const [thumbVisible, setThumbVisible] = useState(false);
	const hideTimeoutRef = useRef<number | null>(null);

	const updateThumb = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const { scrollWidth, clientWidth, scrollLeft } = el;
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

	return (
		<div className={styles.tabBar}>
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
	readonly isPending?: boolean;
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
	onClick,
	onClose,
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
		<TabButtonBase
			ref={setNodeRef}
			icon={icon}
			label={label}
			isActive={isActive}
			isFocused={isFocused}
			isPending={isPending}
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
	);
}

const tabBaseClasses =
	"group relative flex h-7 flex-none max-w-80 items-center gap-1.5 rounded-[7px] px-2.25 text-xs font-semibold transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg-panel)]";

const tabStateClasses = {
	// The focused chip marks the view receiving keyboard input.
	focused:
		"bg-[var(--color-bg-selection-current)] text-[var(--color-text-primary)] ring-1 ring-inset ring-[var(--color-border-selection-current)] [&_[data-tab-icon]]:text-[var(--color-icon-selection-current)]",
	active:
		"bg-[var(--color-bg-hover)] text-[var(--color-text-primary)] [&_[data-tab-icon]]:text-[var(--color-icon-secondary)]",
	idle: "bg-transparent text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]",
} as const;

interface TabBaseProps extends PanelTabPreviewProps {
	readonly onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
	readonly onClose?: () => void;
	readonly isDragging?: boolean;
	readonly dataFocused?: string;
	readonly dataViewInstance?: string;
	readonly dataViewKind?: string;
	readonly buttonProps?: ButtonHTMLAttributes<HTMLButtonElement> | null;
	readonly style?: CSSProperties;
}

const TabButtonBase = forwardRef<HTMLButtonElement, TabBaseProps>(
	(
		{
			icon: Icon,
			label,
			isActive,
			isFocused,
			isPending,
			onClick,
			onClose,
			isDragging,
			dataFocused,
			dataViewInstance,
			dataViewKind,
			buttonProps = null,
			style,
		},
		ref,
	) => {
		const state = isActive ? (isFocused ? "focused" : "active") : "idle";
		const { onClick: dragOnClick, ...restButtonProps } = buttonProps ?? {};
		return (
			<button
				type="button"
				onClick={(event) => {
					dragOnClick?.(event);
					onClick?.(event);
				}}
				ref={ref}
				data-focused={dataFocused}
				data-view-instance={dataViewInstance}
				data-view-key={dataViewKind}
				className={clsx(
					tabBaseClasses,
					tabStateClasses[state],
					isDragging && "opacity-50 cursor-grabbing",
				)}
				style={style}
				{...restButtonProps}
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
					className={clsx("max-w-[10rem] truncate", isPending && "italic")}
					title={label}
				>
					{label}
				</span>
				<span className="relative flex size-3.25 items-center justify-center">
					{onClose ? (
						<X
							data-attr="panel-tab-close"
							className={clsx(
								"h-3 w-3",
								isActive && isFocused
									? "text-[var(--color-action-selection-current)] hover:text-[var(--color-icon-selection-current)]"
									: isActive
										? "text-[var(--color-icon-tertiary)] hover:text-[var(--color-icon-secondary)]"
										: "text-[var(--color-icon-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-icon-secondary)]",
							)}
							onClick={(event) => {
								event.stopPropagation();
								onClose();
							}}
						/>
					) : null}
				</span>
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
};

export function PanelTabPreview(props: PanelTabPreviewProps) {
	return <TabButtonBase {...props} />;
}
