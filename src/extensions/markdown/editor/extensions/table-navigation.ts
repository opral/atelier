import { Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

/**
 * Keyboard behavior for the editor's lightweight GFM table schema.
 */
export const TableNavigationExtension = Extension.create({
	name: "tableNavigation",
	priority: 1100,

	addKeyboardShortcuts() {
		const tableContext = (editor: any) => {
			const { $from } = editor.state.selection;
			let tableDepth = -1;
			let rowDepth = -1;
			let cellDepth = -1;
			for (let depth = $from.depth; depth > 0; depth--) {
				const name = $from.node(depth).type.name;
				if (cellDepth < 0 && name === "tableCell") cellDepth = depth;
				if (rowDepth < 0 && name === "tableRow") rowDepth = depth;
				if (name === "table") {
					tableDepth = depth;
					break;
				}
			}
			if (tableDepth < 0 || rowDepth < 0 || cellDepth < 0) return null;
			return {
				$from,
				tableDepth,
				rowDepth,
				cellDepth,
				table: $from.node(tableDepth),
				row: $from.node(rowDepth),
				rowIndex: $from.index(tableDepth),
				cellIndex: $from.index(rowDepth),
				tablePos: $from.before(tableDepth),
				cellPos: $from.before(cellDepth),
			};
		};

		const selectNear = (editor: any, pos: number, bias: -1 | 1) => {
			const { state, view } = editor;
			view.dispatch(
				state.tr
					.setSelection(TextSelection.near(state.doc.resolve(pos), bias))
					.scrollIntoView(),
			);
			return true;
		};

		const exitTable = (editor: any, direction: -1 | 1) => {
			const context = tableContext(editor);
			if (!context) return false;
			const { state, view } = editor;
			const target =
				direction < 0
					? context.tablePos
					: context.tablePos + context.table.nodeSize;
			const adjacent =
				direction < 0
					? state.doc.resolve(target).nodeBefore
					: state.doc.nodeAt(target);
			if (adjacent) return selectNear(editor, target, direction);

			const paragraph = state.schema.nodes.paragraph;
			if (!paragraph) return false;
			const tr = state.tr.insert(target, paragraph.create());
			tr.setSelection(TextSelection.create(tr.doc, target + 1));
			view.dispatch(tr.scrollIntoView());
			return true;
		};

		const moveCell = (editor: any, direction: -1 | 1) => {
			const context = tableContext(editor);
			if (!context) return false;

			let rowIndex = context.rowIndex;
			let cellIndex = context.cellIndex + direction;
			if (cellIndex < 0) {
				rowIndex -= 1;
				if (rowIndex < 0) return exitTable(editor, -1);
				cellIndex = context.table.child(rowIndex).childCount - 1;
			} else if (cellIndex >= context.row.childCount) {
				rowIndex += 1;
				cellIndex = 0;
			}

			if (rowIndex >= context.table.childCount) {
				const cellType = editor.state.schema.nodes.tableCell;
				const rowType = editor.state.schema.nodes.tableRow;
				if (!cellType || !rowType) return false;
				const align = Array.isArray(context.table.attrs?.align)
					? context.table.attrs.align
					: [];
				const cells = Array.from(
					{ length: context.row.childCount },
					(_, columnIndex) =>
						cellType.create({
							isHeader: false,
							align: align[columnIndex] ?? null,
						}),
				);
				const insertPos = context.tablePos + context.table.nodeSize - 1;
				const tr = editor.state.tr.insert(
					insertPos,
					rowType.create(null, cells),
				);
				tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
				editor.view.dispatch(tr.scrollIntoView());
				return true;
			}

			let rowPos = context.tablePos + 1;
			for (let index = 0; index < rowIndex; index++) {
				rowPos += context.table.child(index).nodeSize;
			}
			const row = context.table.child(rowIndex);
			let cellPos = rowPos + 1;
			for (let index = 0; index < cellIndex; index++) {
				cellPos += row.child(index).nodeSize;
			}
			return selectNear(editor, cellPos + 1, 1);
		};

		return {
			Tab: ({ editor }) => moveCell(editor, 1),
			"Shift-Tab": ({ editor }) => moveCell(editor, -1),
			"Mod-Enter": ({ editor }) => exitTable(editor, 1),
			ArrowUp: ({ editor }) => {
				const context = tableContext(editor);
				return context?.rowIndex === 0 && context.$from.parentOffset === 0
					? exitTable(editor, -1)
					: false;
			},
			ArrowDown: ({ editor }) => {
				const context = tableContext(editor);
				if (!context) return false;
				return context.rowIndex === context.table.childCount - 1 &&
					context.$from.parentOffset === context.$from.parent.content.size
					? exitTable(editor, 1)
					: false;
			},
			ArrowLeft: ({ editor }) => {
				const context = tableContext(editor);
				if (!context || context.rowIndex !== 0 || context.cellIndex !== 0) {
					return false;
				}
				return context.$from.parentOffset === 0 ? exitTable(editor, -1) : false;
			},
			ArrowRight: ({ editor }) => {
				const context = tableContext(editor);
				if (
					!context ||
					context.rowIndex !== context.table.childCount - 1 ||
					context.cellIndex !== context.row.childCount - 1
				) {
					return false;
				}
				return context.$from.parentOffset === context.$from.parent.content.size
					? exitTable(editor, 1)
					: false;
			},
		};
	},
});
