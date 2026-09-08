// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "../tiptap-markdown-bridge";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";
import { astToTiptapDoc } from "../tiptap-markdown-bridge/mdwc-to-tiptap";
import { parseMarkdown } from "../markdown";
import { TableNavigationExtension } from "./table-navigation";

const editors: Editor[] = [];

function createTableEditor(content: any): Editor {
	const editor = new Editor({
		extensions: [...MarkdownWc(), TableNavigationExtension],
		content,
	});
	editors.push(editor);
	return editor;
}

function tableDoc(
	rows: string[][],
	before = false,
	after = false,
	align: Array<"left" | "center" | "right" | null> = [],
) {
	return {
		type: "doc",
		content: [
			...(before
				? [{ type: "paragraph", content: [{ type: "text", text: "before" }] }]
				: []),
			{
				type: "table",
				attrs: { align },
				content: rows.map((row) => ({
					type: "tableRow",
					content: row.map((text) => ({
						type: "tableCell",
						content: text ? [{ type: "text", text }] : [],
					})),
				})),
			},
			...(after
				? [{ type: "paragraph", content: [{ type: "text", text: "after" }] }]
				: []),
		],
	};
}

function setCursorAfterText(editor: Editor, text: string) {
	let position = -1;
	editor.state.doc.descendants((node, pos) => {
		if (position >= 0 || !node.isText) return position < 0;
		if (node.text === text) position = pos + text.length;
		return position < 0;
	});
	if (position < 0) throw new Error(`Missing text: ${text}`);
	editor.commands.setTextSelection(position);
}

function sendKey(editor: Editor, key: string, shiftKey = false) {
	const event = new KeyboardEvent("keydown", {
		key,
		shiftKey,
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

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("table keyboard navigation", () => {
	test("Tab and Shift-Tab traverse cells", () => {
		const editor = createTableEditor(
			tableDoc([
				["a", "b"],
				["c", "d"],
			]),
		);
		setCursorAfterText(editor, "a");

		expect(sendKey(editor, "Tab")).toBe(true);
		expect(editor.state.selection.$from.parent.textContent).toBe("b");
		expect(sendKey(editor, "Tab")).toBe(true);
		expect(editor.state.selection.$from.parent.textContent).toBe("c");
		expect(sendKey(editor, "Tab", true)).toBe(true);
		expect(editor.state.selection.$from.parent.textContent).toBe("b");
	});

	test("Tab in the final cell adds a row with the same number of cells", () => {
		const editor = createTableEditor(
			tableDoc([["a", "b"]], false, false, ["left", "right"]),
		);
		setCursorAfterText(editor, "b");
		sendKey(editor, "Tab");

		const table = editor.state.doc.child(0);
		expect(table.childCount).toBe(2);
		expect(table.child(1).childCount).toBe(2);
		expect(table.child(1).child(0).attrs.align).toBe("left");
		expect(table.child(1).child(1).attrs.align).toBe("right");
		expect(table.child(1).child(0).attrs.isHeader).toBe(false);
		expect(editor.state.selection.$from.parent.type.name).toBe("tableCell");
		expect(editor.state.selection.$from.parent.textContent).toBe("");
	});

	test("ArrowDown exits the last table row into an existing paragraph", () => {
		const editor = createTableEditor(tableDoc([["a"]], false, true));
		setCursorAfterText(editor, "a");
		sendKey(editor, "ArrowDown");

		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.textContent).toBe("after");
	});

	test("ArrowDown inside a final cell leaves normal caret movement alone", () => {
		const editor = createTableEditor(tableDoc([["alpha"]], false, true));
		editor.commands.setTextSelection(5);

		expect(sendKey(editor, "ArrowDown")).toBe(false);
		expect(editor.state.selection.$from.parent.type.name).toBe("tableCell");
	});

	test("ArrowDown after a terminal table creates one trailing paragraph", () => {
		const editor = createTableEditor(tableDoc([["a"]]));
		setCursorAfterText(editor, "a");
		sendKey(editor, "ArrowDown");

		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
	});

	test("Mod-Enter reuses the paragraph already after the table", () => {
		const editor = createTableEditor(tableDoc([["a"]], false, true));
		setCursorAfterText(editor, "a");
		for (const modifier of ["metaKey", "ctrlKey"] as const) {
			const event = new KeyboardEvent("keydown", {
				key: "Enter",
				[modifier]: true,
				bubbles: true,
				cancelable: true,
			});
			let handled = false;
			editor.view.someProp("handleKeyDown", (handler: any) => {
				handled = handler(editor.view, event) || handled;
			});
			if (handled) break;
		}

		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.selection.$from.parent.textContent).toBe("after");
	});
});

test("ArrowLeft with selected table text does not insert a paragraph", () => {
	const editor = createTableEditor(tableDoc([["alpha"]]));
	setCursorAfterText(editor, "alpha");
	const end = editor.state.selection.from;
	editor.commands.setTextSelection({ from: end - 5, to: end });
	const before = editor.state.doc.toJSON();
	expect(sendKey(editor, "ArrowLeft")).toBe(false);
	expect(editor.state.doc.toJSON()).toEqual(before);
});

test("ArrowDown with a backward selection does not exit the table", () => {
	const editor = createTableEditor(tableDoc([["alpha", "beta"]]));
	setCursorAfterText(editor, "alpha");
	const first = editor.state.selection.from;
	setCursorAfterText(editor, "beta");
	editor.commands.setTextSelection({
		from: editor.state.selection.from,
		to: first,
	});
	const before = editor.state.doc.toJSON();
	expect(sendKey(editor, "ArrowDown")).toBe(false);
	expect(editor.state.doc.toJSON()).toEqual(before);
});

test("Enter in a table cell does not change the table's column count", () => {
	const editor = createTableEditor(
		tableDoc([
			["alpha", "beta"],
			["gamma", "delta"],
		]),
	);
	setCursorAfterText(editor, "alpha");
	editor.commands.setTextSelection(editor.state.selection.from - 2);
	sendKey(editor, "Enter");
	expect(editor.state.doc.firstChild!.child(0).childCount).toBe(2);
	expect(editor.state.doc.firstChild!.textContent).toBe("alphabetagammadelta");
});

test.each([false, true])(
	"table Enter replaces selected cell text with a reloadable line break (shift=%s)",
	(shift) => {
		const editor = createTableEditor(
			tableDoc([
				["alpha", "beta"],
				["gamma", "delta"],
			]),
		);
		setCursorAfterText(editor, "alpha");
		const end = editor.state.selection.from;
		editor.commands.setTextSelection({ from: end - 3, to: end - 1 });
		expect(sendKey(editor, "Enter", shift)).toBe(true);
		const first = editor.state.doc.firstChild!.firstChild!;
		expect(first.childCount).toBe(2);
		expect(first.firstChild!.textContent).toBe("ala");
		expect(first.firstChild!.child(1).type.name).toBe("hardBreak");
		const markdown = buildMarkdownFromEditor(editor);
		const reloaded = createTableEditor(astToTiptapDoc(parseMarkdown(markdown)));
		expect(
			reloaded.state.doc.firstChild!.firstChild!.firstChild!.toString(),
		).toBe(first.firstChild!.toString());
	},
);

test.each([false, true])(
	"table Enter does not merge a cross-cell selection (shift=%s)",
	(shift) => {
		const editor = createTableEditor(tableDoc([["alpha", "beta"]]));
		setCursorAfterText(editor, "alpha");
		const from = editor.state.selection.from - 2;
		setCursorAfterText(editor, "beta");
		editor.commands.setTextSelection({
			from,
			to: editor.state.selection.from - 2,
		});
		const before = editor.state.doc.toJSON();
		expect(sendKey(editor, "Enter", shift)).toBe(true);
		expect(editor.state.doc.toJSON()).toEqual(before);
	},
);

test.each([false, true])(
	"table Enter retains active bold formatting (shift=%s)",
	(shift) => {
		const editor = createTableEditor(tableDoc([["bold"]]));
		setCursorAfterText(editor, "bold");
		const end = editor.state.selection.from;
		editor.commands.setTextSelection({ from: end - 4, to: end });
		editor.commands.toggleMark("bold");
		editor.commands.setTextSelection(end);
		expect(sendKey(editor, "Enter", shift)).toBe(true);
		editor.commands.insertContent("continued");
		const cell = editor.state.doc.firstChild!.firstChild!.firstChild!;
		expect(cell.lastChild!.marks.map((mark) => mark.type.name)).toContain(
			"bold",
		);
		expect(cell.child(1).type.name).toBe("hardBreak");
	},
);
