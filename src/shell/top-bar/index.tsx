import { useMemo, type ComponentPropsWithRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

export type AtelierTopBarProps = Omit<
	ComponentPropsWithRef<"header">,
	"children" | "dangerouslySetInnerHTML" | "role"
> & {
	readonly [attribute: `data-${string}`]: string | number | boolean | undefined;
};

export type TopBarProps = {
	/** Active document name, shown in the header center. */
	readonly activeFileName?: string | null;
	/** Whether the active document is being shown as a checkpoint diff. */
	readonly isReviewingCheckpoint?: boolean;
	readonly onToggleLeftSidebar?: () => void;
	readonly onToggleRightSidebar?: () => void;
	readonly isLeftSidebarVisible?: boolean;
	readonly isRightSidebarVisible?: boolean;
	readonly navbarStart?: ReactNode;
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
	isReviewingCheckpoint = false,
	onToggleLeftSidebar,
	onToggleRightSidebar,
	isLeftSidebarVisible = true,
	isRightSidebarVisible = true,
	navbarStart,
	navbarEnd,
	rootProps,
}: TopBarProps) {
	const isMacPlatform = useMemo(() => {
		if (typeof navigator === "undefined") return false;
		const platformCandidates = [
			((navigator as any).userAgentData?.platform as string | undefined) ??
				null,
			navigator.platform ?? null,
			navigator.userAgent ?? null,
		].filter(Boolean) as string[];
		const combined = platformCandidates.join(" ").toLowerCase();
		return /mac|iphone|ipad|ipod/.test(combined);
	}, []);

	const modifierKey = isMacPlatform ? "⌘" : "Ctrl";
	const leftShortcut = isMacPlatform ? `${modifierKey}1` : `${modifierKey}+1`;
	const rightShortcut = isMacPlatform ? `${modifierKey}2` : `${modifierKey}+2`;
	return (
		<header
			{...rootProps}
			className={cn(
				"relative flex h-9 shrink-0 items-center px-2 text-[var(--color-text-secondary)]",
				rootProps?.className,
			)}
			data-atelier-part="top-bar"
		>
			<div className="flex min-w-0 flex-1 items-center gap-1 text-sm">
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
							className="h-7 w-7 justify-start rounded-[7px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
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
			</div>
			{activeFileName ? (
				<div className="pointer-events-none absolute inset-x-0 flex min-w-0 items-center justify-center px-[88px]">
					<div className="pointer-events-auto flex min-w-0 items-center text-[12.5px]">
						<span className="ph-mask max-w-60 truncate px-1 font-semibold text-[var(--color-text-primary)]">
							{activeFileName}
						</span>
						{isReviewingCheckpoint ? (
							<span className="ml-1 shrink-0 rounded-[5px] border border-[var(--color-border-panel)] px-1.5 py-0.5 text-[10.5px] leading-none font-semibold tracking-normal text-[var(--color-text-tertiary)]">
								Reviewing
							</span>
						) : null}
					</div>
				</div>
			) : null}
			<div className="flex flex-1 items-center justify-end gap-1.5">
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
							className="h-7 w-7 justify-end rounded-[7px] text-[var(--color-icon-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
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
