import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ComponentType,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	ArrowDown,
	ArrowDownAZ,
	ArrowDownToLine,
	ArrowDownZA,
	ArrowLeft,
	ArrowLeftToLine,
	ArrowRight,
	ArrowRightToLine,
	ArrowUp,
	ArrowUpToLine,
	GripHorizontal,
	GripVertical,
	Plus,
	Trash2,
} from "lucide-react";
import type { ChainedCommands, Editor } from "@tiptap/core";
import {
	TextSelection,
	type EditorState,
	type Transaction,
} from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { useEditorState } from "@tiptap/react";
import { useEditorCtx } from "../editor/editor-context";
import {
	mapTableTarget,
	tableControlsPluginKey,
	tableShortcuts,
	type TableMenu,
	type TableMenuAxis,
	type TableShortcut,
} from "../editor/extensions/table-controls";
import {
	cellPosition,
	tableAlign,
	tableTargetAt,
	tableWidth,
	type TableAlign,
	type TableTarget,
} from "../editor/table-commands";
import {
	clampLeft,
	clampToClipRect,
	getClipRect,
	isAnchorClipped,
} from "./clip-rect";
import { mountedView, useEditorViewMounted } from "../editor/mounted-view";
import { useMenuDismissal } from "./menu-dismissal";
import { ariaKeyShortcuts, formatKeyBinding } from "./shortcut-label";

/** The grips' size across and along the border they sit on. */
const GRIP_THICKNESS = 14;
const GRIP_LENGTH = 24;
/**
 * The "+" bars: the bottom one fills the strip the table keeps below its
 * grid (style.css; taller for a coarse pointer) up to this height, the
 * right one is a thin strip this far from the grid.
 */
const BAR_MAX_THICKNESS = 28;
const SIDE_BAR_THICKNESS = 10;
const BAR_GAP = 4;
const MENU_WIDTH = 288;
const MENU_GAP = 6;
/** Row heights in the menu, for placing it before it is drawn. */
const MENU_ROW_HEIGHT = { action: 30, align: 36, label: 26, separator: 9 };
const MENU_PADDING = 14;

const sameTarget = (a: TableTarget | null, b: TableTarget | null) =>
	a === b ||
	(a !== null &&
		b !== null &&
		a.tablePos === b.tablePos &&
		a.row === b.row &&
		a.column === b.column);

/** The table cell `element` is, as a target, if it is one of this editor's. */
function targetOfCell(editor: Editor, element: Element): TableTarget | null {
	const cell = element.closest("td, th");
	if (!cell || cell.closest(".ProseMirror") !== editor.view.dom) return null;
	try {
		return tableTargetAt(editor.state, editor.view.posAtDOM(cell, 0));
	} catch {
		return null;
	}
}

function tableElements(editor: Editor, tablePos: number) {
	const table = editor.view.nodeDOM(tablePos);
	if (!(table instanceof HTMLTableElement)) return null;
	const body = table.querySelector(":scope > tbody");
	return body instanceof HTMLElement ? { table, body } : null;
}

/** The element of the cell `target` names, if it is on screen. */
function cellElement(editor: Editor, target: TableTarget): HTMLElement | null {
	const table = editor.state.doc.nodeAt(target.tablePos);
	if (table?.type.name !== "table") return null;
	const pos = cellPosition(table, target.tablePos, target.row, target.column);
	if (pos === null) return null;
	const cell = editor.view.nodeDOM(pos);
	return cell instanceof HTMLElement ? cell : null;
}

type Rect = {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
};

type Layout = {
	readonly rowGrip: Rect | null;
	readonly columnGrip: Rect | null;
	readonly addRow: Rect | null;
	readonly addColumn: Rect | null;
};

type DropLocation = {
	readonly target: TableTarget;
	/** Final row/column index after removing the dragged item. */
	readonly destination: number;
	/** Insertion boundary in the table before removing the dragged item. */
	readonly insertion: number;
};

type GripDrag = {
	readonly pointerId: number;
	readonly axis: "row" | "column";
	readonly source: TableTarget;
	readonly startX: number;
	readonly startY: number;
	started: boolean;
	location: DropLocation | null;
};

type DragPreview = {
	readonly axis: "row" | "column";
	readonly source: TableTarget;
	readonly location: DropLocation | null;
};

/**
 * Where the controls for `target` go: the row's grip on the table's left
 * border, the column's on its top border, the "+" bars along the bottom and
 * right edges.
 *
 * They are measured against the editor's scroll box, not the table's own
 * element: a table as wide as the editor has no room beside its grid, and a
 * grip that had to fit inside the element was never drawn at all. Where the
 * editor has no room left of the grid either (a narrow pane, a phone), the
 * row's grip lies over the row's left border instead, as Notion's does. A
 * table wider than its room scrolls, and then the controls keep to the part
 * of the grid that is showing. A control whose row or column has scrolled
 * out of sight is not drawn.
 */
function measure(editor: Editor, target: TableTarget): Layout | null {
	const elements = tableElements(editor, target.tablePos);
	if (!elements) return null;
	const { table, body } = elements;
	const row = body.children[target.row];
	const cell = body.children[0]?.children[target.column];
	if (!row || !cell) return null;
	const clip = getClipRect(editor.view.dom);
	const room = table.getBoundingClientRect();
	const grid = body.getBoundingClientRect();
	const rowBox = row.getBoundingClientRect();
	const cellBox = cell.getBoundingClientRect();
	// The part of the grid that is showing: a wide table's room scrolls it.
	const gridLeft = Math.max(grid.left, room.left, clip.left);
	const gridRight = Math.min(grid.right, room.right, clip.right);
	const inView = (rect: Rect) =>
		rect.left >= clip.left - 1 &&
		rect.left + rect.width <= clip.right + 1 &&
		rect.top >= clip.top - 1 &&
		rect.top + rect.height <= clip.bottom + 1;
	const within = (rect: Rect) => (inView(rect) ? rect : null);
	const rowGripLeft =
		gridLeft - GRIP_THICKNESS / 2 - 0.5 >= clip.left
			? gridLeft - GRIP_THICKNESS / 2 - 0.5
			: gridLeft + 1;
	// The bottom bar lives in the room the table keeps below its grid, and
	// never reaches the next block's line.
	const next = table.nextElementSibling?.getBoundingClientRect();
	const floor = Math.min(
		Math.max(room.bottom, grid.bottom),
		next && next.top > grid.bottom ? next.top : Infinity,
	);
	const barHeight = Math.max(
		4,
		Math.min(BAR_MAX_THICKNESS, floor - grid.bottom - 4),
	);
	const sideLeft =
		gridRight + BAR_GAP + SIDE_BAR_THICKNESS <= clip.right &&
		grid.right <= gridRight + 1
			? gridRight + BAR_GAP
			: gridRight - SIDE_BAR_THICKNESS - 2;
	const columnCenter = cellBox.left + cellBox.width / 2;
	return {
		rowGrip: within({
			left: rowGripLeft,
			top: rowBox.top + rowBox.height / 2 - GRIP_LENGTH / 2,
			width: GRIP_THICKNESS,
			height: GRIP_LENGTH,
		}),
		columnGrip:
			columnCenter < gridLeft || columnCenter > gridRight
				? null
				: within({
						left: columnCenter - GRIP_LENGTH / 2,
						top: grid.top - GRIP_THICKNESS / 2 - 0.5,
						width: GRIP_LENGTH,
						height: GRIP_THICKNESS,
					}),
		addRow:
			gridRight <= gridLeft
				? null
				: within({
						left: gridLeft,
						top: grid.bottom + 2,
						width: gridRight - gridLeft,
						height: barHeight,
					}),
		addColumn: within({
			left: sideLeft,
			top: grid.top,
			width: SIDE_BAR_THICKNESS,
			height: grid.height,
		}),
	};
}

/** Resolves a drag pointer to the insertion boundary on its source table. */
function dropLocationAt(
	editor: Editor,
	source: TableTarget,
	axis: "row" | "column",
	x: number,
	y: number,
): DropLocation | null {
	const elements = tableElements(editor, source.tablePos);
	if (!elements) return null;
	const { body } = elements;
	const candidates =
		axis === "row"
			? Array.from(body.children)
			: Array.from(body.children[0]?.children ?? []);
	if (candidates.length === 0) return null;
	const coordinate = axis === "row" ? y : x;
	const bounds = candidates.map((element) => element.getBoundingClientRect());
	const first = bounds[0]!;
	const last = bounds.at(-1)!;
	const start = axis === "row" ? first.top : first.left;
	const end = axis === "row" ? last.bottom : last.right;
	if (coordinate < start || coordinate > end) return null;
	const midpointIndex = bounds.findIndex(
		(box) =>
			coordinate <
			(axis === "row" ? box.top + box.height / 2 : box.left + box.width / 2),
	);
	const index = midpointIndex < 0 ? bounds.length - 1 : midpointIndex;
	const box = bounds[index]!;
	const afterMidpoint =
		coordinate >=
		(axis === "row" ? box.top + box.height / 2 : box.left + box.width / 2);
	let insertion = index + (afterMidpoint ? 1 : 0);
	const sourceIndex = axis === "row" ? source.row : source.column;
	const lastIndex = candidates.length - 1;
	if (axis === "row") {
		// Markdown's first row is the header and remains pinned at the top.
		if (sourceIndex === 0) return null;
		insertion = Math.max(1, insertion);
	}
	let destination = insertion > sourceIndex ? insertion - 1 : insertion;
	destination =
		axis === "row"
			? Math.max(1, Math.min(lastIndex, destination))
			: Math.max(0, Math.min(lastIndex, destination));
	return {
		target: {
			tablePos: source.tablePos,
			row: axis === "row" ? index : 0,
			column: axis === "column" ? index : 0,
		},
		destination,
		insertion,
	};
}

/** The slim line that previews where a dragged row or column will land. */
function measureDropIndicator(editor: Editor, drag: DragPreview): Rect | null {
	if (!drag.location) return null;
	const elements = tableElements(editor, drag.source.tablePos);
	if (!elements) return null;
	const { body } = elements;
	const grid = body.getBoundingClientRect();
	const clip = getClipRect(editor.view.dom);
	if (drag.axis === "column") {
		const cells = Array.from(body.children[0]?.children ?? []);
		if (!cells.length) return null;
		const boundary = drag.location.insertion;
		const x =
			boundary >= cells.length
				? cells.at(-1)!.getBoundingClientRect().right
				: cells[boundary]!.getBoundingClientRect().left;
		const left = Math.max(clip.left, Math.min(clip.right - 2, x - 1));
		const top = Math.max(clip.top, grid.top);
		const bottom = Math.min(clip.bottom, grid.bottom);
		return bottom > top ? { left, top, width: 2, height: bottom - top } : null;
	}
	const rows = Array.from(body.children);
	if (!rows.length) return null;
	const boundary = drag.location.insertion;
	const y =
		boundary >= rows.length
			? rows.at(-1)!.getBoundingClientRect().bottom
			: rows[boundary]!.getBoundingClientRect().top;
	const left = Math.max(clip.left, grid.left);
	const right = Math.min(clip.right, grid.right);
	const top = Math.max(clip.top, Math.min(clip.bottom - 2, y - 1));
	return right > left ? { left, top, width: right - left, height: 2 } : null;
}

/**
 * The pointer is over the table's own box, or the controls' places around
 * its grid. Past that the controls go away, so a bar never waits under a
 * pointer that is on its way to the text after the table.
 */
function nearTable(editor: Editor, target: TableTarget, x: number, y: number) {
	const elements = tableElements(editor, target.tablePos);
	if (!elements) return false;
	const room = elements.table.getBoundingClientRect();
	const grid = elements.body.getBoundingClientRect();
	const reach = GRIP_THICKNESS / 2 + 1;
	return (
		x >= Math.min(room.left, grid.left - reach) &&
		x <= Math.max(room.right, grid.right + BAR_GAP + SIDE_BAR_THICKNESS + 1) &&
		y >= Math.min(room.top, grid.top - reach) &&
		y <= Math.max(room.bottom, grid.bottom)
	);
}

function useCoarsePointer(): boolean {
	const query = "(hover: none)";
	const [coarse, setCoarse] = useState(
		() =>
			typeof window !== "undefined" &&
			typeof window.matchMedia === "function" &&
			window.matchMedia(query).matches,
	);
	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const list = window.matchMedia(query);
		const update = () => setCoarse(list.matches);
		list.addEventListener?.("change", update);
		return () => list.removeEventListener?.("change", update);
	}, []);
	return coarse;
}

type Cell = { readonly row: number; readonly column: number };

/**
 * Where a cell of the table is after an entry's edit, or null when the edit
 * took it. Each edit rebuilds the whole table, so a position in it cannot
 * simply be mapped through the transaction; the entry says instead what it
 * did to the rows and columns.
 */
type CellMap = (
	cell: Cell,
	before: ProseMirrorNode,
	after: ProseMirrorNode,
) => Cell | null;

/** An edit that renumbers the rows or the columns and leaves the rest. */
const shift =
	(axis: "row" | "column", map: (index: number) => number | null): CellMap =>
	(cell) => {
		const index = map(cell[axis]);
		return index === null ? null : { ...cell, [axis]: index };
	};
const deleted = (axis: "row" | "column", at: number) =>
	shift(axis, (index) =>
		index === at ? null : index > at ? index - 1 : index,
	);
const swapped = (axis: "row" | "column", a: number, b: number) =>
	shift(axis, (index) => (index === a ? b : index === b ? a : index));
/** Sorting reorders whole rows and keeps each row's node: find it again. */
const sorted: CellMap = (cell, before, after) => {
	const row = before.maybeChild(cell.row);
	for (let index = 0; index < after.childCount; index++)
		if (after.child(index) === row) return { ...cell, row: index };
	return null;
};
const unchanged: CellMap = (cell) => cell;

type MenuItem =
	| {
			readonly kind: "action";
			readonly id: string;
			readonly label: string;
			readonly icon: ComponentType<{ className?: string }>;
			readonly shortcut?: TableShortcut;
			readonly danger?: boolean;
			readonly run: (chain: ChainedCommands) => ChainedCommands;
			/**
			 * Where the caret's cell goes, for an edit that leaves the caret
			 * where it was. An insert has none: the caret goes into the new
			 * row or column, which is there to be typed into.
			 */
			readonly cells?: CellMap;
	  }
	| { readonly kind: "align"; readonly current: TableAlign }
	| { readonly kind: "label"; readonly text: string }
	| { readonly kind: "separator" };

const ALIGN_OPTIONS = [
	{ align: "left", label: "Align left", icon: AlignLeft },
	{ align: "center", label: "Align center", icon: AlignCenter },
	{ align: "right", label: "Align right", icon: AlignRight },
] as const;

/** The entries of the menu for `menu`, as the table stands now. */
export function tableMenuItems(editor: Editor, menu: TableMenu): MenuItem[] {
	const { target, axis } = menu;
	const table = editor.state.doc.nodeAt(target.tablePos);
	if (!table) return [];
	const rows = table.childCount;
	const width = tableWidth(table);
	const header = table.firstChild
		?.maybeChild(target.column)
		?.textContent.trim();
	const rowItems: MenuItem[] = [
		{
			kind: "action",
			id: "insert-row-above",
			label: "Insert above",
			icon: ArrowUpToLine,
			shortcut: "addRowBefore",
			run: (chain) => chain.addTableRowBefore(target),
		},
		{
			kind: "action",
			id: "insert-row-below",
			label: "Insert below",
			icon: ArrowDownToLine,
			shortcut: "addRowAfter",
			run: (chain) => chain.addTableRowAfter(target),
		},
	];
	// The header stays first: it does not move, and nothing moves above it.
	if (target.row >= 2)
		rowItems.push({
			kind: "action",
			id: "move-row-up",
			label: "Move up",
			icon: ArrowUp,
			shortcut: "moveRowUp",
			run: (chain) => chain.moveTableRowUp(target),
			cells: swapped("row", target.row, target.row - 1),
		});
	if (target.row >= 1 && target.row < rows - 1)
		rowItems.push({
			kind: "action",
			id: "move-row-down",
			label: "Move down",
			icon: ArrowDown,
			shortcut: "moveRowDown",
			run: (chain) => chain.moveTableRowDown(target),
			cells: swapped("row", target.row, target.row + 1),
		});
	const deleteRow: MenuItem = {
		kind: "action",
		id: "delete-row",
		label: "Delete row",
		icon: Trash2,
		shortcut: "deleteRow",
		danger: true,
		run: (chain) => chain.deleteTableRow(target),
		cells: deleted("row", target.row),
	};

	const columnItems: MenuItem[] = [
		{
			kind: "action",
			id: "insert-column-left",
			label: "Insert left",
			icon: ArrowLeftToLine,
			shortcut: "addColumnBefore",
			run: (chain) => chain.addTableColumnBefore(target),
		},
		{
			kind: "action",
			id: "insert-column-right",
			label: "Insert right",
			icon: ArrowRightToLine,
			shortcut: "addColumnAfter",
			run: (chain) => chain.addTableColumnAfter(target),
		},
		{ kind: "align", current: tableAlign(table)[target.column] ?? null },
	];
	// Sorting needs two body rows to have anything to order.
	if (rows >= 3)
		columnItems.push(
			{
				kind: "action",
				id: "sort-ascending",
				label: "Sort A → Z",
				icon: ArrowDownAZ,
				run: (chain) => chain.sortTableColumn("asc", target),
				cells: sorted,
			},
			{
				kind: "action",
				id: "sort-descending",
				label: "Sort Z → A",
				icon: ArrowDownZA,
				run: (chain) => chain.sortTableColumn("desc", target),
				cells: sorted,
			},
		);
	if (target.column > 0)
		columnItems.push({
			kind: "action",
			id: "move-column-left",
			label: "Move left",
			icon: ArrowLeft,
			shortcut: "moveColumnLeft",
			run: (chain) => chain.moveTableColumnLeft(target),
			cells: swapped("column", target.column, target.column - 1),
		});
	if (target.column < width - 1)
		columnItems.push({
			kind: "action",
			id: "move-column-right",
			label: "Move right",
			icon: ArrowRight,
			shortcut: "moveColumnRight",
			run: (chain) => chain.moveTableColumnRight(target),
			cells: swapped("column", target.column, target.column + 1),
		});
	const deleteColumn: MenuItem = {
		kind: "action",
		id: "delete-column",
		label: "Delete column",
		icon: Trash2,
		shortcut: "deleteColumn",
		danger: true,
		run: (chain) => chain.deleteTableColumn(target),
		cells: deleted("column", target.column),
	};
	const columnLabel: MenuItem = {
		kind: "label",
		text: header ? `Column · ${header}` : `Column ${target.column + 1}`,
	};
	const rowLabel: MenuItem = {
		kind: "label",
		text: target.row === 0 ? "Header row" : `Row ${target.row}`,
	};
	const byAxis: Record<TableMenuAxis, MenuItem[]> = {
		row: [rowLabel, ...rowItems, { kind: "separator" }, deleteRow],
		column: [columnLabel, ...columnItems, { kind: "separator" }, deleteColumn],
		cell: [
			rowLabel,
			...rowItems,
			{ kind: "separator" },
			columnLabel,
			...columnItems,
			{ kind: "separator" },
			deleteRow,
			deleteColumn,
		],
	};
	return byAxis[axis];
}

type Focusable =
	| {
			readonly id: string;
			readonly item: Extract<MenuItem, { kind: "action" }>;
	  }
	| { readonly id: string; readonly align: Exclude<TableAlign, null> };

/**
 * Notion-style row and column controls for the tables of a Markdown
 * document: a grip on the hovered row's left border and on the hovered
 * column's top border, "+" bars along the bottom and right edges, and the
 * menu a grip or a right click in a cell opens. Only an editable document
 * has them; on a touch screen the grips follow the caret instead of the
 * pointer. Nothing here takes focus until a menu opens, so hovering never
 * moves the caret.
 */
export function TableControls() {
	const { editor } = useEditorCtx();
	const menu =
		useEditorState<TableMenu | null>({
			editor,
			selector: () =>
				editor && !editor.isDestroyed
					? (tableControlsPluginKey.getState(editor.state)?.menu ?? null)
					: null,
			equalityFn: (a, b) =>
				a === b ||
				(a !== null &&
					b !== null &&
					a.axis === b.axis &&
					a.point === b.point &&
					sameTarget(a.target, b.target)),
		}) ?? null;
	const coarse = useCoarsePointer();
	const mounted = useEditorViewMounted(editor);
	const caretCell =
		useEditorState<TableTarget | null>({
			editor,
			selector: () =>
				editor && !editor.isDestroyed && editor.isFocused
					? tableTargetAt(editor.state)
					: null,
			equalityFn: sameTarget,
		}) ?? null;
	const [hover, setHover] = useState<TableTarget | null>(null);
	const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
	const [, setFrame] = useState(0);
	const overlayRef = useRef<HTMLDivElement>(null);
	const pendingDrag = useRef<GripDrag | null>(null);
	const suppressGripClickUntil = useRef(0);
	const showingRef = useRef(false);
	const recentlyClosed = useRef<{ key: string; at: number } | null>(null);
	const pointOrigin = useRef<{
		point: { x: number; y: number };
		left: number;
		top: number;
	} | null>(null);
	const menuId = useId();

	const finishGripDrag = useCallback(
		(event: PointerEvent) => {
			const drag = pendingDrag.current;
			if (!drag || drag.pointerId !== event.pointerId) return;
			pendingDrag.current = null;
			setDragPreview(null);
			if (!drag.started || !editor || editor.isDestroyed) return;
			event.preventDefault();
			suppressGripClickUntil.current = Date.now() + 500;
			const location =
				dropLocationAt(
					editor,
					drag.source,
					drag.axis,
					event.clientX,
					event.clientY,
				) ?? drag.location;
			if (!location) return;
			const sourceIndex =
				drag.axis === "row" ? drag.source.row : drag.source.column;
			if (location.destination === sourceIndex) return;
			if (drag.axis === "row")
				editor.commands.moveTableRowTo(location.destination, drag.source);
			else editor.commands.moveTableColumnTo(location.destination, drag.source);
			setHover(null);
		},
		[editor],
	);

	const startGripDrag = (
		event: ReactPointerEvent<HTMLButtonElement>,
		axis: "row" | "column",
		target: TableTarget,
	) => {
		if (
			event.button !== 0 ||
			event.pointerType === "touch" ||
			(axis === "row" && target.row === 0) ||
			!editor?.isEditable
		)
			return;
		pendingDrag.current = {
			pointerId: event.pointerId,
			axis,
			source: target,
			startX: event.clientX,
			startY: event.clientY,
			started: false,
			location: null,
		};
		event.preventDefault();
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			// Document-level pointer listeners remain the fallback.
		}
	};

	const onGripClick = (axis: "row" | "column", target: TableTarget) => {
		if (Date.now() < suppressGripClickUntil.current) return;
		openMenu(axis, target);
	};

	// The pointer's cell, kept while the pointer crosses the band around the
	// table to reach a grip or a bar.
	useEffect(() => {
		if (!editor || !mounted || coarse || !mountedView(editor)) return;
		let frame = 0;
		let last: PointerEvent | null = null;
		const evaluate = () => {
			frame = 0;
			const event = last;
			if (!event || editor.isDestroyed) return;
			const node = event.target as Node | null;
			if (node && overlayRef.current?.contains(node)) return;
			const element =
				node instanceof Element ? node : (node?.parentElement ?? null);
			const cell = element ? targetOfCell(editor, element) : null;
			if (cell) {
				setHover((previous) => (sameTarget(previous, cell) ? previous : cell));
				return;
			}
			setHover((previous) =>
				previous && nearTable(editor, previous, event.clientX, event.clientY)
					? previous
					: null,
			);
		};
		const onMove = (event: PointerEvent) => {
			if (event.pointerType === "touch") return;
			const drag = pendingDrag.current;
			if (drag?.pointerId === event.pointerId) {
				if (
					!drag.started &&
					Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <
						4
				)
					return;
				drag.started = true;
				drag.location = dropLocationAt(
					editor,
					drag.source,
					drag.axis,
					event.clientX,
					event.clientY,
				);
				setDragPreview({
					axis: drag.axis,
					source: drag.source,
					location: drag.location,
				});
				return;
			}
			last = event;
			if (!frame) frame = requestAnimationFrame(evaluate);
		};
		const onPointerCancel = (event: PointerEvent) => {
			if (pendingDrag.current?.pointerId !== event.pointerId) return;
			pendingDrag.current = null;
			setDragPreview(null);
		};
		// Typing puts the controls away until the pointer moves again.
		const onKeyDown = () => setHover(null);
		const onLeave = () => setHover(null);
		document.addEventListener("pointermove", onMove, { passive: true });
		document.addEventListener("pointerup", finishGripDrag);
		document.addEventListener("pointercancel", onPointerCancel);
		document.documentElement.addEventListener("pointerleave", onLeave);
		const dom = editor.view.dom;
		dom.addEventListener("keydown", onKeyDown);
		return () => {
			if (frame) cancelAnimationFrame(frame);
			document.removeEventListener("pointermove", onMove);
			document.removeEventListener("pointerup", finishGripDrag);
			document.removeEventListener("pointercancel", onPointerCancel);
			document.documentElement.removeEventListener("pointerleave", onLeave);
			dom.removeEventListener("keydown", onKeyDown);
		};
	}, [editor, mounted, coarse, finishGripDrag]);

	// Edits move tables; scrolling and resizing move everything. The layout
	// is read again on the next frame after any of them.
	useEffect(() => {
		if (!editor || !mounted) return;
		let frame = 0;
		const relayout = () => {
			// Nothing on screen, nothing to move.
			if (!showingRef.current) return;
			if (!frame)
				frame = requestAnimationFrame(() => {
					frame = 0;
					setFrame((count) => count + 1);
				});
		};
		// The hovered cell is followed through an edit, as an open menu's is.
		const onTransaction = ({ transaction }: { transaction: Transaction }) => {
			if (transaction.docChanged)
				setHover((previous) =>
					previous
						? mapTableTarget(
								transaction.before,
								previous,
								transaction.mapping,
								editor.state,
							)
						: null,
				);
			relayout();
		};
		editor.on("transaction", onTransaction);
		window.addEventListener("scroll", relayout, true);
		window.addEventListener("resize", relayout);
		return () => {
			if (frame) cancelAnimationFrame(frame);
			editor.off("transaction", onTransaction);
			window.removeEventListener("scroll", relayout, true);
			window.removeEventListener("resize", relayout);
		};
	}, [editor, mounted]);

	// A right click in a cell opens the row-and-column menu there. The
	// browser's own menu stays where it is the one wanted: over a selection
	// (to copy it), over a link, and with Shift held. What counts is the
	// selection before the click: a right click on a word selects it. Every
	// press is read, not only the right button's: on a Mac a Ctrl-click is a
	// left press that opens the menu. A menu event no press came before is the
	// keyboard's menu key (sent to the focused editor, not to a cell), and
	// opens the menu at the caret's cell.
	useEffect(() => {
		if (!editor || !mounted || !mountedView(editor)) return;
		let pressed = false;
		let hadSelection = false;
		const onPress = () => {
			pressed = true;
			hadSelection = !editor.state.selection.empty;
		};
		const onContextMenu = (event: MouseEvent) => {
			const fromPointer = pressed;
			const selected = hadSelection;
			pressed = false;
			hadSelection = false;
			if (!editor.isEditable || event.shiftKey) return;
			if (editor.isDestroyed) return;
			if (!fromPointer && event.target === editor.view.dom) {
				if (editor.commands.openTableMenuAtCaret()) event.preventDefault();
				return;
			}
			if (selected) return;
			const node = event.target as Node | null;
			const element =
				node instanceof Element ? node : (node?.parentElement ?? null);
			if (!element || element.closest("a[href]")) return;
			const target = targetOfCell(editor, element);
			if (!target) return;
			event.preventDefault();
			const table = editor.state.doc.nodeAt(target.tablePos)!;
			const cellPos = cellPosition(
				table,
				target.tablePos,
				target.row,
				target.column,
			)!;
			const cell = editor.state.doc.nodeAt(cellPos)!;
			const at = editor.view.posAtCoords({
				left: event.clientX,
				top: event.clientY,
			});
			const caret =
				at && at.pos > cellPos && at.pos < cellPos + cell.nodeSize
					? at.pos
					: cellPos + cell.nodeSize - 1;
			editor
				.chain()
				.setTextSelection(caret)
				.openTableMenu("cell", target, { x: event.clientX, y: event.clientY })
				.run();
		};
		const dom = editor.view.dom;
		dom.addEventListener("pointerdown", onPress, true);
		dom.addEventListener("mousedown", onPress, true);
		dom.addEventListener("contextmenu", onContextMenu);
		return () => {
			dom.removeEventListener("pointerdown", onPress, true);
			dom.removeEventListener("mousedown", onPress, true);
			dom.removeEventListener("contextmenu", onContextMenu);
		};
	}, [editor, mounted]);

	// Controls that go away take their menu with them: a document switched
	// to read-only or into review unmounts them, and a menu left open in the
	// editor's state would come back, and take focus, once it is editable.
	useEffect(() => {
		if (!editor) return;
		return () => {
			if (!editor.isDestroyed) editor.commands.closeTableMenu();
		};
	}, [editor]);

	const closeMenu = useCallback(() => {
		if (!editor || editor.isDestroyed) return;
		const open = tableControlsPluginKey.getState(editor.state)?.menu;
		if (open)
			recentlyClosed.current = {
				key: `${open.axis}:${open.target.tablePos}:${open.target.row}:${open.target.column}`,
				at: Date.now(),
			};
		editor.commands.closeTableMenu();
	}, [editor]);

	const openMenu = useCallback(
		(axis: TableMenuAxis, target: TableTarget) => {
			if (!editor) return;
			// A second click on the grip whose menu the first click closed.
			const key = `${axis}:${target.tablePos}:${target.row}:${target.column}`;
			const closed = recentlyClosed.current;
			if (closed?.key === key && Date.now() - closed.at < 400) return;
			editor.commands.openTableMenu(axis, target);
		},
		[editor],
	);

	// A menu whose grip or cell has scrolled out of the editor closes, the
	// way the link popover does, rather than hang on screen detached from
	// what it is about or, with no anchor to sit by, vanish while it keeps
	// the keyboard. The menu gives the focus back to the editor as it goes.
	const anchorGone = useRef(false);
	useEffect(() => {
		if (anchorGone.current) {
			anchorGone.current = false;
			closeMenu();
		}
	});

	const view = mountedView(editor);
	if (!editor || !mounted || !view || !editor.isEditable) return null;

	// While a menu is open, only the grip it came from stays: the others and
	// the "+" bars would be clicked through it, or beside it, by mistake.
	const gripMenu = menu && menu.axis !== "cell" ? menu : null;
	const active = dragPreview
		? dragPreview.source
		: menu
			? menu.target
			: ((coarse ? caretCell : hover) ?? null);
	showingRef.current = active !== null || menu !== null;
	const layout = active ? measure(editor, active) : null;
	const dropIndicator = dragPreview
		? measureDropIndicator(editor, dragPreview)
		: null;
	const portalTarget =
		(view.dom.closest(".atelier-root") as HTMLElement | null) ?? document.body;

	const table = active ? editor.state.doc.nodeAt(active.tablePos) : null;
	const lastRow = table ? table.childCount - 1 : 0;
	const lastColumn = table ? tableWidth(table) - 1 : 0;

	let menuAnchor: Rect | null = null;
	if (menu?.point) {
		// A right click's menu stays by the point clicked as its cell moves.
		const box = cellElement(editor, menu.target)?.getBoundingClientRect();
		const clip = getClipRect(editor.view.dom);
		if (box && !isAnchorClipped(box, clip)) {
			if (pointOrigin.current?.point !== menu.point)
				pointOrigin.current = {
					point: menu.point,
					left: box.left,
					top: box.top,
				};
			const origin = pointOrigin.current;
			menuAnchor = {
				left: menu.point.x + box.left - origin.left,
				top: menu.point.y + box.top - origin.top,
				width: 0,
				height: 0,
			};
		}
	} else if (menu) {
		menuAnchor =
			menu.axis === "row"
				? (layout?.rowGrip ?? null)
				: (layout?.columnGrip ?? null);
	}
	anchorGone.current = menu !== null && menuAnchor === null;
	const showGrip = (axis: "row" | "column") => !menu || gripMenu?.axis === axis;

	return createPortal(
		<>
			{layout && active ? (
				<div
					ref={overlayRef}
					className="markdown-table-controls"
					data-testid="markdown-table-controls"
				>
					{dropIndicator ? (
						<div
							className="markdown-table-drop-indicator"
							style={dropIndicator}
							aria-hidden="true"
						/>
					) : null}
					{layout.rowGrip && showGrip("row") ? (
						<button
							type="button"
							className="markdown-table-grip"
							data-axis="row"
							data-active={gripMenu?.axis === "row" ? "true" : undefined}
							data-dragging={dragPreview?.axis === "row" ? "true" : undefined}
							style={layout.rowGrip}
							aria-label={
								active.row === 0
									? "Header row options"
									: `Row ${active.row} options`
							}
							aria-haspopup="menu"
							aria-expanded={gripMenu?.axis === "row"}
							aria-controls={gripMenu?.axis === "row" ? menuId : undefined}
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onPointerDown={(event) => startGripDrag(event, "row", active)}
							onClick={() => onGripClick("row", active)}
						>
							<GripVertical aria-hidden="true" />
						</button>
					) : null}
					{layout.columnGrip && showGrip("column") ? (
						<button
							type="button"
							className="markdown-table-grip"
							data-axis="column"
							data-active={gripMenu?.axis === "column" ? "true" : undefined}
							data-dragging={
								dragPreview?.axis === "column" ? "true" : undefined
							}
							style={layout.columnGrip}
							aria-label={`Column ${active.column + 1} options`}
							aria-haspopup="menu"
							aria-expanded={gripMenu?.axis === "column"}
							aria-controls={gripMenu?.axis === "column" ? menuId : undefined}
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onPointerDown={(event) => startGripDrag(event, "column", active)}
							onClick={() => onGripClick("column", active)}
						>
							<GripHorizontal aria-hidden="true" />
						</button>
					) : null}
					{layout.addRow && !menu ? (
						<button
							type="button"
							className="markdown-table-add"
							data-edge="bottom"
							style={layout.addRow}
							aria-label="Add a row"
							title="Add a row"
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() =>
								editor
									.chain()
									.focus()
									.addTableRowAfter({ ...active, row: lastRow, column: 0 })
									.run()
							}
						>
							<Plus aria-hidden="true" />
						</button>
					) : null}
					{layout.addColumn && !menu ? (
						<button
							type="button"
							className="markdown-table-add"
							data-edge="right"
							style={layout.addColumn}
							aria-label="Add a column"
							title="Add a column"
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onClick={() =>
								editor
									.chain()
									.focus()
									.addTableColumnAfter({
										...active,
										row: 0,
										column: lastColumn,
									})
									.run()
							}
						>
							<Plus aria-hidden="true" />
						</button>
					) : null}
				</div>
			) : null}
			{menu ? (
				<TableMenuPanel
					key={`${menu.axis}:${menu.target.tablePos}:${menu.target.row}:${menu.target.column}`}
					id={menuId}
					editor={editor}
					menu={menu}
					anchor={menuAnchor}
					close={closeMenu}
				/>
			) : null}
		</>,
		portalTarget,
	);
}

/**
 * The caret, or a selection within one cell, when it is in the table at
 * `tablePos`: the cell, and the offsets in its text.
 */
function caretInTable(state: EditorState, tablePos: number) {
	const { selection } = state;
	if (!(selection instanceof TextSelection)) return null;
	const target = tableTargetAt(state, selection.head);
	if (target?.tablePos !== tablePos) return null;
	const table = state.doc.nodeAt(tablePos)!;
	const pos = cellPosition(table, tablePos, target.row, target.column)!;
	const end = pos + state.doc.nodeAt(pos)!.nodeSize - 1;
	if (selection.anchor <= pos || selection.anchor > end) return null;
	return {
		table,
		cell: { row: target.row, column: target.column },
		anchor: selection.anchor - pos - 1,
		head: selection.head - pos - 1,
	};
}

function TableMenuPanel({
	id,
	editor,
	menu,
	anchor,
	close,
}: {
	readonly id: string;
	readonly editor: Editor;
	readonly menu: TableMenu;
	readonly anchor: Rect | null;
	readonly close: () => void;
}) {
	const menuRef = useRef<HTMLDivElement>(null);
	const items = tableMenuItems(editor, menu);
	const shortcuts = useMemo(() => tableShortcuts(), []);
	const focusables = useMemo<Focusable[]>(
		() =>
			items.flatMap((item): Focusable[] =>
				item.kind === "action"
					? [{ id: item.id, item }]
					: item.kind === "align"
						? ALIGN_OPTIONS.map((option) => ({
								id: `align-${option.align}`,
								align: option.align,
							}))
						: [],
			),
		[items],
	);
	const lastAnchor = useRef(anchor);
	const [activeIndex, setActiveIndex] = useState(0);
	// Whether the keys or the pointer chose the active entry: only the keys'
	// choice is drawn as a focus ring.
	const [byKeyboard, setByKeyboard] = useState(false);
	const active = focusables[Math.min(activeIndex, focusables.length - 1)];
	const alignCurrent = items.find(
		(item): item is Extract<MenuItem, { kind: "align" }> =>
			item.kind === "align",
	)?.current;

	useMenuDismissal({ active: true, editor, menuRef, close });

	// The menu takes the keyboard while it is open. However it goes away,
	// the keyboard goes back to the editor, the caret where it was: a menu
	// closed because its grip scrolled away, or its cell was deleted by
	// someone else, would otherwise leave focus on the page, where what is
	// typed next is lost. Read before the menu leaves the page, while the
	// focus is still in it.
	useLayoutEffect(() => {
		const element = menuRef.current;
		element?.focus({ preventScroll: true });
		return () => {
			if (!element?.contains(element.ownerDocument.activeElement)) return;
			if (editor.isDestroyed || !editor.isEditable) return;
			editor.view.focus();
		};
	}, [editor]);

	// The anchor cell when the menu goes away: the caret is left in the table,
	// where it was if it was in it, else at the end of the menu's cell.
	const backToTable = useCallback(
		(chain: ChainedCommands) => {
			const { target } = menu;
			const inTable = tableTargetAt(editor.state)?.tablePos === target.tablePos;
			if (inTable) return chain;
			const table = editor.state.doc.nodeAt(target.tablePos);
			const pos = table
				? cellPosition(table, target.tablePos, target.row, target.column)
				: null;
			if (pos === null) return chain;
			return chain.setTextSelection(
				pos + editor.state.doc.nodeAt(pos)!.nodeSize - 1,
			);
		},
		[editor, menu],
	);

	const dismiss = useCallback(() => {
		backToTable(editor.chain().closeTableMenu()).focus().run();
	}, [editor, backToTable]);

	const activate = useCallback(
		(focusable: Focusable | undefined) => {
			if (!focusable) return;
			// A caret already in this table stays where it was, in its cell,
			// wherever the edit moved that cell: the grip's row or column is not
			// where the user was typing. A caret whose cell went with the edit,
			// or that was outside the table, is left where the edit put it, and
			// so is the caret of an insert, in the new cell.
			const caret = caretInTable(editor.state, menu.target.tablePos);
			const cells = "item" in focusable ? focusable.item.cells : unchanged;
			const restoreCaret = (chain: ChainedCommands) =>
				!caret || !cells
					? chain
					: chain.command(({ tr }) => {
							const { tablePos } = menu.target;
							const after = tr.doc.nodeAt(tablePos);
							if (after?.type.name !== "table") return true;
							const cell = cells(caret.cell, caret.table, after);
							const pos = cell
								? cellPosition(after, tablePos, cell.row, cell.column)
								: null;
							if (pos === null) return true;
							const size = tr.doc.nodeAt(pos)!.content.size;
							tr.setSelection(
								TextSelection.create(
									tr.doc,
									pos + 1 + Math.min(caret.anchor, size),
									pos + 1 + Math.min(caret.head, size),
								),
							);
							return true;
						});
			const chain = editor.chain().focus().closeTableMenu();
			if ("item" in focusable) {
				restoreCaret(focusable.item.run(chain)).run();
				return;
			}
			const current =
				tableAlign(editor.state.doc.nodeAt(menu.target.tablePos)!)[
					menu.target.column
				] ?? null;
			// The chosen alignment again clears it back to none.
			restoreCaret(
				chain.setTableColumnAlign(
					current === focusable.align ? null : focusable.align,
					menu.target,
				),
			).run();
		},
		[editor, menu],
	);

	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const count = focusables.length;
		const index = Math.min(activeIndex, count - 1);
		const isAlign = (at: number) =>
			focusables[at] !== undefined && "align" in focusables[at]!;
		const inAlign = isAlign(index);
		const move = (next: number) => {
			event.preventDefault();
			let to = (next + count) % count;
			// Into the alignment buttons from outside, the way a radio group is
			// entered: on the checked one, else the first.
			if (isAlign(to) && !inAlign) {
				const checked = focusables.findIndex(
					(entry) => "align" in entry && entry.align === alignCurrent,
				);
				to =
					checked >= 0
						? checked
						: focusables.findIndex((entry) => "align" in entry);
			}
			setByKeyboard(true);
			setActiveIndex(to);
		};
		switch (event.key) {
			case "ArrowDown": {
				// The alignment buttons are one row: down leaves it.
				if (inAlign) {
					const after = focusables.findIndex(
						(entry, at) => at > index && !("align" in entry),
					);
					return move(after < 0 ? 0 : after);
				}
				return move(index + 1);
			}
			case "ArrowUp": {
				if (inAlign) {
					const first = focusables.findIndex((entry) => "align" in entry);
					return move(first - 1);
				}
				return move(index - 1);
			}
			case "ArrowRight":
				if (inAlign && isAlign(index + 1)) return move(index + 1);
				event.preventDefault();
				return;
			case "ArrowLeft":
				if (inAlign && isAlign(index - 1)) return move(index - 1);
				event.preventDefault();
				return;
			case "Home":
				return move(0);
			case "End":
				return move(count - 1);
			case "Enter":
			case " ":
				event.preventDefault();
				activate(active);
				return;
			// A menu is left with Tab, as with Escape: it is not a stop in the
			// page's tab order, and the caret it was opened from gets the keys.
			case "Tab":
			case "Escape":
				event.preventDefault();
				event.stopPropagation();
				dismiss();
				return;
		}
	};

	// Entries never hold focus (the menu does), but one that somehow gets
	// it still answers Enter and Space.
	const activateOnKey =
		(at: number) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			event.stopPropagation();
			activate(focusables[at]);
		};

	// A menu whose anchor has just gone is closed on the next effect; until
	// then it stays where it was, keeping the focus it will hand back.
	if (anchor) lastAnchor.current = anchor;
	const place = anchor ?? lastAnchor.current;
	if (!place) return null;
	const clip = getClipRect(editor.view.dom);
	const height = items.reduce(
		(total, item) => total + MENU_ROW_HEIGHT[item.kind],
		MENU_PADDING,
	);
	const beside = clampToClipRect({
		coords: { top: place.top, bottom: place.top + place.height },
		clip,
		preferredHeight: height,
		gap: MENU_GAP,
	});
	// Where the whole menu fits on neither side, it slides up over its
	// anchor until it does, the way the browser's own context menu does,
	// rather than scroll in a sliver.
	const placed =
		beside.maxHeight >= height
			? beside
			: {
					top: Math.max(
						clip.top + MENU_GAP,
						Math.min(place.top, clip.bottom - height - MENU_GAP),
					),
					bottom: null,
					maxHeight: clip.bottom - clip.top - 2 * MENU_GAP,
					placement: "over" as const,
				};
	const left = clampLeft({
		left: place.left,
		width: MENU_WIDTH,
		clip,
		gap: MENU_GAP,
	});
	const activeId = active ? `markdown-table-menu-${active.id}` : undefined;

	return (
		<div
			ref={menuRef}
			id={id}
			className="markdown-slash-menu markdown-table-menu"
			style={{
				position: "fixed",
				top: placed.top ?? undefined,
				bottom: placed.bottom ?? undefined,
				left,
				width: MENU_WIDTH,
				maxHeight: placed.maxHeight,
			}}
			data-placement={placed.placement}
			data-keyboard={byKeyboard ? "true" : undefined}
			role="menu"
			aria-label={
				menu.axis === "row"
					? "Row"
					: menu.axis === "column"
						? "Column"
						: "Row and column"
			}
			aria-activedescendant={activeId}
			tabIndex={-1}
			onKeyDown={onKeyDown}
			onContextMenu={(event) => event.preventDefault()}
		>
			<div className="markdown-slash-menu-scroll">
				{items.map((item, index) => {
					if (item.kind === "separator")
						return (
							<div
								key={`separator-${index}`}
								className="markdown-table-menu-separator"
								aria-hidden="true"
							/>
						);
					if (item.kind === "label")
						return (
							<div
								key={`label-${index}`}
								className="markdown-table-menu-label"
								role="presentation"
							>
								{item.text}
							</div>
						);
					if (item.kind === "align")
						return (
							<div
								key="align"
								className="markdown-table-menu-align"
								role="group"
								aria-label="Alignment"
							>
								{ALIGN_OPTIONS.map((option) => {
									const optionId = `align-${option.align}`;
									const at = focusables.findIndex(
										(entry) => entry.id === optionId,
									);
									return (
										<div
											key={optionId}
											id={`markdown-table-menu-${optionId}`}
											className="markdown-table-menu-align-option"
											role="menuitemradio"
											aria-checked={alignCurrent === option.align}
											aria-label={option.label}
											title={option.label}
											data-active={active?.id === optionId ? "true" : undefined}
											data-checked={
												alignCurrent === option.align ? "true" : undefined
											}
											tabIndex={-1}
											onMouseDown={(event) => event.preventDefault()}
											onMouseEnter={() => {
												setByKeyboard(false);
												setActiveIndex(at);
											}}
											onClick={() => activate(focusables[at])}
											onKeyDown={activateOnKey(at)}
										>
											<option.icon aria-hidden="true" />
										</div>
									);
								})}
							</div>
						);
					const at = focusables.findIndex((entry) => entry.id === item.id);
					return (
						<div
							key={item.id}
							id={`markdown-table-menu-${item.id}`}
							className="markdown-table-menu-item"
							role="menuitem"
							data-active={active?.id === item.id ? "true" : undefined}
							data-danger={item.danger ? "true" : undefined}
							aria-keyshortcuts={
								item.shortcut
									? ariaKeyShortcuts(shortcuts[item.shortcut])
									: undefined
							}
							tabIndex={-1}
							onMouseDown={(event) => event.preventDefault()}
							onMouseEnter={() => {
								setByKeyboard(false);
								setActiveIndex(at);
							}}
							onClick={() => activate(focusables[at])}
							onKeyDown={activateOnKey(at)}
						>
							<item.icon aria-hidden="true" />
							<span className="markdown-table-menu-item-label">
								{item.label}
							</span>
							{item.shortcut ? (
								<kbd
									className="markdown-table-menu-shortcut"
									aria-hidden="true"
								>
									{formatKeyBinding(shortcuts[item.shortcut])}
								</kbd>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}
