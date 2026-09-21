import { Extension } from "@tiptap/core";
import { Plugin, Selection, TextSelection } from "@tiptap/pm/state";
import { deleteSelectedTableText } from "./table-selection";

/**
 * Keyboard behavior for the editor's lightweight GFM table schema.
 */
export const TableNavigationExtension = Extension.create({
	name: "tableNavigation",
	priority: 1100,

	addProseMirrorPlugins() {
		return [
			new Plugin({
				props: {
					handleDOMEvents: {
						beforeinput(view, event) {
							if (!view.editable) return false;
							const input = event as InputEvent;
							if (
								!input.cancelable ||
								input.isComposing ||
								input.inputType !== "insertText" ||
								input.data == null
							)
								return false;
							if (!deleteSelectedTableText(view.state)) return false;
							input.preventDefault();
							return deleteSelectedTableText(view.state, (tr) => {
								view.dispatch(tr.insertText(input.data!).scrollIntoView());
							});
						},
						compositionstart(view) {
							if (!view.editable) return false;
							// Native IME replacement bypasses handleTextInput. Clear
							// only selected cell contents before the browser composes.
							deleteSelectedTableText(view.state, (tr) => view.dispatch(tr));
							return false;
						},
					},
					handleTextInput(view, from, to, text) {
						if (
							from !== view.state.selection.from ||
							to !== view.state.selection.to
						)
							return false;
						return deleteSelectedTableText(view.state, (tr) => {
							view.dispatch(tr.insertText(text).scrollIntoView());
						});
					},
				},
			}),
		];
	},

	addKeyboardShortcuts() {
		const tableContext = (
			editor: any,
			$from: any = editor.state.selection.$from,
		) => {
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

		const onTextblockEdge = (editor: any, direction: "up" | "down") => {
			try {
				return editor.view.endOfTextblock(direction);
			} catch {
				return false;
			}
		};

		// Same column in another row (the last cell when that row is shorter).
		const selectCell = (
			editor: any,
			context: NonNullable<ReturnType<typeof tableContext>>,
			rowIndex: number,
			bias: -1 | 1,
		) => {
			const row = context.table.child(rowIndex);
			const cellIndex = Math.min(context.cellIndex, row.childCount - 1);
			let pos = context.tablePos + 1;
			for (let index = 0; index < rowIndex; index += 1)
				pos += context.table.child(index).nodeSize;
			pos += 1;
			for (let index = 0; index < cellIndex; index += 1)
				pos += row.child(index).nodeSize;
			const cell = row.child(cellIndex);
			return selectNear(
				editor,
				bias < 0 ? pos + cell.nodeSize - 1 : pos + 1,
				bias,
			);
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

		const insertCellBreak = (editor: any) => {
			if (!tableContext(editor)) return false;
			const { $from, $to } = editor.state.selection;
			// Replace only inline contents, including when the range crosses cells.
			// Generic block replacement can otherwise merge rows or add columns.
			const { state, view } = editor;
			const marks = state.storedMarks ?? $from.marks();
			const insertBreak = (tr: typeof state.tr) => {
				tr.replaceSelectionWith(state.schema.nodes.hardBreak.create());
				tr.ensureMarks(marks);
				view.dispatch(tr.scrollIntoView());
			};
			if (!$from.sameParent($to)) {
				deleteSelectedTableText(state, insertBreak);
				return true;
			}
			insertBreak(state.tr);
			return true;
		};

		const deleteTableText = (editor: any, direction: -1 | 1) => {
			if (
				deleteSelectedTableText(editor.state, (tr) => editor.view.dispatch(tr))
			)
				return true;
			const context = tableContext(editor);
			if (!context || !editor.state.selection.empty) return false;
			if (
				direction < 0 &&
				context.rowIndex === 0 &&
				context.cellIndex === 0 &&
				context.$from.parentOffset === 0
			) {
				return deleteEmptyTable(editor, context) || true;
			}
			return direction < 0
				? context.$from.parentOffset === 0
				: context.$from.parentOffset === context.$from.parent.content.size;
		};

		// A table whose cells are all empty goes with Backspace in its first
		// cell, the way an empty line does; otherwise clearing every cell
		// left a table no key could remove.
		const deleteEmptyTable = (
			editor: any,
			context: NonNullable<ReturnType<typeof tableContext>>,
		) => {
			let empty = true;
			context.table.descendants((node: any) => {
				if (node.type.name === "tableCell" && node.content.size > 0)
					empty = false;
				return empty;
			});
			if (!empty) return false;
			const { state, view } = editor;
			const from = context.tablePos;
			const to = from + context.table.nodeSize;
			const parent = context.$from.node(context.tableDepth - 1);
			const tr =
				parent.childCount === 1
					? state.tr.replaceWith(
							from,
							to,
							state.schema.nodes.paragraph.create(),
						)
					: state.tr.delete(from, to);
			tr.setSelection(Selection.near(tr.doc.resolve(from), -1));
			view.dispatch(tr.scrollIntoView());
			return true;
		};

		// The caret's horizontal position, or null where nothing is laid out.
		const caretLeft = (editor: any): number | null => {
			try {
				const { left } = editor.view.coordsAtPos(editor.state.selection.head);
				return Number.isFinite(left) ? left : null;
			} catch {
				return null;
			}
		};

		const boxOf = (editor: any, pos: number): DOMRect | null => {
			const dom = editor.view.nodeDOM(pos);
			if (!(dom instanceof Element)) return null;
			const rect = dom.getBoundingClientRect();
			return rect.width > 0 || rect.height > 0 ? rect : null;
		};

		// The box the text sits in: a cell's padding is not a place in its text.
		const contentBoxOf = (editor: any, pos: number): DOMRect | null => {
			const box = boxOf(editor, pos);
			const dom = editor.view.nodeDOM(pos);
			if (!box || !(dom instanceof Element)) return box;
			const style = getComputedStyle(dom);
			const left = box.left + (Number.parseFloat(style.paddingLeft) || 0);
			const right = box.right - (Number.parseFloat(style.paddingRight) || 0);
			const top = box.top + (Number.parseFloat(style.paddingTop) || 0);
			const bottom = box.bottom - (Number.parseFloat(style.paddingBottom) || 0);
			return right > left && bottom > top
				? new DOMRect(left, top, right - left, bottom - top)
				: box;
		};

		// The position at `left` on the first (`edge` top) or last line of the
		// textblock at `pos`, the way the browser moves between lines.
		const positionOnLine = (
			editor: any,
			pos: number,
			left: number | null,
			edge: "top" | "bottom",
		): number | null => {
			const block = editor.state.doc.nodeAt(pos);
			const box = contentBoxOf(editor, pos);
			if (left === null || !block?.isTextblock || !box) return null;
			const inset = Math.min(4, box.height / 2);
			let found: { pos: number } | null = null;
			try {
				found = editor.view.posAtCoords({
					left: Math.min(Math.max(left, box.left + 1), box.right - 1),
					top: edge === "top" ? box.top + inset : box.bottom - inset,
				});
			} catch {
				return null;
			}
			if (!found || found.pos <= pos || found.pos >= pos + block.nodeSize)
				return null;
			return found.pos;
		};

		// The cell of `row` under `left`: the first or last when `left` is past
		// the table's edge, and the column the caret came from in the fallback
		// where nothing is laid out.
		const cellUnder = (
			editor: any,
			rowPos: number,
			row: any,
			left: number | null,
			fallback: number,
		) => {
			let cellPos = rowPos + 1;
			const cells: { pos: number; node: any; box: DOMRect | null }[] = [];
			row.forEach((cell: any) => {
				cells.push({ pos: cellPos, node: cell, box: boxOf(editor, cellPos) });
				cellPos += cell.nodeSize;
			});
			if (left !== null && cells.every((cell) => cell.box)) {
				const index = cells.findIndex((cell) => left < cell.box!.right);
				return cells[index < 0 ? cells.length - 1 : index]!;
			}
			return cells[Math.min(Math.max(fallback, 0), cells.length - 1)]!;
		};

		// ArrowDown on the last line above a table, or ArrowUp on the first
		// line below one, enters it in the column under the caret, as it does
		// between rows; the browser took the first cell from above and the
		// last from below whatever the caret's column. With Shift the
		// selection's head goes there, a row at a time.
		const enterTable = (editor: any, direction: -1 | 1, extend: boolean) => {
			const { state, view } = editor;
			const { selection } = state;
			if (!(selection instanceof TextSelection)) return false;
			const $head = selection.$head;
			if (!$head.parent.isTextblock || $head.depth < 1) return false;
			const onEdgeLine =
				(direction > 0
					? $head.parentOffset === $head.parent.content.size
					: $head.parentOffset === 0) ||
				onTextblockEdge(editor, direction > 0 ? "down" : "up");
			if (!onEdgeLine) return false;
			const container = $head.node($head.depth - 1);
			const index = $head.index($head.depth - 1);
			const table = container.maybeChild(index + direction);
			if (table?.type.name !== "table" || table.childCount === 0) return false;
			const tablePos =
				direction > 0 ? $head.after() : $head.before() - table.nodeSize;
			const rowIndex = direction > 0 ? 0 : table.childCount - 1;
			let rowPos = tablePos + 1;
			for (let row = 0; row < rowIndex; row += 1)
				rowPos += table.child(row).nodeSize;
			const row = table.child(rowIndex);
			const left = caretLeft(editor);
			const cell = cellUnder(
				editor,
				rowPos,
				row,
				left,
				direction > 0 ? 0 : row.childCount - 1,
			);
			const head =
				positionOnLine(
					editor,
					cell.pos,
					left,
					direction > 0 ? "top" : "bottom",
				) ?? (direction > 0 ? cell.pos + 1 : cell.pos + cell.node.nodeSize - 1);
			view.dispatch(
				state.tr
					.setSelection(
						extend
							? TextSelection.create(state.doc, selection.anchor, head)
							: TextSelection.create(state.doc, head),
					)
					.scrollIntoView(),
			);
			return true;
		};

		// Leaving the table by its first or last row lands in the column the
		// caret was in, on the nearest line of the block beyond.
		const leaveTableVertically = (
			editor: any,
			context: NonNullable<ReturnType<typeof tableContext>>,
			direction: -1 | 1,
			extend: boolean,
		) => {
			const { state, view } = editor;
			const target =
				direction < 0
					? context.tablePos
					: context.tablePos + context.table.nodeSize;
			const $target = state.doc.resolve(target);
			const beyond = direction < 0 ? $target.nodeBefore : $target.nodeAfter;
			const beyondPos =
				direction < 0 ? target - (beyond?.nodeSize ?? 0) : target;
			const head =
				beyond?.isTextblock && !beyond.type.spec.code
					? positionOnLine(
							editor,
							beyondPos,
							caretLeft(editor),
							direction < 0 ? "bottom" : "top",
						)
					: null;
			if (head === null) {
				if (extend) return false;
				return exitTable(editor, direction);
			}
			const { anchor } = state.selection;
			view.dispatch(
				state.tr
					.setSelection(
						extend
							? TextSelection.create(state.doc, anchor, head)
							: TextSelection.create(state.doc, head),
					)
					.scrollIntoView(),
			);
			return true;
		};

		// A row up or down from inside a table, the selection's head in the same
		// column; with Shift the selection grows by a row at a time instead of
		// the browser's one cell.
		const moveVertically = (
			editor: any,
			direction: -1 | 1,
			extend: boolean,
		) => {
			const { selection } = editor.state;
			if (!extend && !selection.empty) return false;
			if (!(selection instanceof TextSelection)) return false;
			// The head's table: with Shift the anchor may be outside it.
			const context = tableContext(editor, selection.$head);
			if (!context) return enterTable(editor, direction, extend);
			const $head = selection.$head;
			const onEdgeLine =
				(direction > 0
					? $head.parentOffset === $head.parent.content.size
					: $head.parentOffset === 0) ||
				onTextblockEdge(editor, direction > 0 ? "down" : "up");
			if (!onEdgeLine) return false;
			const rowIndex = context.rowIndex + direction;
			if (rowIndex < 0 || rowIndex >= context.table.childCount)
				return leaveTableVertically(editor, context, direction, extend);
			if (!extend) return selectCell(editor, context, rowIndex, direction);
			let rowPos = context.tablePos + 1;
			for (let row = 0; row < rowIndex; row += 1)
				rowPos += context.table.child(row).nodeSize;
			const row = context.table.child(rowIndex);
			const left = caretLeft(editor);
			const cell = cellUnder(editor, rowPos, row, left, context.cellIndex);
			const head =
				positionOnLine(
					editor,
					cell.pos,
					left,
					direction > 0 ? "top" : "bottom",
				) ?? (direction > 0 ? cell.pos + cell.node.nodeSize - 1 : cell.pos + 1);
			editor.view.dispatch(
				editor.state.tr
					.setSelection(
						TextSelection.create(editor.state.doc, selection.anchor, head),
					)
					.scrollIntoView(),
			);
			return true;
		};

		return {
			Backspace: ({ editor }) => deleteTableText(editor, -1),
			Delete: ({ editor }) => deleteTableText(editor, 1),
			"Mod-Backspace": ({ editor }) => deleteTableText(editor, -1),
			"Cmd-Backspace": ({ editor }) => deleteTableText(editor, -1),
			"Ctrl-Backspace": ({ editor }) => deleteTableText(editor, -1),
			"Mod-Delete": ({ editor }) => deleteTableText(editor, 1),
			Enter: ({ editor }) => insertCellBreak(editor),
			"Shift-Enter": ({ editor }) => insertCellBreak(editor),
			Tab: ({ editor }) => moveCell(editor, 1),
			"Shift-Tab": ({ editor }) => moveCell(editor, -1),
			"Mod-Enter": ({ editor }) => exitTable(editor, 1),
			// Up and down move by row within the same column, like a grid; the
			// browser's default walks cells in DOM order, which reads as a jump
			// sideways. On a cell's first/last visual line only, so a multi-line
			// cell still moves within itself first.
			ArrowUp: ({ editor }) => moveVertically(editor, -1, false),
			ArrowDown: ({ editor }) => moveVertically(editor, 1, false),
			"Shift-ArrowUp": ({ editor }) => moveVertically(editor, -1, true),
			"Shift-ArrowDown": ({ editor }) => moveVertically(editor, 1, true),
			ArrowLeft: ({ editor }) => {
				if (!editor.state.selection.empty) return false;
				const context = tableContext(editor);
				if (!context || context.rowIndex !== 0 || context.cellIndex !== 0) {
					return false;
				}
				return context.$from.parentOffset === 0 ? exitTable(editor, -1) : false;
			},
			ArrowRight: ({ editor }) => {
				if (!editor.state.selection.empty) return false;
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
