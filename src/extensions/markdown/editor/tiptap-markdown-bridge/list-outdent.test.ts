// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";

const editors: Editor[] = [];
const p = (text = "") => ({
	type: "paragraph",
	...(text ? { content: [{ type: "text", text }] } : {}),
});
const item = (...content: any[]) => ({ type: "listItem", content });
const list = (...content: any[]) => ({ type: "bulletList", content });
function editorFor(...content: any[]) {
	const editor = new Editor({
		extensions: MarkdownWc(),
		content: { type: "doc", content },
	});
	editors.push(editor);
	return editor;
}
function position(editor: Editor, text: string) {
	let result = -1;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === text) result = pos;
	});
	expect(result).toBeGreaterThan(-1);
	return result;
}
function outdent(editor: Editor) {
	const event = new KeyboardEvent("keydown", {
		key: "Tab",
		shiftKey: true,
		bubbles: true,
		cancelable: true,
	});
	let handled = false;
	editor.view.someProp(
		"handleKeyDown",
		(handler) => (handled = handler(editor.view, event) || handled),
	);
	return handled;
}
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

test("Shift-Tab outdents every selected item and preserves the selection", () => {
	const editor = editorFor(
		list(
			item(
				p("parent"),
				list(item(p("first")), item(p("second")), item(p("third"))),
			),
		),
	);
	editor.commands.setTextSelection({
		from: position(editor, "first"),
		to: position(editor, "second") + 6,
	});
	expect(outdent(editor)).toBe(true);
	const root = editor.state.doc.child(0);
	expect(root.childCount).toBe(3);
	expect(root.child(0).textContent).toBe("parent");
	expect(root.child(1).textContent).toBe("first");
	expect(root.child(2).textContent).toBe("secondthird");
	expect(
		editor.state.doc.textBetween(
			editor.state.selection.from,
			editor.state.selection.to,
			"|",
		),
	).toBe("first|second");
});

test("Shift-Tab preserves document order when the parent has content after the nested list", () => {
	const editor = editorFor(
		list(item(p("parent"), list(item(p("child"))), p("continuation"))),
	);
	editor.commands.setTextSelection(position(editor, "child") + 5);
	expect(outdent(editor)).toBe(true);
	expect(editor.state.doc.textContent).toBe("parentchildcontinuation");
	expect(editor.state.selection.$from.parent.textContent).toBe("child");
});

test("Shift-Tab unwraps a list item inside a blockquote", () => {
	const editor = editorFor({
		type: "blockquote",
		content: [list(item(p("quoted")))],
	});
	editor.commands.setTextSelection(position(editor, "quoted") + 6);
	expect(outdent(editor)).toBe(true);
	expect(editor.state.doc.child(0).child(0).type.name).toBe("paragraph");
	expect(editor.state.doc.textContent).toBe("quoted");
});

test("Shift-Tab preserves backward selections and numbering when lifting multiple ordered items", () => {
	const editor = editorFor({
		type: "orderedList",
		attrs: { start: 4 },
		content: [
			item(p("one")),
			item(p("two")),
			item(p("three")),
			item(p("four")),
		],
	});
	editor.commands.setTextSelection({
		from: position(editor, "three") + 5,
		to: position(editor, "two"),
	});
	expect(outdent(editor)).toBe(true);
	expect(editor.state.doc.childCount).toBe(4);
	expect(editor.state.doc.child(0).attrs.start).toBe(4);
	expect(editor.state.doc.child(3).attrs.start).toBe(7);
	expect(editor.state.selection.anchor).toBeGreaterThan(
		editor.state.selection.head,
	);
	expect(
		editor.state.doc.textBetween(
			editor.state.selection.from,
			editor.state.selection.to,
			"|",
		),
	).toBe("two|three");
});

test("Shift-Tab preserves task state across a selected range", () => {
	const first = { ...item(p("first")), attrs: { checked: true } };
	const second = { ...item(p("second")), attrs: { checked: false } };
	const editor = editorFor(list(item(p("parent"), list(first, second))));
	editor.commands.setTextSelection({
		from: position(editor, "first"),
		to: position(editor, "second") + 6,
	});
	expect(outdent(editor)).toBe(true);
	expect(editor.state.doc.child(0).child(1).attrs.checked).toBe(true);
	expect(editor.state.doc.child(0).child(2).attrs.checked).toBe(false);
});

test.each([0, 1, 2])(
	"Shift-Tab preserves remaining ordered numbering around item %i",
	(index) => {
		const labels = ["one", "two", "three"];
		const editor = editorFor({
			type: "orderedList",
			attrs: { start: 4 },
			content: labels.map((text) => item(p(text))),
		});
		editor.commands.setTextSelection(position(editor, labels[index]));
		expect(outdent(editor)).toBe(true);
		const lists: { start: number; text: string }[] = [];
		editor.state.doc.forEach((node) => {
			if (node.type.name === "orderedList")
				lists.push({ start: node.attrs.start, text: node.textContent });
		});
		expect(lists).toEqual([
			...(index ? [{ start: 4, text: labels.slice(0, index).join("") }] : []),
			...(index < 2
				? [{ start: 5 + index, text: labels.slice(index + 1).join("") }]
				: []),
		]);
	},
);

test("Backspace at a hard-break-only item preserves the hard break", () => {
	const editor = editorFor(
		list(
			item(p("previous")),
			item({ type: "paragraph", content: [{ type: "hardBreak" }] }),
		),
	);
	let cursor = -1;
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "hardBreak") cursor = pos;
	});
	editor.commands.setTextSelection(cursor);
	const event = new KeyboardEvent("keydown", {
		key: "Backspace",
		bubbles: true,
		cancelable: true,
	});
	expect(
		editor.view.someProp("handleKeyDown", (handler) =>
			handler(editor.view, event),
		),
	).toBe(true);
	let breaks = 0;
	editor.state.doc.descendants((node) => {
		if (node.type.name === "hardBreak") breaks++;
	});
	expect(breaks).toBe(1);
	expect(editor.state.doc.textContent).toBe("previous");
	editor.state.doc.check();
});
