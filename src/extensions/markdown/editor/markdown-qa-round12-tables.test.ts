// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { undo } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { createEditor } from "./create-editor";

/**
 * QA round 12: the table commands and the save path of an edited table.
 * The bar is that a table edit never touches anything outside the edited
 * rows in the saved file, and that the caret never lands on something one
 * keystroke can destroy.
 */

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

function press(editor: Editor, key: string) {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
	});
	let handled = false;
	editor.view.someProp(
		"handleKeyDown",
		(handler: any) => (handled = handler(editor.view, event) || handled),
	);
	return handled;
}

function type(editor: Editor, text: string) {
	editor.view.dispatch(editor.state.tr.insertText(text));
}

describe("the caret after a table is deleted", () => {
	test("goes into text, not onto the rule above", async () => {
		const { editor, saved } = await open("x\n\n---\n\n| a |\n|---|\n\ny\n");
		caretIn(editor, "a");
		editor.commands.deleteTableRow();
		expect(editor.state.selection).toBeInstanceOf(TextSelection);
		expect(editor.state.selection.$from.parent.textContent).toBe("x");
		type(editor, "Q");
		expect(await saved()).toBe("xQ\n\n---\n\ny\n");
	});

	test("skips a code block above for the text below", async () => {
		const { editor, saved } = await open(
			"```\ncode\n```\n\n| a |\n|---|\n\ny\n",
		);
		caretIn(editor, "a");
		editor.commands.deleteTableColumn();
		const { $from } = editor.state.selection;
		expect($from.parent.type.name).toBe("paragraph");
		expect($from.parent.textContent).toBe("y");
		expect($from.parentOffset).toBe(0);
		expect(await saved()).toBe("```\ncode\n```\n\ny\n");
	});

	test("with only a rule and an image around, an empty line takes it", async () => {
		const { editor, saved } = await open(
			"---\n\n| a |\n|---|\n\n![i](x.png)\n",
		);
		caretIn(editor, "a");
		editor.commands.deleteTableRow();
		const { selection } = editor.state;
		expect(selection).toBeInstanceOf(TextSelection);
		expect(selection.$from.parent.type.name).toBe("paragraph");
		expect(selection.$from.parent.childCount).toBe(0);
		// The empty line is not written until it is typed into.
		expect(await saved()).toBe("---\n\n![i](x.png)\n");
		type(editor, "Q");
		expect(await saved()).toBe("---\n\nQ\n\n![i](x.png)\n");
		// The typing, then the delete with its empty line, are one undo each.
		undo(editor.state, editor.view.dispatch);
		undo(editor.state, editor.view.dispatch);
		expect(editor.state.doc.child(1).type.name).toBe("table");
		expect(editor.state.doc.childCount).toBe(3);
	});

	test("Backspace in an emptied table under a rule keeps the rule", async () => {
		const { editor, saved } = await open("x\n\n---\n\n|  |\n|---|\n");
		editor.state.doc.descendants((node, pos) => {
			if (node.type.name === "tableCell")
				editor.commands.setTextSelection(pos + 1);
			return true;
		});
		expect(press(editor, "Backspace")).toBe(true);
		expect(editor.state.selection).toBeInstanceOf(TextSelection);
		expect(editor.state.selection.$from.parent.textContent).toBe("x");
		type(editor, "Q");
		expect(await saved()).toBe("xQ\n\n---\n");
	});
});

describe("deleting the table a quote or item was", () => {
	test("takes the quote with it", async () => {
		const { editor, saved } = await open("> | a |\n> |---|\n\nafter\n");
		caretIn(editor, "a");
		editor.commands.deleteTableRow();
		expect(await saved()).toBe("after\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("after");
	});

	test("takes the list item with it, and the list when it was the only one", async () => {
		const { editor, saved } = await open("- | a |\n  |---|\n- next\n\nafter\n");
		caretIn(editor, "a");
		editor.commands.deleteTableColumn();
		expect(await saved()).toBe("- next\n\nafter\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("next");

		const only = await open("before\n\n- | a |\n  |---|\n");
		caretIn(only.editor, "a");
		only.editor.commands.deleteTableRow();
		expect(await only.saved()).toBe("before\n");
	});

	test("keeps a quote that says more", async () => {
		const { editor, saved } = await open("> x\n>\n> | a |\n> |---|\n");
		caretIn(editor, "a");
		editor.commands.deleteTableRow();
		expect(await saved()).toBe("> x\n");
	});
});

/** The body cells of column `c` of the first table. */
function column(editor: Editor, c: number) {
	const cells: string[] = [];
	editor.state.doc.descendants((node) => {
		if (node.type.name !== "tableRow") return true;
		cells.push(node.child(c).textContent);
		return false;
	});
	return cells.slice(1);
}

describe("sort", () => {
	test("decimals, negatives and thousands by value", async () => {
		const { editor } = await open(
			"| n |\n|---|\n| 1.5 |\n| -10 |\n| 1.25 |\n| -5 |\n| 1,000 |\n| 200 |\n| 0.9 |\n",
		);
		caretIn(editor, "n");
		editor.commands.sortTableColumn("asc");
		expect(column(editor, 0)).toEqual([
			"-10",
			"-5",
			"0.9",
			"1.25",
			"1.5",
			"200",
			"1,000",
		]);
		editor.commands.sortTableColumn("desc");
		expect(column(editor, 0)).toEqual([
			"1,000",
			"200",
			"1.5",
			"1.25",
			"0.9",
			"-5",
			"-10",
		]);
	});

	test("currency and percentages by value, numbers before text, empty last", async () => {
		const { editor } = await open(
			"| p |\n|---|\n| $1,000 |\n| n/a |\n| $30 |\n|  |\n| -$5 |\n| $200.50 |\n| 12 % |\n| 3€ |\n",
		);
		caretIn(editor, "p");
		editor.commands.sortTableColumn("asc");
		expect(column(editor, 0)).toEqual([
			"-$5",
			"3€",
			"12 %",
			"$30",
			"$200.50",
			"$1,000",
			"n/a",
			"",
		]);
		editor.commands.sortTableColumn("desc");
		expect(column(editor, 0)).toEqual([
			"n/a",
			"$1,000",
			"$200.50",
			"$30",
			"12 %",
			"3€",
			"-$5",
			"",
		]);
	});

	test("a cell holding only an image sorts by its alt text", async () => {
		const { editor } = await open(
			"| k | v |\n|---|---|\n| ![banana](b.png) | 1 |\n| apple | 2 |\n|  | 3 |\n| mango | 4 |\n",
		);
		caretIn(editor, "k");
		editor.commands.sortTableColumn("asc");
		expect(column(editor, 1)).toEqual(["2", "1", "4", "3"]);
	});
});

/** Puts the caret at the end of the first textblock whose text is `text`. */
function caretAtEndOf(editor: Editor, text: string) {
	let found = -1;
	editor.state.doc.descendants((node, pos) => {
		if (found >= 0) return false;
		if (node.isTextblock && node.textContent === text)
			found = pos + 1 + node.content.size;
		return found < 0;
	});
	if (found < 0) throw new Error(`no block ${text}`);
	editor.commands.setTextSelection(found);
}

describe("Delete above an item that starts with a table", () => {
	test("enters the table and changes nothing", async () => {
		const source = "- item\n- | a | b |\n  |---|---|\n  | 1 | 2 |\n- next\n";
		const { editor, saved } = await open(source);
		caretAtEndOf(editor, "item");
		expect(press(editor, "Delete")).toBe(true);
		expect(editor.state.selection.$from.parent.type.name).toBe("tableCell");
		expect(editor.state.selection.$from.parent.textContent).toBe("a");
		expect(await saved()).toBeUndefined();
	});

	test("from a paragraph above the list, writes no <span>", async () => {
		const { editor, saved } = await open(
			"para\n\n- | a | b |\n  |---|---|\n  | 1 | 2 |\n",
		);
		caretAtEndOf(editor, "para");
		expect(press(editor, "Delete")).toBe(true);
		expect(editor.state.selection.$from.parent.textContent).toBe("a");
		expect((await saved()) ?? "").not.toContain("<span>");
	});

	test("an item starting with a heading gives its text to the line, not its item", async () => {
		const { editor, saved } = await open("- item\n- # h\n- next\n");
		caretAtEndOf(editor, "item");
		press(editor, "Delete");
		expect(await saved()).toBe("- itemh\n- next\n");
	});
});

describe("the saved file keeps what the edit did not touch", () => {
	const RAGGED = "| a | b | c |\n|---|---|---|\n| 1 |\n| 5 | 6 | 7 | extra |\n";

	test("a row with cells past the header keeps them, once, where it goes", async () => {
		const { editor, saved } = await open(RAGGED);
		caretIn(editor, "5");
		editor.commands.moveTableRowUp();
		expect(await saved()).toBe(
			"| a | b | c |\n|---|---|---|\n| 5 | 6 | 7 | extra |\n| 1 |\n",
		);
		undo(editor.state, editor.view.dispatch);
		expect(await saved()).toBe(RAGGED);
	});

	test("an edited row keeps its extra cells and the spelling of the others", async () => {
		const { editor, saved } = await open(
			"| a | b | c |\n|---|---|---|\n| &#124; | 6 | 7 | extra |\n",
		);
		caretIn(editor, "6", 1);
		type(editor, "!");
		expect(await saved()).toBe(
			"| a | b | c |\n|---|---|---|\n| &#124; | 6! | 7 | extra |\n",
		);
	});

	test("adding or deleting a column, and undoing it, gives the file back", async () => {
		const { editor, saved } = await open(RAGGED);
		caretIn(editor, "5");
		editor.commands.addTableColumnAfter();
		expect(await saved()).toBe(
			"| a |  | b | c |\n|---|---|---|---|\n| 1 |\n| 5 |  | 6 | 7 | extra |\n",
		);
		undo(editor.state, editor.view.dispatch);
		expect(await saved()).toBe(RAGGED);
		caretIn(editor, "6");
		editor.commands.deleteTableColumn();
		expect(await saved()).toBe(
			"| a | c |\n|---|---|\n| 1 |\n| 5 | 7 | extra |\n",
		);
		undo(editor.state, editor.view.dispatch);
		expect(await saved()).toBe(RAGGED);
	});

	test("a moved column keeps its cells' spelling", async () => {
		const { editor, saved } = await open(
			"| a | b |\n|:--|---|\n| &#124; | `x\\|y` |\n",
		);
		caretIn(editor, "b");
		editor.commands.moveTableColumnLeft();
		expect(await saved()).toBe("| b | a |\n|---|:--|\n| `x\\|y` | &#124; |\n");
	});

	test("a table in a list: only the new row is written", async () => {
		const source =
			"- _em_ and __b__ and [ref][r]\n- x\n\n  | a | b |\n  |:--|---|\n  | 1 | 2 |\n- y\n\n[r]: https://example.com\n";
		const { editor, saved } = await open(source);
		caretIn(editor, "1");
		editor.commands.addTableRowAfter();
		expect(await saved()).toBe(
			source.replace("  | 1 | 2 |\n", "  | 1 | 2 |\n  |  |  |\n"),
		);
		editor.commands.setTableColumnAlign("center");
		expect(await saved()).toBe(
			source.replace(
				"  |:--|---|\n  | 1 | 2 |\n",
				"  |:-:|---|\n  | 1 | 2 |\n  |  |  |\n",
			),
		);
		undo(editor.state, editor.view.dispatch);
		undo(editor.state, editor.view.dispatch);
		expect(await saved()).toBe(source);
	});

	test("a table in a quote: only the new row is written", async () => {
		const source = "> | a | b |\n> |---|---|\n> | 1 | 2 |\n\nafter\n";
		const { editor, saved } = await open(source);
		caretIn(editor, "a");
		editor.commands.addTableRowAfter();
		expect(await saved()).toBe(
			"> | a | b |\n> |---|---|\n> |  |  |\n> | 1 | 2 |\n\nafter\n",
		);
	});

	test("a table without outer pipes keeps its style", async () => {
		const source = "a | b\n--|--\n1 | 2\n3 | 4\n";
		const { editor, saved } = await open(source);
		caretIn(editor, "1");
		editor.commands.deleteTableRow();
		expect(await saved()).toBe("a | b\n--|--\n3 | 4\n");
		undo(editor.state, editor.view.dispatch);
		expect(await saved()).toBe(source);
		editor.commands.setTableColumnAlign("center");
		expect(await saved()).toBe("a | b\n:-:|--\n1 | 2\n3 | 4\n");
		undo(editor.state, editor.view.dispatch);
		caretIn(editor, "3");
		editor.commands.addTableColumnAfter();
		// A row with an empty cell at an end needs its outer pipes.
		expect(await saved()).toBe("a |  | b\n--|--|--\n1 |  | 2\n3 |  | 4\n");
		caretIn(editor, "3");
		editor.commands.addTableRowAfter();
		expect(await saved()).toBe(
			"a |  | b\n--|--|--\n1 |  | 2\n3 |  | 4\n|  |  |  |\n",
		);
	});

	test("an indented table keeps its rows' indentation", async () => {
		const { editor, saved } = await open(
			"x\n\n   | a | b |\n   |---|---|\n   | 1 | 2 |\n\ny\n",
		);
		caretIn(editor, "1");
		editor.commands.addTableRowAfter();
		expect(await saved()).toBe(
			"x\n\n   | a | b |\n   |---|---|\n   | 1 | 2 |\n   |  |  |\n\ny\n",
		);
	});

	test("a file mixing line endings keeps each untouched line's", async () => {
		const { editor, saved } = await open("x\r\n\r\ny\n\n| a |\n|---|\n| 1 |\n");
		caretIn(editor, "1");
		editor.commands.addTableRowAfter();
		expect(await saved()).toBe("x\r\n\r\ny\n\n| a |\n|---|\n| 1 |\n|  |\n");
	});
});

/** The grid as text, with `|` between cells. */
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

/** Selects from inside the cell `from` to inside the cell `to`. */
function selectCells(editor: Editor, from: string, to: string) {
	const positions = new Map<string, number>();
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "tableCell") positions.set(node.textContent, pos);
		return true;
	});
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(
				editor.state.doc,
				positions.get(from)! + 1,
				positions.get(to)! + 2,
			),
		),
	);
}

/** The texts of the cells the selection's two ends are in. */
function selectedCells(editor: Editor) {
	const { $anchor, $head } = editor.state.selection;
	return [$anchor.parent.textContent, $head.parent.textContent];
}

describe("a selection across rows or columns", () => {
	const TABLE =
		"| h1 | h2 | h3 |\n|:--|---|--:|\n| a1 | a2 | a3 |\n| b1 | b2 | b3 |\n| c1 | c2 | c3 |\n";

	test("deletes every row it spans, in one undo step", async () => {
		const { editor, saved } = await open(TABLE);
		selectCells(editor, "a2", "b1");
		expect(editor.commands.deleteTableRow()).toBe(true);
		expect(grid(editor)).toEqual(["h1|h2|h3", "c1|c2|c3"]);
		expect(editor.state.selection.empty).toBe(true);
		expect(await saved()).toBe(
			"| h1 | h2 | h3 |\n|:--|---|--:|\n| c1 | c2 | c3 |\n",
		);
		undo(editor.state, editor.view.dispatch);
		expect(await saved()).toBe(TABLE);
	});

	test("moves the rows it spans together, and stays on them", async () => {
		const { editor } = await open(TABLE);
		selectCells(editor, "b1", "c2");
		expect(editor.commands.moveTableRowUp()).toBe(true);
		expect(grid(editor).slice(1)).toEqual(["b1|b2|b3", "c1|c2|c3", "a1|a2|a3"]);
		expect(selectedCells(editor)).toEqual(["b1", "c2"]);
		// The first body row cannot go above the header.
		expect(editor.commands.moveTableRowUp()).toBe(false);
		expect(editor.commands.moveTableRowDown()).toBe(true);
		expect(grid(editor).slice(1)).toEqual(["a1|a2|a3", "b1|b2|b3", "c1|c2|c3"]);
		// The last rows cannot go further down.
		expect(editor.commands.moveTableRowDown()).toBe(false);
	});

	test("deletes and moves every column it spans, alignment included", async () => {
		const { editor, saved } = await open(TABLE);
		selectCells(editor, "a1", "b2");
		expect(editor.commands.moveTableColumnRight()).toBe(true);
		expect(grid(editor)[1]).toBe("a3|a1|a2");
		expect(selectedCells(editor)).toEqual(["a1", "b2"]);
		expect(await saved()).toBe(
			"| h3 | h1 | h2 |\n|--:|:--|---|\n| a3 | a1 | a2 |\n| b3 | b1 | b2 |\n| c3 | c1 | c2 |\n",
		);
		expect(editor.commands.moveTableColumnRight()).toBe(false);
		expect(editor.commands.deleteTableColumn()).toBe(true);
		expect(grid(editor)).toEqual(["h3", "a3", "b3", "c3"]);
		expect(await saved()).toBe("| h3 |\n|--:|\n| a3 |\n| b3 |\n| c3 |\n");
	});

	test("aligns every column it spans", async () => {
		const { editor, saved } = await open(TABLE);
		selectCells(editor, "a2", "a3");
		editor.commands.setTableColumnAlign("center");
		expect(await saved()).toBe(TABLE.replace("|:--|---|--:|", "|:--|:-:|:-:|"));
	});

	test("a menu opened on a cell outside the selection acts on that cell", async () => {
		const { editor } = await open(TABLE);
		selectCells(editor, "a1", "b1");
		// The row of c1; the table is the document's first block.
		editor.commands.deleteTableRow({ tablePos: 0, row: 3, column: 0 });
		expect(grid(editor).slice(1)).toEqual(["a1|a2|a3", "b1|b2|b3"]);
	});
});
