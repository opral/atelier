import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import {
	Plugin,
	PluginKey,
	type Command,
	type EditorState,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { isMacPlatform } from "@/lib/platform";
import {
	addColumn,
	addRow,
	cellPosition,
	deleteColumn,
	deleteRow,
	moveColumn,
	moveRow,
	setColumnAlign,
	sortColumn,
	TABLE_EDIT_META,
	tableTargetAt,
	tableWidth,
	type SortDirection,
	type TableAlign,
	type TableTarget,
} from "../table-commands";

/**
 * Which part of a table a menu is about: a row or a column from its grip,
 * or both from a right click in a cell.
 */
export type TableMenuAxis = "row" | "column" | "cell";

export type TableMenu = {
	readonly axis: TableMenuAxis;
	readonly target: TableTarget;
	/** Where the pointer was, for a menu opened with a right click. */
	readonly point: { readonly x: number; readonly y: number } | null;
};

export type TableMenuState = { readonly menu: TableMenu | null };

export const tableControlsPluginKey = new PluginKey<TableMenuState>(
	"markdownTableControls",
);

const CLOSED: TableMenuState = { menu: null };

/**
 * The table keys, as ProseMirror names them. Chrome on macOS keeps ⌘⌥← and
 * ⌘⌥→ for switching tabs and never hands them to the page, so a column is
 * inserted with Shift added. ⌥⇧← and ⌥⇧→ extend a selection by a word on
 * macOS, so there a column moves with ⌃⇧ instead, and a row with the same
 * modifiers, so the two read as a pair.
 */
export function tableShortcuts(mac: boolean = isMacPlatform()) {
	const move = mac ? "Ctrl-Shift" : "Alt-Shift";
	return {
		addRowBefore: "Mod-Alt-ArrowUp",
		addRowAfter: "Mod-Alt-ArrowDown",
		addColumnBefore: "Mod-Alt-Shift-ArrowLeft",
		addColumnAfter: "Mod-Alt-Shift-ArrowRight",
		deleteRow: "Mod-Alt-Backspace",
		deleteColumn: "Mod-Alt-Shift-Backspace",
		moveRowUp: `${move}-ArrowUp`,
		moveRowDown: `${move}-ArrowDown`,
		moveColumnLeft: `${move}-ArrowLeft`,
		moveColumnRight: `${move}-ArrowRight`,
	} as const;
}

export type TableShortcut = keyof ReturnType<typeof tableShortcuts>;

declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		tableControls: {
			/**
			 * Inserts an empty row above the target cell's row, or the caret's
			 * when no target is given. The other table commands take their
			 * target the same way.
			 */
			addTableRowBefore: (target?: TableTarget) => ReturnType;
			addTableRowAfter: (target?: TableTarget) => ReturnType;
			deleteTableRow: (target?: TableTarget) => ReturnType;
			moveTableRowUp: (target?: TableTarget) => ReturnType;
			moveTableRowDown: (target?: TableTarget) => ReturnType;
			addTableColumnBefore: (target?: TableTarget) => ReturnType;
			addTableColumnAfter: (target?: TableTarget) => ReturnType;
			deleteTableColumn: (target?: TableTarget) => ReturnType;
			moveTableColumnLeft: (target?: TableTarget) => ReturnType;
			moveTableColumnRight: (target?: TableTarget) => ReturnType;
			setTableColumnAlign: (
				align: TableAlign,
				target?: TableTarget,
			) => ReturnType;
			sortTableColumn: (
				direction: SortDirection,
				target?: TableTarget,
			) => ReturnType;
			/** Opens the row, column or combined menu for a cell. */
			openTableMenu: (
				axis: TableMenuAxis,
				target: TableTarget,
				point?: { x: number; y: number } | null,
			) => ReturnType;
			closeTableMenu: () => ReturnType;
		};
	}
}

/** The target, if it is still a cell of a table in `state`. */
function stillACell(
	state: EditorState,
	target: TableTarget,
): TableTarget | null {
	const table = state.doc.nodeAt(target.tablePos);
	if (table?.type.name !== "table") return null;
	if (target.row >= table.childCount) return null;
	if (target.column >= tableWidth(table)) return null;
	return target;
}

/** The row or column a grip's menu is about, tinted like a selection. */
function highlight(state: EditorState, menu: TableMenu | null) {
	if (!menu || menu.axis === "cell") return DecorationSet.empty;
	const { tablePos, row, column } = menu.target;
	const table = state.doc.nodeAt(tablePos);
	if (!table) return DecorationSet.empty;
	const cells =
		menu.axis === "row"
			? Array.from({ length: table.child(row).childCount }, (_, index) => ({
					row,
					column: index,
				}))
			: Array.from({ length: table.childCount }, (_, index) => ({
					row: index,
					column,
				}));
	const decorations: Decoration[] = [];
	for (const cell of cells) {
		const pos = cellPosition(table, tablePos, cell.row, cell.column);
		if (pos === null) continue;
		decorations.push(
			Decoration.node(pos, pos + state.doc.nodeAt(pos)!.nodeSize, {
				class: "markdown-table-cell-selected",
			}),
		);
	}
	return DecorationSet.create(state.doc, decorations);
}

/**
 * Each table edit is one undo step, and what is typed after it the next:
 * without this the history joins an inserted row and the text typed into it
 * within half a second. The boundary is drawn after every other plugin has
 * appended to the edit (the ids of new cells belong to its step), so the
 * plugin is registered once the editor exists, at the end of the list.
 */
function historyBoundaryPlugin() {
	return new Plugin({
		key: new PluginKey("markdownTableHistoryBoundary"),
		appendTransaction(transactions, _oldState, newState) {
			if (!transactions.some((tr) => tr.getMeta(TABLE_EDIT_META))) return null;
			return closeHistory(newState.tr);
		},
	});
}

/**
 * Row and column editing for GFM tables: the commands, their keys, the
 * state of the row and column menus, and the tint on the row or column a
 * menu is about. The grips and menus themselves are `TableControls`.
 */
export const TableControlsExtension = Extension.create({
	name: "markdownTableControls",
	// Ahead of the base keymap, like the table's other keys.
	priority: 1100,

	onCreate() {
		this.editor.registerPlugin(historyBoundaryPlugin());
	},

	addProseMirrorPlugins() {
		return [
			new Plugin<TableMenuState>({
				key: tableControlsPluginKey,
				state: {
					init: () => CLOSED,
					apply(tr, previous, _oldState, newState) {
						const meta = tr.getMeta(tableControlsPluginKey) as
							| TableMenuState
							| undefined;
						if (meta) return meta;
						// An edit from a menu closes it; any other edit keeps it on
						// its cell, and closes it once the cell is gone.
						if (tr.getMeta(TABLE_EDIT_META)) return CLOSED;
						const menu = previous.menu;
						if (!menu || !tr.docChanged) return previous;
						const mapped = tr.mapping.mapResult(menu.target.tablePos, 1);
						if (mapped.deleted) return CLOSED;
						const target = stillACell(newState, {
							...menu.target,
							tablePos: mapped.pos,
						});
						return target ? { menu: { ...menu, target } } : CLOSED;
					},
				},
				props: {
					decorations(state) {
						return highlight(
							state,
							tableControlsPluginKey.getState(state)?.menu ?? null,
						);
					},
				},
			}),
		];
	},

	addCommands() {
		// Each edit also starts its own undo step. The state TipTap hands a
		// command reads from, and writes to, the chain's transaction.
		const run =
			(command: Command) =>
			({ state, dispatch }: { state: EditorState; dispatch?: unknown }) =>
				command(state, dispatch ? (tr) => void closeHistory(tr) : undefined);
		return {
			addTableRowBefore: (target) => run(addRow("before", target)),
			addTableRowAfter: (target) => run(addRow("after", target)),
			deleteTableRow: (target) => run(deleteRow(target)),
			moveTableRowUp: (target) => run(moveRow(-1, target)),
			moveTableRowDown: (target) => run(moveRow(1, target)),
			addTableColumnBefore: (target) => run(addColumn("before", target)),
			addTableColumnAfter: (target) => run(addColumn("after", target)),
			deleteTableColumn: (target) => run(deleteColumn(target)),
			moveTableColumnLeft: (target) => run(moveColumn(-1, target)),
			moveTableColumnRight: (target) => run(moveColumn(1, target)),
			setTableColumnAlign: (align, target) =>
				run(setColumnAlign(align, target)),
			sortTableColumn: (direction, target) =>
				run(sortColumn(direction, target)),
			openTableMenu:
				(axis, target, point = null) =>
				({ state, tr, dispatch }) => {
					if (!stillACell(state, target)) return false;
					dispatch?.(
						tr.setMeta(tableControlsPluginKey, {
							menu: { axis, target, point },
						}),
					);
					return true;
				},
			closeTableMenu:
				() =>
				({ state, tr, dispatch }) => {
					if (!tableControlsPluginKey.getState(state)?.menu) return false;
					dispatch?.(tr.setMeta(tableControlsPluginKey, CLOSED));
					return true;
				},
		};
	},

	addKeyboardShortcuts() {
		const keys = tableShortcuts();
		const commands = () => this.editor.commands;
		const inTable = () => tableTargetAt(this.editor.state) !== null;
		// Outside a table every one of these is left to the browser. In one, a
		// row or column that cannot move further still takes its key, rather
		// than handing it to the browser's selection.
		return {
			[keys.addRowBefore]: () => commands().addTableRowBefore(),
			[keys.addRowAfter]: () => commands().addTableRowAfter(),
			[keys.addColumnBefore]: () => commands().addTableColumnBefore(),
			[keys.addColumnAfter]: () => commands().addTableColumnAfter(),
			[keys.deleteRow]: () => commands().deleteTableRow(),
			[keys.deleteColumn]: () => commands().deleteTableColumn(),
			[keys.moveRowUp]: () => commands().moveTableRowUp() || inTable(),
			[keys.moveRowDown]: () => commands().moveTableRowDown() || inTable(),
			[keys.moveColumnLeft]: () =>
				commands().moveTableColumnLeft() || inTable(),
			[keys.moveColumnRight]: () =>
				commands().moveTableColumnRight() || inTable(),
		};
	},
});
