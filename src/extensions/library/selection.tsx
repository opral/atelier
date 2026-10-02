import { useEffect, useMemo, type MouseEvent as ReactMouseEvent } from "react";
import {
	Check,
	Download,
	FolderInput,
	Minus,
	MoreHorizontal,
	PencilLine,
	SquareArrowOutUpRight,
	Trash2,
	X,
} from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Selection in the Library, the same in Files rows, list rows and grid
 * cards: a checkbox toggles one item, Shift extends from the last one
 * touched, ⌘/Ctrl-click toggles once something is selected, Space toggles
 * the focused item, and Esc clears.
 */
export type LibrarySelection = {
	readonly selected: ReadonlySet<string>;
	/** Selectable items in screen order, for Shift ranges. */
	readonly order: readonly string[];
	readonly onChange: (next: ReadonlySet<string>) => void;
	readonly anchor: React.MutableRefObject<string | null>;
};

/** Toggles `path`; `extend` adds everything from the anchor to it. */
export function toggleSelection(
	selection: LibrarySelection,
	path: string,
	extend: boolean,
): void {
	const { selected, order, anchor, onChange } = selection;
	const next = new Set(selected);
	if (extend && anchor.current && order.includes(anchor.current)) {
		const from = order.indexOf(anchor.current);
		const to = order.indexOf(path);
		const [start, end] = from < to ? [from, to] : [to, from];
		for (const candidate of order.slice(start, end + 1)) next.add(candidate);
	} else if (next.has(path)) next.delete(path);
	else next.add(path);
	anchor.current = path;
	onChange(next);
}

/**
 * A click on an item that selects instead of opening: Shift-click extends,
 * ⌘/Ctrl-click toggles while a selection is active. True when it did.
 */
export function selectionClick(
	selection: LibrarySelection,
	path: string,
	event: ReactMouseEvent,
): boolean {
	if (event.shiftKey) {
		toggleSelection(selection, path, true);
		return true;
	}
	if ((event.metaKey || event.ctrlKey) && selection.selected.size > 0) {
		toggleSelection(selection, path, false);
		return true;
	}
	return false;
}

/**
 * Drops selected paths that are no longer on screen, and an anchor that
 * left with them. `null` (nothing loaded yet) keeps the selection as it is.
 */
export function usePruneSelection(
	selection: Pick<LibrarySelection, "selected" | "onChange" | "anchor">,
	order: readonly string[] | null,
): void {
	const { selected, onChange, anchor } = selection;
	const shown = useMemo(
		() => (order === null ? null : new Set(order)),
		// The paths, not the array: it is rebuilt on every render.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[order === null ? null : JSON.stringify(order)],
	);
	useEffect(() => {
		if (shown === null) return;
		if (anchor.current !== null && !shown.has(anchor.current))
			anchor.current = null;
		if (selected.size === 0) return;
		const kept = [...selected].filter((path) => shown.has(path));
		if (kept.length !== selected.size) onChange(new Set(kept));
	}, [anchor, onChange, selected, shown]);
}

/** The box itself; the caller's button carries the role and label. */
export function SelectionBox({ state }: { readonly state: boolean | "mixed" }) {
	const on = state !== false;
	return (
		<span
			aria-hidden="true"
			className={`atw:grid atw:size-4 atw:place-items-center atw:rounded-[5px] atw:border atw:transition-colors ${
				on
					? "atw:border-link atw:bg-link atw:text-accent-on"
					: "atw:border-border-strong atw:bg-panel"
			}`}
		>
			{state === "mixed" ? (
				<Minus className="atw:size-3" strokeWidth={3} />
			) : state ? (
				<Check className="atw:size-3" strokeWidth={3} />
			) : null}
		</span>
	);
}

/**
 * An item's checkbox: hidden until the item is hovered or anything is
 * selected. `className` places it — beside a row, or on a card.
 */
export function SelectionCheckbox({
	label,
	checked,
	visible,
	className,
	onToggle,
}: {
	readonly label: string;
	readonly checked: boolean;
	/** Shown without hover: something is selected. */
	readonly visible: boolean;
	readonly className: string;
	readonly onToggle: (extend: boolean) => void;
}) {
	return (
		<button
			type="button"
			role="checkbox"
			aria-checked={checked}
			aria-label={label}
			data-testid="library-select"
			onClick={(event) => {
				event.stopPropagation();
				onToggle(event.shiftKey);
			}}
			className={`atw:grid atw:size-7 atw:place-items-center atw:rounded-md atw:transition-opacity atw:focus-visible:opacity-100 atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:outline-none ${
				visible || checked ? "atw:opacity-100" : "atw:opacity-0"
			} ${className}`}
		>
			<SelectionBox state={checked} />
		</button>
	);
}

// Icon-only below 760px; tighter still on a phone.
const toolbarButton =
	"atw:flex atw:h-8 atw:shrink-0 atw:items-center atw:justify-center atw:gap-1.5 atw:rounded-lg atw:px-2.5 atw:@max-[760px]:w-8 atw:@max-[760px]:px-0 atw:@max-[480px]:w-7 atw:text-[13px] atw:font-medium atw:text-fg-muted atw:transition-colors atw:hover:bg-bg-hover atw:hover:text-fg atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:outline-none";

/**
 * What can be done with the selection. Its labels give way to icons in a
 * narrow Library (an `@container` ancestor). It takes the title's place, its
 * checkbox in the items' checkbox column, so the count reads as the head of
 * the column it counts and nothing below moves.
 */
export function SelectionToolbar({
	count,
	total,
	inset,
	onSelectAll,
	onClear,
	onMove,
	onDelete,
	onDownload,
	onOpenInNewTabs,
	onRename,
}: {
	readonly count: number;
	/** Everything on screen that can be selected. */
	readonly total: number;
	/**
	 * Where the items' checkboxes sit: in the gutter left of the rows, or
	 * inside the cards.
	 */
	readonly inset: "gutter" | "card";
	readonly onSelectAll: () => void;
	readonly onClear: () => void;
	readonly onMove: () => void;
	readonly onDelete: () => void;
	readonly onDownload: () => void;
	readonly onOpenInNewTabs: () => void;
	readonly onRename?: () => void;
}) {
	const all = count >= total;
	return (
		<div
			role="toolbar"
			aria-label="Selection"
			data-testid="library-selection-toolbar"
			className={`atw:flex atw:h-8 atw:min-w-0 atw:items-center atw:gap-0.5 ${
				inset === "gutter" ? "atw:-ml-10 atw:max-sm:ml-0" : "atw:ml-[7px]"
			}`}
		>
			<button
				type="button"
				role="checkbox"
				aria-checked={all ? true : "mixed"}
				aria-label={all ? "Deselect all" : "Select all"}
				title={all ? "Deselect all" : "Select all"}
				data-testid="library-select-all"
				onClick={all ? onClear : onSelectAll}
				className="atw:grid atw:size-7 atw:shrink-0 atw:place-items-center atw:rounded-md atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:outline-none"
			>
				<SelectionBox state={all ? true : "mixed"} />
			</button>
			<span
				className="atw:shrink-0 atw:pr-2 atw:pl-1.5 atw:text-[15px] atw:font-semibold atw:text-fg atw:@max-[480px]:pr-1 atw:@max-[480px]:text-[14px]"
				aria-live="polite"
			>
				{count} selected
			</span>
			<button
				type="button"
				aria-label="Move"
				title="Move"
				onClick={onMove}
				className={toolbarButton}
			>
				<FolderInput className="atw:size-3.5" aria-hidden="true" />
				<span className="atw:@max-[760px]:hidden">Move</span>
			</button>
			<button
				type="button"
				aria-label="Download"
				title="Download"
				onClick={onDownload}
				className={toolbarButton}
			>
				<Download className="atw:size-3.5" aria-hidden="true" />
				<span className="atw:@max-[760px]:hidden">Download</span>
			</button>
			<button
				type="button"
				aria-label="Delete"
				title="Delete"
				onClick={onDelete}
				className={`${toolbarButton} atw:hover:bg-danger-subtle atw:hover:text-danger`}
			>
				<Trash2 className="atw:size-3.5" aria-hidden="true" />
				<span className="atw:@max-[760px]:hidden">Delete</span>
			</button>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<button
						type="button"
						aria-label="More actions"
						className={`${toolbarButton} atw:w-8 atw:justify-center atw:px-0`}
					>
						<MoreHorizontal className="atw:size-4" aria-hidden="true" />
					</button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="atw:min-w-44 atw:text-[13px]"
				>
					<DropdownMenuItem onSelect={onOpenInNewTabs}>
						<SquareArrowOutUpRight aria-hidden="true" />
						Open in new tabs
					</DropdownMenuItem>
					{onRename ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={onRename}>
								<PencilLine aria-hidden="true" />
								Rename
							</DropdownMenuItem>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			<button
				type="button"
				aria-label="Clear selection"
				title="Clear selection (Esc)"
				onClick={onClear}
				className={`${toolbarButton} atw:w-8 atw:justify-center atw:px-0`}
			>
				<X className="atw:size-4" aria-hidden="true" />
			</button>
		</div>
	);
}
