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
	"atw:inline-flex atw:size-7 atw:shrink-0 atw:select-none atw:items-center atw:justify-center atw:rounded-[7px] atw:text-fg-muted atw:transition-[background-color,color,box-shadow] atw:duration-100 atw:ease-out atw:hover:bg-bg-hover atw:hover:text-fg atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:disabled:cursor-not-allowed atw:disabled:opacity-40 atw:[&_svg]:stroke-[1.9]";

/** Pressed state for a formatting toggle. */
export const iconButtonActiveClass =
	"atw:bg-bg-hover atw:text-fg atw:[&_svg]:text-fg-muted";

/** Tooltip popup shared by every toolbar button. */
export const toolbarTooltipPopupClass =
	"atw:rounded-md atw:border atw:border-border atw:bg-panel atw:px-2 atw:py-1 atw:text-xs atw:text-fg atw:shadow-md atw:transition-opacity atw:duration-150 atw:data-[state=closed]:opacity-0 atw:data-[state=open]:opacity-100";

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
	footnote: "⌥F",
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
 *   <Bold className="atw:size-3.5" aria-hidden />
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
					className="atw:z-[60] atw:outline-none"
					side="top"
					align="center"
					sideOffset={6}
				>
					<Tooltip.Popup className={toolbarTooltipPopupClass}>
						<span className="atw:font-medium">{tooltip ?? label}</span>
						{shortcutLabel ? (
							<span className="atw:ml-1.5 atw:text-fg-subtle">
								{shortcutLabel}
							</span>
						) : null}
					</Tooltip.Popup>
				</Tooltip.Positioner>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}
