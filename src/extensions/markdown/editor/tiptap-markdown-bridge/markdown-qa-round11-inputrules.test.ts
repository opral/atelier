// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";
import { parseMarkdown } from "../markdown";
import { astToTiptapDoc } from "./mdwc-to-tiptap";

const editors: Editor[] = [];
function editorFor(markdown: string) {
	const editor = new Editor({
		extensions: [...(MarkdownWc() as any[]), History],
		content: astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
	});
	editors.push(editor);
	return editor;
}
function key(editor: Editor, key: string, init: KeyboardEventInit = {}) {
	const event = new KeyboardEvent("keydown", {
		key,
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
/** The text runs of the document with the marks on each, e.g. ["b", "bold"]. */
function runs(editor: Editor) {
	const result: Array<[string, string]> = [];
	editor.state.doc.descendants((node) => {
		if (!node.isText) return;
		const marks = node.marks
			.map((mark) =>
				mark.type.name === "link" ? `link:${mark.attrs.href}` : mark.type.name,
			)
			.join("+");
		result.push([node.text ?? "", marks]);
	});
	return result;
}
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("autolink", () => {
	test("trailing punctuation and an unbalanced paren stay outside the link", () => {
		const editor = editorFor("");
		type(editor, "see https://example.com. Then (https://a.b) ok");
		expect(runs(editor)).toEqual([
			["see ", ""],
			["https://example.com", "link:https://example.com"],
			[". Then (", ""],
			["https://a.b", "link:https://a.b"],
			[") ok", ""],
		]);
	});

	test("a comma, a quote and a balanced paren", () => {
		const editor = editorFor("");
		type(editor, 'a https://x.io/a_(b), "www.y.org" z');
		expect(runs(editor)).toEqual([
			["a ", ""],
			["https://x.io/a_(b)", "link:https://x.io/a_(b)"],
			[', "', ""],
			["www.y.org", "link:https://www.y.org"],
			['" z', ""],
		]);
	});

	test("a bare scheme is not a link", () => {
		const editor = editorFor("");
		type(editor, "https://. x");
		expect(runs(editor)).toEqual([["https://. x", ""]]);
	});
});
