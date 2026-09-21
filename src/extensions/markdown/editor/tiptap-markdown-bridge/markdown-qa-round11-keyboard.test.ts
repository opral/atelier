// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";
import { parseMarkdown } from "../markdown";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { JoinAdjacentListsExtension } from "../extensions/join-adjacent-lists";
import { TableNavigationExtension } from "../extensions/table-navigation";

const editors: Editor[] = [];
function editorFor(markdown: string) {
	const editor = new Editor({
		// The extensions the mounted editor adds on top of MarkdownWc that
		// also claim these keys.
		extensions: [
			...(MarkdownWc() as any[]),
			JoinAdjacentListsExtension,
			TableNavigationExtension,
			History,
		],
		content: astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
	});
	editors.push(editor);
	return editor;
}
function key(editor: Editor, name: string, init: KeyboardEventInit = {}) {
	const event = new KeyboardEvent("keydown", {
		key: name,
		bubbles: true,
		cancelable: true,
		...init,
	});
	return editor.view.someProp("handleKeyDown", (handler) =>
		handler(editor.view, event),
	);
}
function type(editor: Editor, text: string) {
	for (const char of text) {
		const { from, to } = editor.state.selection;
		const handled = editor.view.someProp("handleTextInput", (handler) =>
			(handler as any)(editor.view, from, to, char, () => null),
		);
		if (!handled)
			editor.view.dispatch(editor.state.tr.insertText(char, from, to));
	}
}
/** Places the caret at `offset` inside the textblock whose text equals `matcher`. */
function caret(editor: Editor, matcher: string, offset: number | "end" = 0) {
	let target: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (target !== null || !node.isTextblock) return;
		if (node.textContent === matcher) {
			target = pos + 1 + (offset === "end" ? node.content.size : offset);
		}
	});
	if (target === null) throw new Error(`no textblock "${matcher}"`);
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, target),
		),
	);
}
const md = (editor: Editor) => buildMarkdownFromEditor(editor);
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

function select(
	editor: Editor,
	fromText: string,
	fromOffset: number,
	toText: string,
	toOffset: number,
) {
	let from = -1;
	let to = -1;
	editor.state.doc.descendants((node, pos) => {
		if (!node.isTextblock) return;
		if (from < 0 && node.textContent === fromText) from = pos + 1 + fromOffset;
		if (to < 0 && node.textContent === toText) to = pos + 1 + toOffset;
	});
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, from, to),
		),
	);
}

describe("Enter over a selection that spans list items", () => {
	test("replaces the selection instead of throwing", () => {
		const editor = editorFor("- ab\n- cd\n");
		select(editor, "ab", 0, "cd", 2);
		expect(() => key(editor, "Enter")).not.toThrow();
		expect(md(editor)).toBe("-\n-\n");
	});
	test("a partial selection across two items leaves two items", () => {
		const editor = editorFor("- ab\n- cd\n");
		select(editor, "ab", 1, "cd", 1);
		expect(key(editor, "Enter")).toBe(true);
		expect(md(editor)).toBe("- a\n- d\n");
	});
	test("a selection from inside one item to the end of the next", () => {
		const editor = editorFor("- ab\n- cd\n");
		select(editor, "ab", 1, "cd", 2);
		expect(key(editor, "Enter")).toBe(true);
		expect(md(editor)).toBe("- a\n-\n");
		type(editor, "x");
		expect(md(editor)).toBe("- a\n- x\n");
	});
	test("a caret in an item still opens the next item", () => {
		const editor = editorFor("- ab\n- cd\n");
		caret(editor, "ab", "end");
		expect(key(editor, "Enter")).toBe(true);
		expect(md(editor)).toBe("- ab\n-\n- cd\n");
	});
	test("a new task item starts unchecked", () => {
		const editor = editorFor("- [x] ab\n- [x] cd\n");
		select(editor, "ab", 1, "cd", 1);
		expect(key(editor, "Enter")).toBe(true);
		expect(md(editor)).toBe("- [x] a\n- [ ] d\n");
	});
});
