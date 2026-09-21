import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import {
	Selection,
	TextSelection,
	type Command,
	type EditorState,
	type Transaction,
} from "@tiptap/pm/state";
import {
	EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY,
	LIST_LEADING_PARAGRAPH_DATA_KEY,
} from "./tiptap-markdown-bridge/mdwc-to-tiptap";

/**
 * Row and column edits for the editor's GFM table.
 *
 * A GFM table is a grid of one-line cells. Its first row is the header, and
 * each column carries at most an alignment (`:--`, `:-:`, `--:`); nothing
 * else can be said about a row or a column in Markdown. The schema mirrors
 * that: `table.attrs.align` holds one entry per column, and every cell
 * repeats its column's alignment and whether it sits in the first row
 * (`isHeader`), for rendering. Every command here rebuilds the table with
 * those attributes derived again from the rows' new order, so a row that
 * moves into first place becomes the header and a column keeps its
 * alignment wherever it goes.
 *
 * Each command replaces the table in one step, so it is one undo step, and
 * places the caret in the cell the edit is about.
 */

export type TableAlign = "left" | "center" | "right" | null;

/** A cell of a table: the table's position, the cell's row and column. */
export type TableTarget = {
	readonly tablePos: number;
	readonly row: number;
	readonly column: number;
};

export type SortDirection = "asc" | "desc";

/** The transaction meta every table edit carries. */
export const TABLE_EDIT_META = "markdownTableEdit";

/** The cell the selection's start is in, or null outside a table. */
export function tableTargetAt(
	state: EditorState,
	pos: number = state.selection.from,
): TableTarget | null {
	const $pos = state.doc.resolve(pos);
	for (let depth = $pos.depth; depth > 2; depth--) {
		if ($pos.node(depth).type.name !== "tableCell") continue;
		if ($pos.node(depth - 1).type.name !== "tableRow") return null;
		if ($pos.node(depth - 2).type.name !== "table") return null;
		return {
			tablePos: $pos.before(depth - 2),
			row: $pos.index(depth - 2),
			column: $pos.index(depth - 1),
		};
	}
	return null;
}

/** Position of the cell at `row`/`column` of the table at `tablePos`. */
export function cellPosition(
	table: ProseMirrorNode,
	tablePos: number,
	row: number,
	column: number,
): number | null {
	if (row < 0 || row >= table.childCount) return null;
	let pos = tablePos + 1;
	for (let index = 0; index < row; index++) pos += table.child(index).nodeSize;
	const rowNode = table.child(row);
	if (column < 0 || column >= rowNode.childCount) return null;
	pos += 1;
	for (let index = 0; index < column; index++)
		pos += rowNode.child(index).nodeSize;
	return pos;
}

/** The number of columns: the header's width, as GFM counts it. */
export function tableWidth(table: ProseMirrorNode): number {
	return table.firstChild?.childCount ?? 0;
}

/** `table.attrs.align`, one entry per column. */
export function tableAlign(table: ProseMirrorNode): TableAlign[] {
	const align = Array.isArray(table.attrs.align) ? table.attrs.align : [];
	return Array.from(
		{ length: tableWidth(table) },
		(_, column) => (align[column] as TableAlign | undefined) ?? null,
	);
}

type Row = {
	/** The row this one was, whose attributes (its id) it keeps. */
	readonly node: ProseMirrorNode | null;
	readonly cells: readonly ProseMirrorNode[];
};

type Caret = {
	readonly row: number;
	readonly column: number;
	/** The offset in the cell's text; past its end means the end. */
	readonly offset: number;
};

/**
 * The rows and columns an edit acts on: the target's own, or, when the
 * selection runs across cells of its table, every row and column from the
 * selection's first cell to its last, as a spreadsheet takes them.
 */
type Range = {
	readonly top: number;
	readonly bottom: number;
	readonly left: number;
	readonly right: number;
};

/** Where the selection's ends go: its cells moved by rows and columns. */
type Shift = { readonly rows: number; readonly columns: number };

type Edit =
	| { readonly rows: readonly Row[]; readonly align: readonly TableAlign[] }
	| { readonly deleteTable: true };

type Context = {
	readonly state: EditorState;
	readonly table: ProseMirrorNode;
	readonly target: TableTarget;
	readonly rows: Row[];
	readonly align: TableAlign[];
	readonly width: number;
	/** Where the caret is in the target cell, when it is in it. */
	readonly offset: number;
	readonly range: Range;
	readonly emptyCell: (row: number, column: number) => ProseMirrorNode;
};

function resolveTarget(
	state: EditorState,
	target: TableTarget | undefined,
): { table: ProseMirrorNode; target: TableTarget } | null {
	const resolved = target ?? tableTargetAt(state);
	if (!resolved) return null;
	const table = state.doc.nodeAt(resolved.tablePos);
	if (table?.type.name !== "table") return null;
	if (resolved.row < 0 || resolved.row >= table.childCount) return null;
	const width = tableWidth(table);
	if (resolved.column < 0 || resolved.column >= width) return null;
	return { table, target: resolved };
}

function contextFor(
	state: EditorState,
	table: ProseMirrorNode,
	target: TableTarget,
): Context {
	const width = tableWidth(table);
	const align = tableAlign(table);
	const cellType = state.schema.nodes.tableCell!;
	const emptyCell = (row: number, column: number) =>
		cellType.create({ isHeader: row === 0, align: align[column] ?? null });
	const rows: Row[] = [];
	table.forEach((row) => {
		const cells: ProseMirrorNode[] = [];
		row.forEach((cell) => cells.push(cell));
		rows.push({ node: row, cells });
	});
	const inTarget = tableTargetAt(state);
	const offset =
		inTarget &&
		inTarget.tablePos === target.tablePos &&
		inTarget.row === target.row &&
		inTarget.column === target.column
			? state.selection.$from.parentOffset
			: Number.POSITIVE_INFINITY;
	const range = selectedRange(state, target);
	return { state, table, target, rows, align, width, offset, range, emptyCell };
}

function selectedRange(state: EditorState, target: TableTarget): Range {
	const single = {
		top: target.row,
		bottom: target.row,
		left: target.column,
		right: target.column,
	};
	const { selection } = state;
	if (selection.empty) return single;
	const from = tableTargetAt(state, selection.from);
	const to = tableTargetAt(state, selection.to);
	if (from?.tablePos !== target.tablePos || to?.tablePos !== target.tablePos)
		return single;
	const range = {
		top: Math.min(from.row, to.row),
		bottom: Math.max(from.row, to.row),
		left: Math.min(from.column, to.column),
		right: Math.max(from.column, to.column),
	};
	// A menu opened on a cell outside the selection acts on that cell.
	const inside =
		target.row >= range.top &&
		target.row <= range.bottom &&
		target.column >= range.left &&
		target.column <= range.right;
	return inside ? range : single;
}

/** Rows padded to the header's width, for an edit to a column. */
function paddedRows(context: Context): Row[] {
	return context.rows.map((row, rowIndex) => {
		if (row.cells.length >= context.width) return row;
		const cells = [...row.cells];
		while (cells.length < context.width)
			cells.push(context.emptyCell(rowIndex, cells.length));
		return { node: row.node, cells };
	});
}

/**
 * The table the rows make: the first row the header, each cell aligned as
 * its column. Nodes that already say so are reused as they are.
 */
function buildTable(
	schema: Schema,
	table: ProseMirrorNode,
	rows: readonly Row[],
	align: readonly TableAlign[],
): ProseMirrorNode {
	const width = rows[0]?.cells.length ?? 0;
	const columns = Array.from(
		{ length: width },
		(_, column) => align[column] ?? null,
	);
	const rowType = schema.nodes.tableRow!;
	const built = rows.map((row, rowIndex) => {
		const cells = row.cells.map((cell, column) => {
			const isHeader = rowIndex === 0;
			const cellAlign = columns[column] ?? null;
			if (cell.attrs.isHeader === isHeader && cell.attrs.align === cellAlign)
				return cell;
			return cell.type.create(
				{ ...cell.attrs, isHeader, align: cellAlign },
				cell.content,
				cell.marks,
			);
		});
		const node = row.node;
		if (
			node &&
			node.childCount === cells.length &&
			cells.every((cell, index) => cell === node.child(index))
		)
			return node;
		return rowType.create(node?.attrs ?? null, cells);
	});
	return table.type.create(
		{ ...table.attrs, align: columns },
		built,
		table.marks,
	);
}

/** Containers that exist only for what they hold: emptied, they go too. */
const HOLLOW_CONTAINERS = new Set([
	"blockquote",
	"listItem",
	"bulletList",
	"orderedList",
]);

/** The empty paragraph that opens an item starting with another block. */
function isListScaffold(node: ProseMirrorNode): boolean {
	return (
		node.type.name === "paragraph" &&
		node.childCount === 0 &&
		Boolean(node.attrs.data?.[LIST_LEADING_PARAGRAPH_DATA_KEY])
	);
}

/**
 * Where the caret goes once the block at `pos` is gone: the end of the
 * nearest line of text above, else the start of the one below. Never a
 * rule, an image or a table selected whole, and never a code block, where
 * the next key would delete, or type into, something the user did not
 * point at.
 */
function textCaretNear(doc: ProseMirrorNode, pos: number): Selection | null {
	const takes = (node: ProseMirrorNode) =>
		node.isTextblock && !node.type.spec.code;
	let before: number | null = null;
	doc.nodesBetween(0, pos, (node, nodePos) => {
		if (!node.isTextblock) return true;
		if (takes(node) && nodePos + node.nodeSize <= pos)
			before = nodePos + node.nodeSize - 1;
		return false;
	});
	if (before !== null) return TextSelection.create(doc, before);
	let after: number | null = null;
	doc.nodesBetween(pos, doc.content.size, (node, nodePos) => {
		if (after !== null) return false;
		if (!node.isTextblock) return true;
		if (takes(node) && nodePos >= pos) after = nodePos + 1;
		return false;
	});
	return after === null ? null : TextSelection.create(doc, after);
}

/**
 * Removes the table at `tablePos`, the way Backspace removes an emptied
 * one. A quote or list item the table was all of goes with it, rather than
 * stay behind as a bare `>` or `-`. The caret goes to the nearest line of
 * text; with none left, to an empty line where the table was.
 */
export function deleteTableTransaction(
	state: EditorState,
	tablePos: number,
): Transaction {
	const table = state.doc.nodeAt(tablePos)!;
	const $table = state.doc.resolve(tablePos);
	let from = tablePos;
	let to = tablePos + table.nodeSize;
	for (let depth = $table.depth; depth > 0; depth--) {
		const parent = $table.node(depth);
		if (!HOLLOW_CONTAINERS.has(parent.type.name)) break;
		const start = $table.start(depth);
		let rest = false;
		parent.forEach((child, offset) => {
			const childPos = start + offset;
			if (childPos >= from && childPos < to) return;
			if (!isListScaffold(child)) rest = true;
		});
		if (rest) break;
		from = $table.before(depth);
		to = $table.after(depth);
	}
	const tr = state.tr.delete(from, to);
	const container = tr.doc.resolve(from).parent;
	// A document, or a footnote, cannot be empty: the empty line stands in.
	const caret = container.childCount > 0 ? textCaretNear(tr.doc, from) : null;
	if (caret) return tr.setSelection(caret);
	// With nothing but rules, images and code around, an empty line where
	// the table was, as Notion leaves one; at the top level it is kept out
	// of the file until it is typed into.
	tr.insert(
		from,
		state.schema.nodes.paragraph!.create(
			container.type === tr.doc.type
				? { data: { [EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY]: true } }
				: null,
		),
	);
	return tr.setSelection(TextSelection.create(tr.doc, from + 1));
}

function tableCommand(
	target: TableTarget | undefined,
	edit: (
		context: Context,
	) => { edit: Edit; caret?: Caret; shift?: Shift } | false,
): Command {
	return (state, dispatch) => {
		const resolved = resolveTarget(state, target);
		if (!resolved) return false;
		const context = contextFor(state, resolved.table, resolved.target);
		const result = edit(context);
		if (!result) return false;
		if (!dispatch) return true;
		const { tablePos } = resolved.target;
		if ("deleteTable" in result.edit) {
			dispatch(
				deleteTableTransaction(state, tablePos)
					.setMeta(TABLE_EDIT_META, true)
					.scrollIntoView(),
			);
			return true;
		}
		const next = buildTable(
			state.schema,
			resolved.table,
			result.edit.rows,
			result.edit.align,
		);
		const tr = state.tr;
		if (!next.eq(resolved.table))
			tr.replaceWith(tablePos, tablePos + resolved.table.nodeSize, next);
		const caret = result.caret;
		const shifted = result.shift
			? shiftedSelection(state, tr.doc, tablePos, result.shift)
			: null;
		if (shifted) tr.setSelection(shifted);
		else if (caret) {
			const table = tr.doc.nodeAt(tablePos)!;
			const row = Math.min(caret.row, table.childCount - 1);
			const rowNode = table.child(row);
			const column = Math.min(caret.column, rowNode.childCount - 1);
			const cellPos = cellPosition(table, tablePos, row, column)!;
			const cell = tr.doc.nodeAt(cellPos)!;
			const offset = Math.min(caret.offset, cell.content.size);
			tr.setSelection(TextSelection.create(tr.doc, cellPos + 1 + offset));
		}
		dispatch(tr.setMeta(TABLE_EDIT_META, true).scrollIntoView());
		return true;
	};
}

/**
 * The selection with each end in the cell its cell moved to, at the same
 * offset, when both ends are in the table at `tablePos`.
 */
function shiftedSelection(
	state: EditorState,
	doc: ProseMirrorNode,
	tablePos: number,
	shift: Shift,
): Selection | null {
	const table = doc.nodeAt(tablePos);
	if (table?.type.name !== "table") return null;
	const place = (pos: number) => {
		const at = tableTargetAt(state, pos);
		if (at?.tablePos !== tablePos) return null;
		const cellPos = cellPosition(
			table,
			tablePos,
			at.row + shift.rows,
			at.column + shift.columns,
		);
		if (cellPos === null) return null;
		const offset = state.doc.resolve(pos).parentOffset;
		return cellPos + 1 + Math.min(offset, doc.nodeAt(cellPos)!.content.size);
	};
	const anchor = place(state.selection.anchor);
	const head = place(state.selection.head);
	if (anchor === null || head === null) return null;
	return TextSelection.create(doc, anchor, head);
}

/**
 * A new empty row above or below the target's. A row "above" the header
 * becomes the header: in Markdown the first row is always the header, so
 * the new, empty row takes that place and the old header becomes the first
 * body row, with its text intact. That is Notion's "Insert above" on a
 * header row, too: the new row is where the user asked for it.
 */
export function addRow(
	side: "before" | "after",
	target?: TableTarget,
): Command {
	return tableCommand(target, (context) => {
		const index = context.target.row + (side === "after" ? 1 : 0);
		const cells = Array.from({ length: context.width }, (_, column) =>
			context.emptyCell(index, column),
		);
		const rows = [...context.rows];
		rows.splice(index, 0, { node: null, cells });
		return {
			edit: { rows, align: context.align },
			caret: { row: index, column: context.target.column, offset: 0 },
		};
	});
}

/**
 * Deletes the target's row, or every row the selection spans. Deleting the
 * header promotes the next row to header; deleting every row deletes the
 * table.
 */
export function deleteRow(target?: TableTarget): Command {
	return tableCommand(target, (context) => {
		const { top, bottom } = context.range;
		if (bottom - top + 1 >= context.rows.length)
			return { edit: { deleteTable: true } };
		const rows = context.rows.filter(
			(_, index) => index < top || index > bottom,
		);
		return {
			edit: { rows, align: context.align },
			// The row that took their place, or the one above at the end.
			caret: {
				row: Math.min(top, rows.length - 1),
				column: context.target.column,
				offset: Number.POSITIVE_INFINITY,
			},
		};
	});
}

/**
 * Moves the target's row, or the rows the selection spans, one place past
 * its neighbour. The header stays first: it cannot move down, and the
 * first body row cannot move above it. The selection moves with the rows.
 */
export function moveRow(direction: -1 | 1, target?: TableTarget): Command {
	return tableCommand(target, (context) => {
		const { top, bottom } = context.range;
		if (top === 0) return false;
		if (direction < 0 ? top - 1 < 1 : bottom + 1 >= context.rows.length)
			return false;
		const rows = [...context.rows];
		const block = rows.splice(top, bottom - top + 1);
		rows.splice(top + direction, 0, ...block);
		return {
			edit: { rows, align: context.align },
			caret: {
				row: context.target.row + direction,
				column: context.target.column,
				offset: context.offset,
			},
			shift: { rows: direction, columns: 0 },
		};
	});
}

/** A new empty column left or right of the target's, with no alignment. */
export function addColumn(
	side: "before" | "after",
	target?: TableTarget,
): Command {
	return tableCommand(target, (context) => {
		const index = context.target.column + (side === "after" ? 1 : 0);
		const align = [...context.align];
		align.splice(index, 0, null);
		const cellType = context.state.schema.nodes.tableCell!;
		const rows = paddedRows(context).map((row, rowIndex) => {
			const cells = [...row.cells];
			cells.splice(
				index,
				0,
				cellType.create({ isHeader: rowIndex === 0, align: null }),
			);
			return { node: row.node, cells };
		});
		return {
			edit: { rows, align },
			caret: { row: context.target.row, column: index, offset: 0 },
		};
	});
}

/**
 * Deletes the target's column, or every column the selection spans, with
 * their alignment; deleting every column deletes the table.
 */
export function deleteColumn(target?: TableTarget): Command {
	return tableCommand(target, (context) => {
		const { left, right } = context.range;
		if (right - left + 1 >= context.width)
			return { edit: { deleteTable: true } };
		const kept = (_: unknown, index: number) => index < left || index > right;
		const align = context.align.filter(kept);
		const rows = paddedRows(context).map((row) => ({
			node: row.node,
			cells: row.cells.filter(kept),
		}));
		return {
			edit: { rows, align },
			// The column that took their place, or the one left of it at the end.
			caret: {
				row: context.target.row,
				column: Math.min(left, align.length - 1),
				offset: Number.POSITIVE_INFINITY,
			},
		};
	});
}

/**
 * Moves the target's column, or the columns the selection spans, with
 * their alignment, one place past its neighbour. The selection moves with
 * them.
 */
export function moveColumn(direction: -1 | 1, target?: TableTarget): Command {
	return tableCommand(target, (context) => {
		const { left, right } = context.range;
		if (direction < 0 ? left - 1 < 0 : right + 1 >= context.width) return false;
		const move = <T>(items: readonly T[]) => {
			const next = [...items];
			const block = next.splice(left, right - left + 1);
			next.splice(left + direction, 0, ...block);
			return next;
		};
		const rows = paddedRows(context).map((row) => ({
			node: row.node,
			cells: move(row.cells),
		}));
		return {
			edit: { rows, align: move(context.align) },
			caret: {
				row: context.target.row,
				column: context.target.column + direction,
				offset: context.offset,
			},
			shift: { rows: 0, columns: direction },
		};
	});
}

/**
 * Aligns the target's column, or every column the selection spans; null
 * writes a plain `---` delimiter.
 */
export function setColumnAlign(
	align: TableAlign,
	target?: TableTarget,
): Command {
	return tableCommand(target, (context) => {
		const { left, right } = context.range;
		const next = context.align.map((current, column) =>
			column >= left && column <= right ? align : current,
		);
		return {
			edit: { rows: context.rows, align: next },
			caret: {
				row: context.target.row,
				column: context.target.column,
				offset: context.offset,
			},
			shift: { rows: 0, columns: 0 },
		};
	});
}

const collator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

/**
 * A cell's value as a number when all it says is one: a sign, a currency
 * symbol, thousands separated by commas, a decimal point, a percent sign
 * ("-5", "1,000", "$1,000.50", "12 %", "€ 3"). The collator's numeric
 * option compares runs of digits only, so it read "-10" as more than "-5",
 * "1.25" as more than "1.5" and "$30" as more than "$1,000".
 */
const NUMBER =
	/^([-+\u2212]?)\s*[$€£¥]?\s*([-+\u2212]?)(\d{1,3}(?:,\d{3})+|\d*)(\.\d+)?\s*(?:%|[$€£¥])?$/;

function numericValue(text: string): number | null {
	const match = NUMBER.exec(text);
	if (!match) return null;
	const [, before = "", after = "", whole = "", fraction = ""] = match;
	if (!whole && !fraction) return null;
	if (before && after) return null;
	const value = Number(whole.replace(/,/g, "") + fraction);
	return /[-\u2212]/.test(before + after) ? -value : value;
}

/**
 * What a cell is sorted by: its text, or for a cell holding only an image,
 * the image's alt text or address, so it is not taken for an empty cell.
 */
function sortText(cell: ProseMirrorNode | undefined): string {
	if (!cell) return "";
	const text = cell.textContent.trim();
	if (text) return text;
	const images: string[] = [];
	cell.descendants((node) => {
		if (node.type.name === "image")
			images.push(String(node.attrs.alt || node.attrs.src || ""));
		return true;
	});
	return images.join(" ").trim();
}

type SortKey = { readonly text: string; readonly number: number | null };

/**
 * Ascending order: numbers by value, then text naturally ("item 2" before
 * "item 10"). Empty cells are left to the caller, which puts them last.
 */
function compareKeys(a: SortKey, b: SortKey): number {
	if (a.number !== null && b.number !== null) return a.number - b.number;
	if (a.number !== null) return -1;
	if (b.number !== null) return 1;
	return collator.compare(a.text, b.text);
}

/**
 * Orders the body rows by the target column: numbers by value before text,
 * text naturally, Z → A exactly reversed. Empty cells go last either way;
 * the header stays first. The caret stays in its row, wherever that row
 * goes.
 */
export function sortColumn(
	direction: SortDirection,
	target?: TableTarget,
): Command {
	return tableCommand(target, (context) => {
		const column = context.target.column;
		const [header, ...body] = context.rows;
		if (!header) return false;
		const sign = direction === "asc" ? 1 : -1;
		const sorted = body
			.map((row, index) => {
				const text = sortText(row.cells[column]);
				return { row, index, key: { text, number: numericValue(text) } };
			})
			.sort((a, b) => {
				if (!a.key.text || !b.key.text)
					return (a.key.text ? 0 : 1) - (b.key.text ? 0 : 1);
				return sign * compareKeys(a.key, b.key);
			});
		const rows = [header, ...sorted.map((entry) => entry.row)];
		const caretRow =
			context.target.row === 0
				? 0
				: 1 +
					sorted.findIndex((entry) => entry.index === context.target.row - 1);
		return {
			edit: { rows, align: context.align },
			caret: {
				row: caretRow,
				column: context.target.column,
				offset: context.offset,
			},
		};
	});
}

/**
 * A paragraph with nothing a reader would see: no text but white space and
 * line breaks. Keys that leave a table remove such a line rather than keep
 * an invisible one around it.
 */
export function isBlankLine(node: ProseMirrorNode | null | undefined): boolean {
	if (node?.type.name !== "paragraph") return false;
	let blank = true;
	node.forEach((child) => {
		if (
			child.isText
				? /\S/.test(child.text ?? "")
				: child.type.name !== "hardBreak"
		)
			blank = false;
	});
	return blank;
}
