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
	readonly centralTabStrip?: ReactNode;
	readonly navbarEnd?: ReactNode;
	/** Host props forwarded to the semantic top-bar header. */
	readonly rootProps?: AtelierTopBarProps;
};

/**
 * Workspace header with panel toggles and the active file name.
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
	centralTabStrip,
	navbarEnd,
	rootProps,
}: TopBarProps) {
	const leftShortcut = panelShortcutHint("left");
	const rightShortcut = panelShortcutHint("right");
	const hasHostIdentitySlots =
		(navbarBrand !== undefined && navbarBrand !== null) ||
		(navbarStart !== undefined && navbarStart !== null) ||
		(navbarRepository !== undefined && navbarRepository !== null);
	return (
		<header
			{...rootProps}
			className={cn(
				"relative grid h-[46px] shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3.5 text-[var(--color-text-secondary)]",
				rootProps?.className,
			)}
			data-atelier-part="top-bar"
		>
			<div className="flex min-w-0 items-center gap-1 text-sm">
				{navbarBrand !== undefined && navbarBrand !== null ? (
					<div className="flex shrink-0 items-center" data-slot="navbar-brand">
						{navbarBrand}
					</div>
				) : null}
				{navbarStart !== undefined && navbarStart !== null ? (
					<div className="flex shrink-0 items-center" data-slot="navbar-start">
						{navbarStart}
					</div>
				) : null}
				<Tooltip delayDuration={500}>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 justify-center rounded-[7px] text-[var(--color-icon-quaternary)] hover:bg-[var(--color-bg-hover-canvas)] hover:text-[var(--color-text-primary)]"
							type="button"
							onClick={onToggleLeftSidebar}
							aria-label="Toggle left panel"
							aria-pressed={isLeftSidebarVisible}
							data-state={isLeftSidebarVisible ? "on" : "off"}
							data-attr="topbar-toggle-left-panel"
						>
							<PanelToggleIcon side="left" isActive={isLeftSidebarVisible} />
						</Button>
					</TooltipTrigger>
					<TooltipContent className="bg-[var(--color-bg-tooltip)] text-[var(--color-text-tooltip)] [&_[class*='bg-secondary']]:bg-[var(--color-bg-tooltip)] [&_[class*='fill-secondary']]:fill-[var(--color-bg-tooltip)]">
						Toggle left panel ({leftShortcut})
					</TooltipContent>
				</Tooltip>
				{navbarRepository !== undefined && navbarRepository !== null ? (
					<div
						className="flex min-w-0 shrink items-center"
						data-slot="navbar-repository"
					>
						{navbarRepository}
					</div>
				) : null}
				{/* Keeps "where you are" (host brand and repository) visually separate
				    from "what's open" (the document tabs). */}
				{hasHostIdentitySlots && centralTabStrip ? (
					<span
						aria-hidden="true"
						data-atelier-part="top-bar-divider"
						className="mx-1 h-4 w-px shrink-0 bg-[var(--color-border-action-secondary)]"
					/>
				) : null}
			</div>
			{centralTabStrip !== undefined && centralTabStrip !== null ? (
				<div
					className="flex min-w-0 items-center overflow-hidden"
					data-slot="central-tab-strip"
				>
					{centralTabStrip}
					{/* End divider: appears only while tabs overflow to the right,
					    marking where the scrollable strip ends before the top bar's
					    right-side controls. */}
					{/* ml mirrors the left divider's distance to the strip edge
					    (its 4px margin plus the top bar's 8px column gap). */}
					<span
						aria-hidden="true"
						data-atelier-part="top-bar-divider-end"
						className="ml-3 mr-1 h-4 w-px shrink-0 bg-[var(--color-border-action-secondary)] opacity-0 transition-opacity duration-150 [[data-overflow-right=true]+&]:opacity-100"
					/>
				</div>
			) : navbarCenter !== undefined && navbarCenter !== null ? (
				<div
					className="flex min-w-0 items-center justify-center overflow-hidden px-2 text-[12.5px]"
					data-slot="navbar-center"
				>
					{navbarCenter}
					{isReadOnly ? (
						<span
							className="ml-1.5 flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-bg-hover)] px-2 py-0.75 text-[10.5px] leading-none font-semibold tracking-normal text-[var(--color-text-tertiary)]"
							data-attr="workspace-read-only-chip"
						>
							<Eye aria-hidden="true" className="size-3" strokeWidth={2.2} />
							Read-only
						</span>
					) : null}
				</div>
			) : reviewTitle || activeFileName || isReadOnly ? (
				<div className="flex min-w-0 items-center justify-center overflow-hidden px-2 text-[12.5px]">
					{reviewTitle ? (
						<span
							className="max-w-80 truncate px-1 font-bold text-[var(--color-brand-700)]"
							data-attr="diff-mode-title"
						>
							{reviewTitle}
						</span>
					) : activeFileName ? (
						<span
							className={`ph-mask max-w-60 truncate px-1 font-semibold ${
								isReviewing
									? "text-[var(--color-warning-600)]"
									: "text-[var(--color-text-primary)]"
							}`}
						>
							{isReviewing ? `Reviewing ${activeFileName}` : activeFileName}
						</span>
					) : null}
					{isReadOnly ? (
						<span
							className="ml-1.5 flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-bg-hover)] px-2 py-0.75 text-[10.5px] leading-none font-semibold tracking-normal text-[var(--color-text-tertiary)]"
							data-attr="workspace-read-only-chip"
						>
							<Eye aria-hidden="true" className="size-3" strokeWidth={2.2} />
							Read-only
						</span>
					) : null}
				</div>
			) : (
				<div aria-hidden="true" />
			)}
			<div className="flex items-center justify-end gap-1.5">
				{navbarEnd !== undefined && navbarEnd !== null ? (
					<div className="flex shrink-0 items-center" data-slot="navbar-end">
						{navbarEnd}
					</div>
				) : null}
				<Tooltip delayDuration={500}>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 justify-center rounded-[7px] text-[var(--color-icon-quaternary)] hover:bg-[var(--color-bg-hover-canvas)] hover:text-[var(--color-text-primary)]"
							type="button"
							onClick={onToggleRightSidebar}
							aria-label="Toggle right panel"
							aria-pressed={isRightSidebarVisible}
							data-state={isRightSidebarVisible ? "on" : "off"}
							data-attr="topbar-toggle-right-panel"
						>
							<PanelToggleIcon side="right" isActive={isRightSidebarVisible} />
						</Button>
					</TooltipTrigger>
					<TooltipContent className="bg-[var(--color-bg-tooltip)] text-[var(--color-text-tooltip)] [&_[class*='bg-secondary']]:bg-[var(--color-bg-tooltip)] [&_[class*='fill-secondary']]:fill-[var(--color-bg-tooltip)]">
						Toggle right panel ({rightShortcut})
					</TooltipContent>
				</Tooltip>
			</div>
		</header>
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
			className="size-3.75 text-current"
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
