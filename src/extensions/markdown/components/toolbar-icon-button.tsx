import type {
	ComponentProps,
	MouseEvent,
	ReactElement,
	ReactNode,
} from "react";
import { Toolbar } from "@base-ui/react/toolbar";
import { Tooltip } from "@base-ui/react/tooltip";
import clsx from "clsx";
import { isMacPlatform } from "@/lib/platform";

/** 28px square icon button, matching the panel-header chips in the islands UI. */
export const iconButtonClass =
	"inline-flex size-7 shrink-0 select-none items-center justify-center rounded-[7px] text-[var(--color-icon-secondary)] transition-[background-color,color,box-shadow] duration-100 ease-out hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:stroke-[1.9]";

/** Pressed state for a formatting toggle. */
export const iconButtonActiveClass =
	"bg-[var(--color-bg-control-selected)] text-[var(--color-text-primary)] [&_svg]:text-[var(--color-icon-control-selected)]";

/** Tooltip popup shared by every toolbar button. */
export const toolbarTooltipPopupClass =
	"rounded-md border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] px-2 py-1 text-xs text-[var(--color-text-primary)] shadow-md transition-opacity duration-150 data-[state=closed]:opacity-0 data-[state=open]:opacity-100";

/** Delay before a toolbar tooltip opens, shared through `Tooltip.Provider`. */
export const TOOLBAR_TOOLTIP_DELAY = 400;

const SHORTCUT_KEY_LABELS = {
	bold: "B",
	italic: "I",
	strike: "⇧X",
	code: "E",
	link: "K",
	orderedList: "⇧7",
	bulletList: "⇧8",
	taskList: "⇧9",
} as const;

export type ToolbarShortcut = keyof typeof SHORTCUT_KEY_LABELS;

/**
 * Human-readable shortcut for a toolbar action: `⌘B` on Apple platforms,
 * `Ctrl+B` elsewhere.
 *
 * @example
 * formatToolbarShortcut("strike") // "⌘⇧X"
 */
export function formatToolbarShortcut(shortcut: ToolbarShortcut): string {
	const key = SHORTCUT_KEY_LABELS[shortcut];
	if (isMacPlatform()) return `⌘${key}`;
	return `Ctrl+${key.replace("⇧", "Shift+")}`;
}

function suppressMouseDown(event: MouseEvent<HTMLElement>) {
	event.preventDefault();
}

type ToolbarIconButtonProps = {
	/** Accessible name; also the tooltip's first word(s). */
	label: string;
	/** Tooltip text when it should differ from `label` (e.g. "Copied markdown"). */
	tooltip?: string;
	shortcut?: ToolbarShortcut;
	active?: boolean;
	/** Whether the button is a toggle; toggles expose `aria-pressed`. */
	pressable?: boolean;
	className?: string;
	onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
	/** Element the underlying `Toolbar.Button` renders as (e.g. a Popover trigger). */
	render?: ComponentProps<typeof Toolbar.Button>["render"];
	portalContainer?: HTMLElement;
	children: ReactNode;
} & Record<`data-${string}`, string | undefined>;

/**
 * Toolbar icon button with a delayed tooltip reading "Bold ⌘B". Focus never
 * moves to the button, so the editor selection survives a click.
 *
 * @example
 * <ToolbarIconButton label="Bold" shortcut="bold" active={isBold} onClick={toggleBold}>
 *   <Bold className="size-3.5" aria-hidden />
 * </ToolbarIconButton>
 */
export function ToolbarIconButton({
	label,
	tooltip,
	shortcut,
	active = false,
	pressable = true,
	className,
	onClick,
	render,
	portalContainer,
	children,
	...dataAttributes
}: ToolbarIconButtonProps): ReactElement {
	const shortcutLabel = shortcut ? formatToolbarShortcut(shortcut) : null;
	return (
		<Tooltip.Root>
			<Tooltip.Trigger
				render={
					<Toolbar.Button
						render={render}
						className={clsx(
							iconButtonClass,
							active && iconButtonActiveClass,
							className,
						)}
						onClick={onClick}
						onMouseDown={suppressMouseDown}
						aria-label={label}
						aria-pressed={pressable ? active : undefined}
						{...dataAttributes}
					/>
				}
			>
				{children}
			</Tooltip.Trigger>
			<Tooltip.Portal container={portalContainer}>
				<Tooltip.Positioner
					className="z-[60] outline-none"
					side="top"
					align="center"
					sideOffset={6}
				>
					<Tooltip.Popup className={toolbarTooltipPopupClass}>
						<span className="font-medium">{tooltip ?? label}</span>
						{shortcutLabel ? (
							<span className="ml-1.5 text-[var(--color-text-tertiary)]">
								{shortcutLabel}
							</span>
						) : null}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}
