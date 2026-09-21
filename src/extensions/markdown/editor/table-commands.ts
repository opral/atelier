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
	return { state, table, target, rows, align, width, offset, emptyCell };
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
	edit: (context: Context) => { edit: Edit; caret?: Caret } | false,
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
		if (caret) {
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
 * Deletes the target's row. Deleting the header promotes the next row to
 * header; deleting the only row deletes the table.
 */
export function deleteRow(target?: TableTarget): Command {
	return tableCommand(target, (context) => {
		if (context.rows.length <= 1) return { edit: { deleteTable: true } };
		const rows = context.rows.filter(
			(_, index) => index !== context.target.row,
		);
		return {
			edit: { rows, align: context.align },
			// The row that took its place, or the one above at the end.
			caret: {
				row: Math.min(context.target.row, rows.length - 1),
				column: context.target.column,
				offset: Number.POSITIVE_INFINITY,
			},
		};
	});
}

/**
 * Swaps the target's row with its neighbour. The header stays first: it
 * cannot move down, and the first body row cannot move above it.
 */
export function moveRow(direction: -1 | 1, target?: TableTarget): Command {
	return tableCommand(target, (context) => {
		const from = context.target.row;
		const to = from + direction;
		if (from === 0 || to < 1 || to >= context.rows.length) return false;
		const rows = [...context.rows];
		[rows[from], rows[to]] = [rows[to]!, rows[from]!];
		return {
			edit: { rows, align: context.align },
			caret: { row: to, column: context.target.column, offset: context.offset },
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

/** Deletes the target's column; deleting the only column deletes the table. */
export function deleteColumn(target?: TableTarget): Command {
	return tableCommand(target, (context) => {
		if (context.width <= 1) return { edit: { deleteTable: true } };
		const column = context.target.column;
		const align = context.align.filter((_, index) => index !== column);
		const rows = paddedRows(context).map((row) => ({
			node: row.node,
			cells: row.cells.filter((_, index) => index !== column),
		}));
		return {
			edit: { rows, align },
			// The column that took its place, or the one left of it at the end.
			caret: {
				row: context.target.row,
				column: Math.min(column, context.width - 2),
				offset: Number.POSITIVE_INFINITY,
			},
		};
	});
}

/** Swaps the target's column, with its alignment, with its neighbour. */
export function moveColumn(direction: -1 | 1, target?: TableTarget): Command {
	return tableCommand(target, (context) => {
		const from = context.target.column;
		const to = from + direction;
		if (to < 0 || to >= context.width) return false;
		const swap = <T>(items: readonly T[]) => {
			const next = [...items];
			[next[from], next[to]] = [next[to]!, next[from]!];
			return next;
		};
		const rows = paddedRows(context).map((row) => ({
			node: row.node,
			cells: swap(row.cells),
		}));
		return {
			edit: { rows, align: swap(context.align) },
			caret: { row: context.target.row, column: to, offset: context.offset },
		};
	});
}

/** Aligns the target's column; null writes a plain `---` delimiter. */
export function setColumnAlign(
	align: TableAlign,
	target?: TableTarget,
): Command {
	return tableCommand(target, (context) => {
		const next = [...context.align];
		next[context.target.column] = align;
		return {
			edit: { rows: context.rows, align: next },
			caret: {
				row: context.target.row,
				column: context.target.column,
				offset: context.offset,
			},
		};
	});
}

const collator = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: "base",
});

/**
 * Orders the body rows by the target column's text, naturally ("item 2"
 * before "item 10"). Empty cells go last either way; the header stays first.
 * The caret stays in its row, wherever that row goes.
 */
export function sortColumn(
	direction: SortDirection,
	target?: TableTarget,
): Command {
	return tableCommand(target, (context) => {
		const column = context.target.column;
		const [header, ...body] = context.rows;
		if (!header) return false;
		const text = (row: Row) => row.cells[column]?.textContent.trim() ?? "";
		const sign = direction === "asc" ? 1 : -1;
		const sorted = body
			.map((row, index) => ({ row, index, text: text(row) }))
			.sort((a, b) => {
				if (!a.text || !b.text) return (a.text ? 0 : 1) - (b.text ? 0 : 1);
				return sign * collator.compare(a.text, b.text);
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
