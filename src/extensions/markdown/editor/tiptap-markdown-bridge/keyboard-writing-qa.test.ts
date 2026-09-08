// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";
const editors: Editor[] = [];
const p = (text = "") => ({
	type: "paragraph",
	content: text ? [{ type: "text", text }] : [],
});
const li = (...content: any[]) => ({ type: "listItem", content });
const ul = (...content: any[]) => ({ type: "bulletList", content });
const quote = (...content: any[]) => ({ type: "blockquote", content });
function create(...content: any[]) {
	const editor = new Editor({
		extensions: MarkdownWc(),
		content: { type: "doc", content },
	});
	editors.push(editor);
	return editor;
}
function key(editor: Editor, pressedKey: string, shiftKey = false) {
	return editor.view.someProp("handleKeyDown", (handler) =>
		handler(
			editor.view,
			new KeyboardEvent("keydown", {
				key: pressedKey,
				shiftKey,
				bubbles: true,
				cancelable: true,
			}),
		),
	);
}
function cursor(editor: Editor, text: string, end = true) {
	let target = -1;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === text)
			target = pos + (end ? text.length : 0);
	});
	expect(target).toBeGreaterThan(-1);
	editor.commands.setTextSelection(target);
}
function lastEmpty(editor: Editor) {
	let target = -1;
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "paragraph" && !node.content.size) target = pos + 1;
	});
	expect(target).toBeGreaterThan(-1);
	editor.commands.setTextSelection(target);
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

test("Enter exits an empty quoted list before exiting its blockquote", () => {
	const editor = create(quote(ul(li(p("first")), li(p()))));
	lastEmpty(editor);
	expect(key(editor, "Enter")).toBe(true);
	expect(editor.state.doc.childCount).toBe(1);
	expect(editor.state.doc.firstChild?.type.name).toBe("blockquote");
	expect(editor.state.doc.firstChild?.lastChild?.type.name).toBe("paragraph");
	expect(buildMarkdownFromEditor(editor)).toContain("> - first");
	expect(key(editor, "Enter")).toBe(true);
	expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
});

test("Backspace on an empty quoted list item preserves the quote", () => {
	const editor = create(quote(ul(li(p("first")), li(p()))));
	lastEmpty(editor);
	expect(key(editor, "Backspace")).toBe(true);
	expect(buildMarkdownFromEditor(editor)).toBe("> - first\n");
});

test("Shift-Enter in a code block inserts a newline", () => {
	const editor = create({
		type: "codeBlock",
		content: [{ type: "text", text: "code" }],
	});
	cursor(editor, "code");
	expect(key(editor, "Enter", true)).toBe(true);
	expect(editor.state.doc.firstChild?.textContent).toBe("code\n");
});

test("Enter in a list continuation paragraph splits the paragraph", () => {
	const editor = create(ul(li(p("first"), p("continuation"))));
	cursor(editor, "continuation");
	expect(key(editor, "Enter")).toBe(true);
	editor.state.doc.check();
	expect(editor.state.doc.textContent).toBe("firstcontinuation");
	expect(editor.state.selection.$from.parent.content.size).toBe(0);
});

test("Shift-Enter replaces a code selection without leaving the code block", () => {
	const editor = create({
		type: "codeBlock",
		content: [{ type: "text", text: "before selected after" }],
	});
	editor.commands.setTextSelection({ from: 8, to: 16 });
	expect(key(editor, "Enter", true)).toBe(true);
	expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock");
	expect(editor.state.doc.textContent).toBe("before \n after");
	editor.state.doc.check();
});

test("Shift-Enter does not apply the code-block exit shortcut", () => {
	const editor = create({
		type: "codeBlock",
		content: [{ type: "text", text: "code\n\n" }],
	});
	cursor(editor, "code\n\n");
	expect(key(editor, "Enter", true)).toBe(true);
	expect(editor.state.doc.childCount).toBe(1);
	expect(editor.state.doc.textContent).toBe("code\n\n\n");
});

test("Backspace on an empty nested quoted list item leaves the parent intact", () => {
	const editor = create(
		quote(ul(li(p("parent"), ul(li(p("child")), li(p()))))),
	);
	lastEmpty(editor);
	expect(key(editor, "Backspace")).toBe(true);
	expect(buildMarkdownFromEditor(editor)).toBe("> - parent\n>   - child\n");
	editor.state.doc.check();
});

test("Enter exits a blockquote inside a list before exiting the list", () => {
	const editor = create(ul(li(p("parent"), quote(p()))));
	lastEmpty(editor);
	expect(key(editor, "Enter")).toBe(true);
	expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(2);
	expect(editor.state.doc.firstChild?.firstChild?.lastChild?.type.name).toBe(
		"paragraph",
	);
	expect(editor.state.selection.$from.depth).toBe(3);
	editor.state.doc.check();
});

test("Delete across a selected list range preserves the unselected text", () => {
	const editor = create(ul(li(p("before")), li(p("after"))));
	cursor(editor, "before");
	const from = editor.state.selection.from;
	cursor(editor, "after", false);
	const to = editor.state.selection.from;
	editor.commands.setTextSelection({ from, to });
	expect(key(editor, "Delete")).toBe(true);
	expect(editor.state.doc.textContent).toBe("beforeafter");
	editor.state.doc.check();
});

test("Tab and Shift-Tab preserve a hard break and selection in a child item", () => {
	const editor = create(
		ul(
			li(p("parent")),
			li({ type: "paragraph", content: [{ type: "hardBreak" }] }),
		),
	);
	let pos = -1;
	editor.state.doc.descendants((node, index) => {
		if (node.type.name === "hardBreak") pos = index;
	});
	editor.commands.setTextSelection(pos + 1);
	expect(key(editor, "Tab")).toBe(true);
	expect(editor.state.selection.$from.parent.child(0).type.name).toBe(
		"hardBreak",
	);
	expect(key(editor, "Tab", true)).toBe(true);
	expect(editor.state.doc.firstChild?.childCount).toBe(2);
	expect(editor.state.selection.$from.parentOffset).toBe(1);
	editor.state.doc.check();
});
