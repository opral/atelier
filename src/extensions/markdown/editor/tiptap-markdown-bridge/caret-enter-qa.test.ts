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
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});
/** The caret's block, its text and its offset in it. */
function at(editor: Editor) {
	const $caret = editor.state.selection.$from;
	return {
		block: $caret.parent.type.name,
		text: $caret.parent.textContent,
		offset: $caret.parentOffset,
	};
}

describe("Enter at the start of a line keeps the caret with its text", () => {
	const cases: [string, string, string][] = [
		["a paragraph", "one\n\ntwo\n", "two"],
		["the first block", "two\n\nthree\n", "two"],
		...[1, 2, 3, 4, 5, 6].map((level): [string, string, string] => [
			`a level ${level} heading`,
			`para\n\n${"#".repeat(level)} Head\n`,
			"Head",
		]),
		["a heading first in the document", "## Head\n\npara\n", "Head"],
		["a bullet item", "- a\n- b\n", "b"],
		["the first bullet item", "- a\n- b\n", "a"],
		["an ordered item", "1. a\n2. b\n", "b"],
		["a checked task", "- [x] a\n- [ ] b\n", "a"],
		["a nested item", "- a\n  - b\n  - c\n", "c"],
		["the first line of a quote", "> one\n>\n> two\n>\n> three\n", "one"],
		["a middle line of a quote", "> one\n>\n> two\n>\n> three\n", "two"],
		["the last line of a quote", "> one\n>\n> two\n>\n> three\n", "three"],
		["a heading in a quote", "> body\n>\n> ## Head\n", "Head"],
		["a heading leading an item", "- a\n- ## Head\n", "Head"],
		["a heading continuing an item", "- a\n\n  ## Head\n", "Head"],
		[
			"a line after a table",
			"| a | b |\n| --- | --- |\n| c | d |\n\nafter\n",
			"after",
		],
		["a line after an image", "![alt](x.png)\n\nafter\n", "after"],
		["a line after a divider", "para\n\n---\n\nafter\n", "after"],
		["a line after a code block", "```js\nx\n```\n\nafter\n", "after"],
		["a line after frontmatter", "---\ntitle: x\n---\n\n# after\n", "after"],
	];
	for (const [name, markdown, text] of cases) {
		test(`${name}, twice, and undo puts both back`, () => {
			const editor = editorFor(markdown);
			caret(editor, text, 0);
			const before = at(editor);
			const original = md(editor);
			expect(key(editor, "Enter")).toBe(true);
			expect(at(editor)).toEqual(before);
			expect(key(editor, "Enter")).toBe(true);
			expect(at(editor)).toEqual(before);
			expect(md(editor)).not.toBe(original);
			editor.commands.undo();
			editor.commands.undo();
			expect(md(editor)).toBe(original);
			expect(at(editor)).toEqual(before);
		});
	}
});

describe("a heading inside a list item", () => {
	test("Enter at the start of a heading leading an item opens an empty item above", () => {
		const editor = editorFor("- a\n- ## Head\n");
		caret(editor, "Head", 0);
		expect(key(editor, "Enter")).toBe(true);
		// Was "- a\n- <span></span>\n  ## Head\n": an empty line inside the item.
		expect(md(editor)).toBe("- a\n-\n- ## Head\n");
		expect(at(editor)).toEqual({ block: "heading", text: "Head", offset: 0 });
		type(editor, "x");
		expect(md(editor)).toBe("- a\n-\n- ## xHead\n");
	});

	test("Enter twice opens two empty items and Backspace takes them back", () => {
		const editor = editorFor("1. a\n2. ## Head\n");
		caret(editor, "Head", 0);
		key(editor, "Enter");
		key(editor, "Enter");
		expect(md(editor)).toBe("1. a\n2.\n3.\n4. ## Head\n");
		expect(key(editor, "Backspace")).toBe(true);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("1. a\n2. ## Head\n");
		expect(at(editor)).toEqual({ block: "heading", text: "Head", offset: 0 });
	});

	test("Enter at the start of a heading continuing an item gives it an item of its own", () => {
		const editor = editorFor("- a\n\n  ## more\n");
		caret(editor, "more", 0);
		expect(key(editor, "Enter")).toBe(true);
		// Was "- a\n\n\n\n  ## more\n", whose blank lines did not survive a reload.
		expect(md(editor)).toBe("- a\n- ## more\n");
		expect(at(editor)).toEqual({ block: "heading", text: "more", offset: 0 });
		editor.commands.undo();
		expect(md(editor)).toBe("- a\n\n  ## more\n");
		expect(at(editor)).toEqual({ block: "heading", text: "more", offset: 0 });
	});

	test("Backspace at the start of a heading leading an item turns it into the item's text", () => {
		const editor = editorFor("- ## Head\n- b\n");
		caret(editor, "Head", 0);
		expect(key(editor, "Backspace")).toBe(true);
		// Was "- <span></span>\n  ## Head\n- b\n", on every press.
		expect(md(editor)).toBe("- Head\n- b\n");
		expect(at(editor)).toEqual({ block: "paragraph", text: "Head", offset: 0 });
	});
});
