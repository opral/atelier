import { Eye } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { panelShortcutHint } from "@/lib/platform";
import type { AtelierTopBarProps } from "@/create-atelier";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

export type TopBarProps = {
	/** Active document name, shown in the header center. */
	readonly activeFileName?: string | null;
	/** Whether the host opened this workspace without mutation access. */
	readonly isReadOnly?: boolean;
	/** Whether the active document is being reviewed. */
	readonly isReviewing?: boolean;
	/**
	 * Diff-mode headline ("Reviewing this turn · 2 files"). Replaces the
	 * file-name center while diff mode is open.
	 */
	readonly reviewTitle?: string | null;
	readonly onToggleLeftSidebar?: () => void;
	readonly onToggleRightSidebar?: () => void;
	readonly isLeftSidebarVisible?: boolean;
	readonly isRightSidebarVisible?: boolean;
	readonly navbarBrand?: ReactNode;
	readonly navbarRepository?: ReactNode;
	readonly navbarStart?: ReactNode;
	readonly navbarCenter?: ReactNode;
	readonly mainTabStrip?: ReactNode;
	readonly navbarEnd?: ReactNode;
	/**
	 * Whether the header carries "where you are" — the host's brand and
	 * repository and the left-area toggle. The sidebar owns them while it is
	 * open (`SidebarHeader`); they fold in here only when it is collapsed.
	 */
	readonly showIdentity?: boolean;
	/** Host props forwarded to the semantic top-bar header. */
	readonly rootProps?: AtelierTopBarProps;
};

/**
 * The main island's header: the document tabs, the host's trailing controls
 * and the right-area toggle. It sits inside the island, on the same 40px row
 * as the sidebar's header, so the two columns line up.
 *
 * @example
 * <TopBar activeFileName="notes.md" />
 */
export function TopBar({
	activeFileName = null,
	isReadOnly = false,
	isReviewing = false,
	reviewTitle = null,
	onToggleLeftSidebar,
	onToggleRightSidebar,
	isLeftSidebarVisible = true,
	isRightSidebarVisible = true,
	navbarBrand,
	navbarRepository,
	navbarStart,
	navbarCenter,
	mainTabStrip,
	navbarEnd,
	showIdentity = true,
	rootProps,
}: TopBarProps) {
	const hasHostIdentitySlots =
		showIdentity &&
		((navbarBrand !== undefined && navbarBrand !== null) ||
			(navbarStart !== undefined && navbarStart !== null) ||
			(navbarRepository !== undefined && navbarRepository !== null));
	return (
		<header
			{...rootProps}
			className={cn(
				"atw:relative atw:grid atw:h-[40px] atw:shrink-0 atw:items-center atw:gap-2 atw:border-b atw:border-border-subtle atw:px-1.5 atw:text-fg-muted",
				// Without the identity column the tabs start at the island's edge.
				showIdentity
					? "atw:grid-cols-[auto_minmax(0,1fr)_auto]"
					: "atw:grid-cols-[minmax(0,1fr)_auto]",
				rootProps?.className,
			)}
			data-atelier-part="top-bar"
			// Hosts that draw into the window's title bar (an installed app's
			// window controls) inset whichever row carries the identity.
			data-shows-identity={showIdentity ? "true" : "false"}
		>
			{showIdentity ? (
				<div className="atw:flex atw:min-w-0 atw:items-center atw:gap-1 atw:text-sm">
					{navbarBrand !== undefined && navbarBrand !== null ? (
						<div
							className="atw:flex atw:shrink-0 atw:items-center"
							data-slot="navbar-brand"
						>
							{navbarBrand}
						</div>
					) : null}
					{navbarStart !== undefined && navbarStart !== null ? (
						<div
							className="atw:flex atw:shrink-0 atw:items-center"
							data-slot="navbar-start"
						>
							{navbarStart}
						</div>
					) : null}
					<PanelToggleButton
						side="left"
						isActive={isLeftSidebarVisible}
						onToggle={onToggleLeftSidebar}
					/>
					{navbarRepository !== undefined && navbarRepository !== null ? (
						<div
							className="atw:flex atw:min-w-0 atw:shrink atw:items-center"
							data-slot="navbar-repository"
						>
							{navbarRepository}
						</div>
					) : null}
					{/* Keeps "where you are" (host brand and repository) visually separate
				    from "what's open" (the document tabs). */}
					{hasHostIdentitySlots && mainTabStrip ? (
						<span
							aria-hidden="true"
							data-atelier-part="top-bar-divider"
							className="atw:mx-1 atw:h-4 atw:w-px atw:shrink-0 atw:bg-border-strong"
						/>
					) : null}
				</div>
			) : null}
			{mainTabStrip !== undefined && mainTabStrip !== null ? (
				<div
					className="atw:flex atw:min-w-0 atw:items-center atw:overflow-hidden"
					data-slot="main-tab-strip"
				>
					{mainTabStrip}
					{/* End divider: appears only while tabs overflow to the right,
					    marking where the scrollable strip ends before the top bar's
					    right-side controls. */}
					{/* ml mirrors the left divider's distance to the strip edge
					    (its 4px margin plus the top bar's 8px column gap). */}
					<span
						aria-hidden="true"
						data-atelier-part="top-bar-divider-end"
						className="atw:ml-3 atw:mr-1 atw:h-4 atw:w-px atw:shrink-0 atw:bg-border-strong atw:opacity-0 atw:transition-opacity atw:duration-150 atw:[[data-overflow-right=true]+&]:opacity-100"
					/>
				</div>
			) : navbarCenter !== undefined && navbarCenter !== null ? (
				<div
					className="atw:flex atw:min-w-0 atw:items-center atw:justify-center atw:overflow-hidden atw:px-2 atw:text-[12.5px]"
					data-slot="navbar-center"
				>
					{navbarCenter}
					{isReadOnly ? (
						<span
							className="atw:ml-1.5 atw:flex atw:shrink-0 atw:items-center atw:gap-1 atw:rounded-full atw:bg-bg-hover atw:px-2 atw:py-0.75 atw:text-[10.5px] atw:leading-none atw:font-semibold atw:tracking-normal atw:text-fg-subtle"
							data-attr="workspace-read-only-chip"
						>
							<Eye
								aria-hidden="true"
								className="atw:size-3"
								strokeWidth={2.2}
							/>
							Read-only
						</span>
					) : null}
				</div>
			) : reviewTitle || activeFileName || isReadOnly ? (
				<div className="atw:flex atw:min-w-0 atw:items-center atw:justify-center atw:overflow-hidden atw:px-2 atw:text-[12.5px]">
					{reviewTitle ? (
						<span
							className="atw:max-w-80 atw:truncate atw:px-1 atw:font-bold atw:text-accent"
							data-attr="diff-mode-title"
						>
							{reviewTitle}
						</span>
					) : activeFileName ? (
						<span
							className={`ph-mask atw:max-w-60 atw:truncate atw:px-1 atw:font-semibold ${
								isReviewing ? "atw:text-warning" : "atw:text-fg"
							}`}
						>
							{isReviewing ? `Reviewing ${activeFileName}` : activeFileName}
						</span>
					) : null}
					{isReadOnly ? (
						<span
							className="atw:ml-1.5 atw:flex atw:shrink-0 atw:items-center atw:gap-1 atw:rounded-full atw:bg-bg-hover atw:px-2 atw:py-0.75 atw:text-[10.5px] atw:leading-none atw:font-semibold atw:tracking-normal atw:text-fg-subtle"
							data-attr="workspace-read-only-chip"
						>
							<Eye
								aria-hidden="true"
								className="atw:size-3"
								strokeWidth={2.2}
							/>
							Read-only
						</span>
					) : null}
				</div>
			) : (
				<div aria-hidden="true" />
			)}
			<div className="atw:flex atw:items-center atw:justify-end atw:gap-1.5">
				{navbarEnd !== undefined && navbarEnd !== null ? (
					<div
						className="atw:flex atw:shrink-0 atw:items-center"
						data-slot="navbar-end"
					>
						{navbarEnd}
					</div>
				) : null}
				<PanelToggleButton
					side="right"
					isActive={isRightSidebarVisible}
					onToggle={onToggleRightSidebar}
				/>
			</div>
		</header>
	);
}

export type SidebarHeaderProps = Pick<
	TopBarProps,
	"navbarBrand" | "navbarStart" | "navbarRepository" | "onToggleLeftSidebar"
>;

/**
 * The open sidebar's first row: "where you are" — the host's brand and
 * repository — and the toggle that collapses the sidebar. It is the same
 * 40px as the main island's header, so the sidebar and the island start on
 * one line. Collapsed, the same slots move into the island's header.
 *
 * @example
 * <SidebarHeader navbarBrand={<Logo />} onToggleLeftSidebar={toggle} />
 */
export function SidebarHeader({
	navbarBrand,
	navbarStart,
	navbarRepository,
	onToggleLeftSidebar,
}: SidebarHeaderProps) {
	return (
		<div
			className="atw:flex atw:h-[40px] atw:min-w-0 atw:shrink-0 atw:items-center atw:gap-1 atw:pr-1.5 atw:pl-1.5 atw:text-sm atw:text-fg-muted"
			data-atelier-part="sidebar-header"
		>
			{navbarBrand !== undefined && navbarBrand !== null ? (
				<div
					className="atw:flex atw:min-w-0 atw:shrink atw:items-center"
					data-slot="navbar-brand"
				>
					{navbarBrand}
				</div>
			) : null}
			{navbarStart !== undefined && navbarStart !== null ? (
				<div
					className="atw:flex atw:shrink-0 atw:items-center"
					data-slot="navbar-start"
				>
					{navbarStart}
				</div>
			) : null}
			{navbarRepository !== undefined && navbarRepository !== null ? (
				<div
					className="atw:flex atw:min-w-0 atw:shrink atw:items-center"
					data-slot="navbar-repository"
				>
					{navbarRepository}
				</div>
			) : null}
			<div className="atw:flex-1" aria-hidden="true" />
			<PanelToggleButton
				side="left"
				isActive={true}
				onToggle={onToggleLeftSidebar}
			/>
		</div>
	);
}

function PanelToggleButton({
	side,
	isActive,
	onToggle,
}: {
	readonly side: "left" | "right";
	readonly isActive: boolean;
	readonly onToggle?: () => void;
}) {
	const shortcut = panelShortcutHint(side);
	return (
		<Tooltip delayDuration={500}>
			<TooltipTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="atw:h-7 atw:w-7 atw:shrink-0 atw:justify-center atw:rounded-control atw:text-fg-faint atw:hover:bg-bg-hover-strong atw:hover:text-fg"
					type="button"
					onClick={onToggle}
					aria-label={`Toggle ${side} panel`}
					aria-pressed={isActive}
					data-state={isActive ? "on" : "off"}
					data-attr={`topbar-toggle-${side}-panel`}
				>
					<PanelToggleIcon side={side} isActive={isActive} />
				</Button>
			</TooltipTrigger>
			<TooltipContent className="atw:bg-overlay atw:text-overlay-fg atw:[&_[class*='bg-bg-subtle']]:bg-overlay atw:[&_[class*='fill-secondary']]:fill-overlay">
				Toggle {side} area ({shortcut})
			</TooltipContent>
		</Tooltip>
	);
}

type PanelToggleIconProps = {
	readonly side: "left" | "right";
	readonly isActive: boolean;
};

function PanelToggleIcon({ side, isActive }: PanelToggleIconProps) {
	const viewBoxPath = side === "left" ? "M9 3v18" : "M15 3v18";
	const panelRect = side === "left" ? { x: 3, width: 6 } : { x: 15, width: 6 };
	return (
		<svg
			aria-hidden="true"
			className="atw:size-3.75 atw:text-current"
			focusable="false"
			role="img"
			viewBox="0 0 24 24"
		>
			{isActive ? (
				<rect
					{...panelRect}
					y="3"
					height="18"
					rx="1.2"
					fill="currentColor"
					fillOpacity={0.4}
				/>
			) : null}
			<rect
				width="18"
				height="18"
				x="3"
				y="3"
				rx="2"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d={viewBoxPath}
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
