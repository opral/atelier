// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { undo } from "@tiptap/pm/history";
import { afterEach, describe, expect, test } from "vitest";
import { buildMarkdownFromEditor } from "./build-markdown-from-editor";
import { createEditor } from "./create-editor";
import { tableShortcuts } from "./extensions/table-controls";
import { parseMarkdown } from "./markdown";
import { astToTiptapDoc } from "./tiptap-markdown-bridge/mdwc-to-tiptap";
import { tableTargetAt } from "./table-commands";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

async function settle() {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

/** Opens `markdown` through the real save path; `saved()` is the last write. */
async function open(markdown: string) {
	const writes: string[] = [];
	const lix = {
		execute: async (sql: string, params: any[]) => {
			if (/^UPDATE lix_file/.test(sql))
				writes.push(new TextDecoder().decode(params[0]));
			return { rowsAffected: 1, rows: [], commit: null };
		},
	} as any;
	const editor = createEditor({
		lix,
		initialMarkdown: markdown,
		fileId: "f",
		persistState: true,
		persistDebounceMs: 0,
		element: document.body.appendChild(document.createElement("div")),
	} as any);
	editors.push(editor);
	await settle();
	return {
		editor,
		saved: async () => {
			await settle();
			return writes.at(-1);
		},
	};
}

/** Puts the caret `offset` characters into the cell whose text is `text`. */
function caretIn(editor: Editor, text: string, offset = 0) {
	let found = -1;
	editor.state.doc.descendants((node, pos) => {
		if (found >= 0) return false;
		if (node.type.name === "tableCell" && node.textContent === text) {
			found = pos + 1 + offset;
			return false;
		}
		return true;
	});
	if (found < 0) throw new Error(`no cell ${text}`);
	editor.commands.setTextSelection(found);
}

/** The cell the caret is in, and where in its text. */
function caret(editor: Editor) {
	const { $from } = editor.state.selection;
	return {
		text: $from.parent.textContent,
		offset: $from.parentOffset,
		...tableTargetAt(editor.state),
	};
}

/** The grid as text, with `|` between cells: what a reader sees. */
function grid(editor: Editor): string[] {
	const rows: string[] = [];
	editor.state.doc.descendants((node) => {
		if (node.type.name !== "tableRow") return true;
		const cells: string[] = [];
		node.forEach((cell) => cells.push(cell.textContent));
		rows.push(cells.join("|"));
		return false;
	});
	return rows;
}

function tableNode(editor: Editor) {
	let table: any = null;
	editor.state.doc.descendants((node) => {
		if (table) return false;
		if (node.type.name === "table") table = node;
		return !table;
	});
	return table;
}

/** Header flags and cell alignment agree with the table's first row and align. */
function expectConsistent(editor: Editor) {
	const table = tableNode(editor);
	if (!table) return;
	const width = table.firstChild.childCount;
	expect(table.attrs.align).toHaveLength(width);
	table.forEach((row: any, _: number, rowIndex: number) =>
		row.forEach((cell: any, __: number, column: number) => {
			expect(cell.attrs.isHeader).toBe(rowIndex === 0);
			expect(cell.attrs.align).toBe(table.attrs.align[column] ?? null);
		}),
	);
	// Serialize → parse gives the same table.
	const markdown = buildMarkdownFromEditor(editor);
	const reparsed = astToTiptapDoc(parseMarkdown(markdown)) as any;
	const again = reparsed.content.find((node: any) => node.type === "table");
	const strip = (json: any): any =>
		json.content?.map((row: any) =>
			row.content.map((cell: any) => ({
				text: (cell.content ?? []).map((n: any) => n.text ?? "").join(""),
				isHeader: cell.attrs.isHeader,
				align: cell.attrs.align,
			})),
		);
	expect(strip(again)).toEqual(strip(table.toJSON()));
	expect(again.attrs.align).toEqual(table.attrs.align);
}

function undoOnce(editor: Editor) {
	return undo(editor.state, editor.view.dispatch);
}

const TABLE = "| a | b |\n|:--|---|\n| 1 | 2 |\n| 3 | 4 |\n";
const DOC = `# Title\n\nBefore  para.\n\n${TABLE}\nAfter *x*\n`;

describe("rows", () => {
	test("insert below: an empty row under the caret's, caret in its column", async () => {
		const { editor, saved } = await open(DOC);
		caretIn(editor, "2", 1);
		expect(editor.commands.addTableRowAfter()).toBe(true);
		expect(grid(editor)).toEqual(["a|b", "1|2", "|", "3|4"]);
		expect(caret(editor)).toMatchObject({ row: 2, column: 1, offset: 0 });
		expectConsistent(editor);
		// Only the table is rewritten, and it stays unaligned.
		expect(await saved()).toBe(
			"# Title\n\nBefore  para.\n\n| a | b |\n|:--|---|\n| 1 | 2 |\n|  |  |\n| 3 | 4 |\n\nAfter *x*\n",
		);
	});

	test("insert above the header: the new row is the header", async () => {
		const { editor, saved } = await open(TABLE);
		caretIn(editor, "b");
		editor.commands.addTableRowBefore();
		expect(grid(editor)).toEqual(["|", "a|b", "1|2", "3|4"]);
		expect(caret(editor)).toMatchObject({ row: 0, column: 1 });
		expectConsistent(editor);
		expect(await saved()).toBe(
			"|  |  |\n|:--|---|\n| a | b |\n| 1 | 2 |\n| 3 | 4 |\n",
		);
	});

	test("delete a body row: the caret goes to the row that took its place", async () => {
		const { editor, saved } = await open(TABLE);
		caretIn(editor, "1");
		editor.commands.deleteTableRow();
		expect(grid(editor)).toEqual(["a|b", "3|4"]);
		expect(caret(editor)).toMatchObject({ text: "3", offset: 1 });
		expectConsistent(editor);
		expect(await saved()).toBe("| a | b |\n|:--|---|\n| 3 | 4 |\n");
	});

	test("delete the last row: the caret goes up", async () => {
		const { editor } = await open(TABLE);
		caretIn(editor, "4");
		editor.commands.deleteTableRow();
		expect(caret(editor)).toMatchObject({ text: "2", row: 1, column: 1 });
	});

	test("delete the header: the next row is promoted", async () => {
		const { editor, saved } = await open(TABLE);
		caretIn(editor, "a");
		editor.commands.deleteTableRow();
		expect(grid(editor)).toEqual(["1|2", "3|4"]);
		expect(caret(editor)).toMatchObject({ text: "1", row: 0 });
		expectConsistent(editor);
		expect(await saved()).toBe("| 1 | 2 |\n|:--|---|\n| 3 | 4 |\n");
	});

	test("delete the only row: the table goes", async () => {
		const { editor, saved } = await open(
			"Before\n\n| a | b |\n|---|---|\n\nAfter\n",
		);
		caretIn(editor, "a");
		editor.commands.deleteTableRow();
		expect(tableNode(editor)).toBeNull();
		expect(editor.state.selection.$from.parent.textContent).toBe("Before");
		expect(await saved()).toBe("Before\n\nAfter\n");
	});

	test("delete the only row of the only block leaves an empty paragraph", async () => {
		const { editor } = await open("| a |\n|---|\n");
		caretIn(editor, "a");
		editor.commands.deleteTableRow();
		expect(editor.state.doc.childCount).toBe(1);
		expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
	});

	test("move a row down and up: the caret goes with its text", async () => {
		const { editor, saved } = await open(TABLE);
		caretIn(editor, "2", 1);
		editor.commands.moveTableRowDown();
		expect(grid(editor)).toEqual(["a|b", "3|4", "1|2"]);
		expect(caret(editor)).toMatchObject({ text: "2", offset: 1, row: 2 });
		expectConsistent(editor);
		// Moved rows keep their source.
		expect(await saved()).toBe("| a | b |\n|:--|---|\n| 3 | 4 |\n| 1 | 2 |\n");
		editor.commands.moveTableRowUp();
		expect(grid(editor)).toEqual(["a|b", "1|2", "3|4"]);
	});

	test("dragging a body row to a new position keeps the header and caret", async () => {
		const { editor } = await open(TABLE);
		caretIn(editor, "1", 1);
		editor.commands.moveTableRowTo(1, {
			tablePos: 0,
			row: 2,
			column: 0,
		});
		expect(grid(editor)).toEqual(["a|b", "3|4", "1|2"]);
		expect(caret(editor)).toMatchObject({ text: "1", offset: 1, row: 2 });
		expectConsistent(editor);
		expect(
			editor.commands.moveTableRowTo(0, { tablePos: 0, row: 1, column: 0 }),
		).toBe(false);
	});

	test("the header stays first", async () => {
		const { editor } = await open(TABLE);
		caretIn(editor, "a");
		expect(editor.commands.moveTableRowDown()).toBe(false);
		expect(editor.commands.moveTableRowUp()).toBe(false);
		caretIn(editor, "1");
		expect(editor.commands.moveTableRowUp()).toBe(false);
		caretIn(editor, "3");
		expect(editor.commands.moveTableRowDown()).toBe(false);
		expect(grid(editor)).toEqual(["a|b", "1|2", "3|4"]);
	});

	test("a new row takes its columns' alignment", async () => {
		const { editor } = await open(TABLE);
		caretIn(editor, "3");
		editor.commands.addTableRowAfter();
		const table = tableNode(editor);
		expect(table.lastChild.firstChild.attrs.align).toBe("left");
		expectConsistent(editor);
	});
});

describe("columns", () => {
	test("insert right: an empty, unaligned column, caret in it", async () => {
		const { editor, saved } = await open(TABLE);
		caretIn(editor, "1");
		editor.commands.addTableColumnAfter();
		expect(grid(editor)).toEqual(["a||b", "1||2", "3||4"]);
		expect(tableNode(editor).attrs.align).toEqual(["left", null, null]);
		expect(caret(editor)).toMatchObject({ row: 1, column: 1, offset: 0 });
		expectConsistent(editor);
		expect(await saved()).toBe(
			"| a |  | b |\n|:--|---|---|\n| 1 |  | 2 |\n| 3 |  | 4 |\n",
		);
	});

	test("insert left of the first column", async () => {
		const { editor } = await open(TABLE);
		caretIn(editor, "a");
		editor.commands.addTableColumnBefore();
		expect(grid(editor)).toEqual(["|a|b", "|1|2", "|3|4"]);
		expect(tableNode(editor).attrs.align).toEqual([null, "left", null]);
		expect(caret(editor)).toMatchObject({ row: 0, column: 0 });
		expectConsistent(editor);
	});

	test("delete a column: its alignment goes with it", async () => {
		const { editor, saved } = await open(TABLE);
		caretIn(editor, "1");
		editor.commands.deleteTableColumn();
		expect(grid(editor)).toEqual(["b", "2", "4"]);
		expect(tableNode(editor).attrs.align).toEqual([null]);
		expect(caret(editor)).toMatchObject({ text: "2", column: 0 });
		expectConsistent(editor);
		expect(await saved()).toBe("| b |\n|---|\n| 2 |\n| 4 |\n");
	});

	test("delete the last column: the caret goes left", async () => {
		const { editor } = await open(TABLE);
		caretIn(editor, "4");
		editor.commands.deleteTableColumn();
		expect(caret(editor)).toMatchObject({ text: "3", column: 0 });
	});

	test("delete the only column: the table goes", async () => {
		const { editor, saved } = await open("x\n\n| a |\n|---|\n| 1 |\n");
		caretIn(editor, "1");
		editor.commands.deleteTableColumn();
		expect(tableNode(editor)).toBeNull();
		expect(await saved()).toBe("x\n");
	});

	test("move a column: text, alignment and caret go together", async () => {
		const { editor, saved } = await open(TABLE);
		caretIn(editor, "a", 1);
		editor.commands.moveTableColumnRight();
		expect(grid(editor)).toEqual(["b|a", "2|1", "4|3"]);
		expect(tableNode(editor).attrs.align).toEqual([null, "left"]);
		expect(caret(editor)).toMatchObject({ text: "a", offset: 1, column: 1 });
		expectConsistent(editor);
		expect(await saved()).toBe("| b | a |\n|---|:--|\n| 2 | 1 |\n| 4 | 3 |\n");
		expect(editor.commands.moveTableColumnRight()).toBe(false);
		editor.commands.moveTableColumnLeft();
		expect(grid(editor)).toEqual(["a|b", "1|2", "3|4"]);
	});

	test("dragging a column to a new position keeps its alignment and the caret", async () => {
		const { editor } = await open(
			"| a | b | c |\n|:--|:-:|---|\n| 1 | 2 | 3 |\n",
		);
		caretIn(editor, "b", 1);
		editor.commands.moveTableColumnTo(2, {
			tablePos: 0,
			row: 0,
			column: 0,
		});
		expect(grid(editor)).toEqual(["b|c|a", "2|3|1"]);
		expect(tableNode(editor).attrs.align).toEqual(["center", null, "left"]);
		expect(caret(editor)).toMatchObject({ text: "b", offset: 1, column: 0 });
		expectConsistent(editor);
	});

	test("align a column, then clear it", async () => {
		const { editor, saved } = await open(TABLE);
		caretIn(editor, "2", 1);
		editor.commands.setTableColumnAlign("right");
		expect(tableNode(editor).attrs.align).toEqual(["left", "right"]);
		expect(caret(editor)).toMatchObject({ text: "2", offset: 1 });
		expectConsistent(editor);
		expect(await saved()).toBe("| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 | 4 |\n");
		editor.commands.setTableColumnAlign("center");
		expect(await saved()).toBe("| a | b |\n|:--|:-:|\n| 1 | 2 |\n| 3 | 4 |\n");
		editor.commands.setTableColumnAlign(null);
		expect(await saved()).toBe(TABLE);
	});

	test("a short row is filled out when its columns change", async () => {
		const { editor } = await open("| a | b | c |\n|---|---|---|\n| 1 |\n");
		caretIn(editor, "a");
		editor.commands.moveTableColumnRight();
		expect(grid(editor)).toEqual(["b|a|c", "|1|"]);
		expectConsistent(editor);
	});
});

describe("sort", () => {
	const PEOPLE =
		"| Name | Qty |\n|---|--:|\n| item 10 | 3 |\n| Item 2 | 20 |\n|  | 1 |\n| apple | 100 |\n";

	test("naturally, empty cells last, the header first", async () => {
		const { editor } = await open(PEOPLE);
		caretIn(editor, "Name");
		editor.commands.sortTableColumn("asc");
		expect(grid(editor)).toEqual([
			"Name|Qty",
			"apple|100",
			"Item 2|20",
			"item 10|3",
			"|1",
		]);
		expectConsistent(editor);
		editor.commands.sortTableColumn("desc");
		expect(grid(editor)).toEqual([
			"Name|Qty",
			"item 10|3",
			"Item 2|20",
			"apple|100",
			"|1",
		]);
	});

	test("numbers by value, and the caret stays in its row", async () => {
		const { editor, saved } = await open(PEOPLE);
		caretIn(editor, "20", 1);
		editor.commands.sortTableColumn("asc");
		expect(grid(editor).map((row) => row.split("|")[1])).toEqual([
			"Qty",
			"1",
			"3",
			"20",
			"100",
		]);
		expect(caret(editor)).toMatchObject({ text: "20", offset: 1, row: 3 });
		// Every row keeps its own source; only the order changes.
		expect(await saved()).toBe(
			"| Name | Qty |\n|---|--:|\n|  | 1 |\n| item 10 | 3 |\n| Item 2 | 20 |\n| apple | 100 |\n",
		);
	});

	test("an already sorted column changes nothing", async () => {
		const { editor } = await open(TABLE);
		caretIn(editor, "1");
		const before = editor.state.doc;
		expect(editor.commands.sortTableColumn("asc")).toBe(true);
		expect(editor.state.doc.eq(before)).toBe(true);
	});
});

describe("targets and undo", () => {
	test("drag reorder of a body row is a single undo step", async () => {
		const { editor } = await open(TABLE);
		const before = editor.state.doc;
		expect(
			editor.commands.moveTableRowTo(2, {
				tablePos: 0,
				row: 1,
				column: 0,
			}),
		).toBe(true);
		expect(grid(editor)).toEqual(["a|b", "3|4", "1|2"]);
		expect(undoOnce(editor)).toBe(true);
		expect(editor.state.doc.eq(before)).toBe(true);
	});

	test("drag reorder of a column is a single undo step", async () => {
		const { editor } = await open(TABLE);
		const before = editor.state.doc;
		expect(
			editor.commands.moveTableColumnTo(1, {
				tablePos: 0,
				row: 0,
				column: 0,
			}),
		).toBe(true);
		expect(grid(editor)).toEqual(["b|a", "2|1", "4|3"]);
		expect(undoOnce(editor)).toBe(true);
		expect(editor.state.doc.eq(before)).toBe(true);
	});

	test("Mod-z undoes a dragged column reorder", async () => {
		const { editor } = await open(TABLE);
		const before = editor.state.doc;
		expect(
			editor.commands.moveTableColumnTo(1, {
				tablePos: 0,
				row: 0,
				column: 0,
			}),
		).toBe(true);
		const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
		const event = new KeyboardEvent("keydown", {
			key: "z",
			metaKey: mac,
			ctrlKey: !mac,
			bubbles: true,
			cancelable: true,
		});

		editor.view.dom.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		expect(editor.state.doc.eq(before)).toBe(true);
	});

	test("a command can act on a cell the caret is not in", async () => {
		const { editor } = await open(`Before\n\n${TABLE}`);
		editor.commands.setTextSelection(2);
		const target = tableTargetAt(editor.state, findCell(editor, "3"))!;
		editor.commands.deleteTableRow(target);
		expect(grid(editor)).toEqual(["a|b", "1|2"]);
		// The caret goes to the table.
		expect(caret(editor)).toMatchObject({ text: "1", row: 1 });
	});

	test("outside a table every command declines", async () => {
		const { editor } = await open(`Before\n\n${TABLE}`);
		editor.commands.setTextSelection(2);
		for (const run of [
			() => editor.commands.addTableRowAfter(),
			() => editor.commands.deleteTableRow(),
			() => editor.commands.addTableColumnAfter(),
			() => editor.commands.deleteTableColumn(),
			() => editor.commands.moveTableRowDown(),
			() => editor.commands.moveTableColumnRight(),
			() => editor.commands.setTableColumnAlign("left"),
			() => editor.commands.sortTableColumn("asc"),
		])
			expect(run()).toBe(false);
	});

	test.each([
		["addTableRowAfter", "2"],
		["addTableRowBefore", "a"],
		["deleteTableRow", "a"],
		["moveTableRowDown", "1"],
		["addTableColumnAfter", "1"],
		["addTableColumnBefore", "1"],
		["deleteTableColumn", "b"],
		["moveTableColumnLeft", "b"],
	] as const)(
		"%s is one undo step, typing after it the next",
		async (name, cell) => {
			const { editor } = await open(DOC);
			caretIn(editor, cell);
			// Something typed just before, in the same group of the history.
			editor.commands.insertContent("Q");
			const typed = editor.state.doc;
			(editor.commands as any)[name]();
			const edited = editor.state.doc;
			expect(edited.eq(typed)).toBe(false);
			editor.commands.insertContent("Z");
			expect(undoOnce(editor)).toBe(true);
			expect(editor.state.doc.eq(edited)).toBe(true);
			expect(undoOnce(editor)).toBe(true);
			expect(editor.state.doc.eq(typed)).toBe(true);
		},
	);

	test("undo of a deleted table brings it back whole", async () => {
		const { editor, saved } = await open(`Before\n\n${TABLE}`);
		caretIn(editor, "a");
		editor.commands.deleteTableColumn();
		editor.commands.deleteTableColumn();
		expect(tableNode(editor)).toBeNull();
		undoOnce(editor);
		expect(grid(editor)).toEqual(["b", "2", "4"]);
		undoOnce(editor);
		expect(await saved()).toBe(`Before\n\n${TABLE}`);
	});
});

describe("keyboard", () => {
	function key(editor: Editor, name: string) {
		const event = new KeyboardEvent("keydown", {
			key: name,
			bubbles: true,
			cancelable: true,
		});
		let handled = false;
		editor.view.someProp("handleKeyDown", (handler: any) => {
			handled = handler(editor.view, event) || handled;
			return handled;
		});
		return handled;
	}

	// Notion's behaviour, which the user asked for: keys from below a table
	// come into it and never select or delete it.
	test("Backspace on an empty line below a table: the line goes, the caret ends the last cell", async () => {
		const { editor, saved } = await open(`${TABLE}\n## Next\n`);
		const end = tableNode(editor).nodeSize;
		editor
			.chain()
			.insertContentAt(end, { type: "paragraph" })
			.setTextSelection(end + 1)
			.run();
		expect(key(editor, "Backspace")).toBe(true);
		expect(caret(editor)).toMatchObject({ text: "4", offset: 1, row: 2 });
		expect(editor.state.doc.childCount).toBe(2);
		// The next one is the browser's: it deletes the "4" before the caret.
		expect(key(editor, "Backspace")).toBe(false);
		expect(tableNode(editor)).not.toBeNull();
		expect(await saved()).toBe(`${TABLE}\n## Next\n`);
	});

	test("Delete at the end of the last cell takes a blank line below, and nothing else", async () => {
		const { editor } = await open(`${TABLE}\n## Next\n`);
		const end = tableNode(editor).nodeSize;
		editor.commands.insertContentAt(end, { type: "paragraph" });
		caretIn(editor, "4", 1);
		expect(key(editor, "Delete")).toBe(true);
		expect(editor.state.doc.childCount).toBe(2);
		expect(caret(editor)).toMatchObject({ text: "4", offset: 1 });
		expect(key(editor, "Delete")).toBe(true);
		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.lastChild!.textContent).toBe("Next");
		expect(grid(editor)).toEqual(["a|b", "1|2", "3|4"]);
	});

	function press(editor: Editor, binding: string) {
		const parts = binding.split("-");
		const name = parts.pop()!;
		const mods = new Set(parts);
		const mac = /Mac/.test(navigator.platform);
		const event = new KeyboardEvent("keydown", {
			key: name,
			bubbles: true,
			cancelable: true,
			shiftKey: mods.has("Shift"),
			altKey: mods.has("Alt"),
			ctrlKey: mods.has("Ctrl") || (!mac && mods.has("Mod")),
			metaKey: mac && mods.has("Mod"),
		});
		let handled = false;
		editor.view.someProp("handleKeyDown", (handler: any) => {
			handled = handler(editor.view, event) || handled;
			return handled;
		});
		return handled;
	}

	test("the table keys edit rows and columns", async () => {
		const keys = tableShortcuts(false);
		const { editor } = await open(TABLE);
		caretIn(editor, "1");
		expect(press(editor, keys.addRowAfter)).toBe(true);
		expect(grid(editor)).toEqual(["a|b", "1|2", "|", "3|4"]);
		expect(press(editor, keys.deleteRow)).toBe(true);
		expect(grid(editor)).toEqual(["a|b", "1|2", "3|4"]);
		caretIn(editor, "1");
		expect(press(editor, keys.moveRowDown)).toBe(true);
		expect(grid(editor)).toEqual(["a|b", "3|4", "1|2"]);
		expect(press(editor, keys.moveColumnRight)).toBe(true);
		expect(grid(editor)).toEqual(["b|a", "4|3", "2|1"]);
		expect(press(editor, keys.addColumnBefore)).toBe(true);
		expect(grid(editor)).toEqual(["b||a", "4||3", "2||1"]);
		expect(press(editor, keys.deleteColumn)).toBe(true);
		expect(grid(editor)).toEqual(["b|a", "4|3", "2|1"]);
		expect(press(editor, keys.addRowBefore)).toBe(true);
		expect(press(editor, keys.addColumnAfter)).toBe(true);
		expect(press(editor, keys.moveColumnLeft)).toBe(true);
		expect(press(editor, keys.moveRowUp)).toBe(true);
	});

	test("outside a table the keys are left alone", async () => {
		const keys = tableShortcuts(false);
		const { editor } = await open(`Before\n\n${TABLE}`);
		editor.commands.setTextSelection(2);
		for (const binding of Object.values(keys))
			expect(press(editor, binding)).toBe(false);
	});

	test("no two table keys are the same, on either platform", () => {
		for (const mac of [true, false]) {
			const values = Object.values(tableShortcuts(mac));
			expect(new Set(values).size).toBe(values.length);
		}
		// ⌘⌥←/→ switch tabs in Chrome on macOS; ⌥⇧←/→ select by word there.
		const mac = Object.values(tableShortcuts(true));
		expect(mac).not.toContain("Mod-Alt-ArrowLeft");
		expect(mac).not.toContain("Alt-Shift-ArrowLeft");
	});
});

function findCell(editor: Editor, text: string): number {
	let found = -1;
	editor.state.doc.descendants((node, pos) => {
		if (found >= 0) return false;
		if (node.type.name === "tableCell" && node.textContent === text)
			found = pos + 1;
		return found < 0;
	});
	return found;
}
