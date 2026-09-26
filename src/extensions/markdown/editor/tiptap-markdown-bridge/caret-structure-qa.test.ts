// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";
import { parseMarkdown } from "../markdown";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { BLOCK_COMMANDS } from "../block-commands";

// After a structural edit the caret stays beside the text it was next to.

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
/** The caret's block type and its text with a "|" where the caret is. */
function at(editor: Editor) {
	const { $from } = editor.state.selection;
	const text = $from.parent.textContent;
	return `${$from.parent.type.name}:${text.slice(0, $from.parentOffset)}|${text.slice($from.parentOffset)}`;
}
function blockCommand(editor: Editor, id: string) {
	BLOCK_COMMANDS.find((command) => command.id === id)!.insert(editor);
}
const md = (editor: Editor) => buildMarkdownFromEditor(editor);
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("Backspace on an empty line above a heading", () => {
	test("ends the caret on the paragraph above, not on the heading", () => {
		const editor = editorFor("Intro\n\n<span></span>\n\n## Heading\n");
		caret(editor, "", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("Intro\n\n## Heading\n");
		expect(at(editor)).toBe("paragraph:Intro|");
	});

	test("ends the caret on a heading above", () => {
		const editor = editorFor("# A\n\n<span></span>\n\n## Heading\n");
		caret(editor, "", 0);
		key(editor, "Backspace");
		expect(md(editor)).toBe("# A\n\n## Heading\n");
		expect(at(editor)).toBe("heading:A|");
	});

	test("ends the caret on the last item of a list above", () => {
		const editor = editorFor("- a\n\n<span></span>\n\n## H\n");
		caret(editor, "", 0);
		key(editor, "Backspace");
		expect(md(editor)).toBe("- a\n\n## H\n");
		expect(at(editor)).toBe("paragraph:a|");
	});

	test("ends the caret on the line above inside a quote", () => {
		const editor = editorFor("> p\n>\n> <span></span>\n>\n> ## H\n");
		caret(editor, "", 0);
		key(editor, "Backspace");
		expect(md(editor)).toBe("> p\n>\n> ## H\n");
		expect(at(editor)).toBe("paragraph:p|");
	});

	test("keeps the caret on the heading when nothing is above the line", () => {
		const editor = editorFor("<span></span>\n\n## H\n");
		caret(editor, "", 0);
		key(editor, "Backspace");
		expect(md(editor)).toBe("## H\n");
		expect(at(editor)).toBe("heading:|H");
	});

	test("after Enter at the heading's start, ArrowUp and Backspace go back up", () => {
		const editor = editorFor("Intro\n\n## Heading\n");
		caret(editor, "Heading", 0);
		key(editor, "Enter");
		caret(editor, "", 0);
		key(editor, "Backspace");
		expect(md(editor)).toBe("Intro\n\n## Heading\n");
		expect(at(editor)).toBe("paragraph:Intro|");
	});
});

describe("Text on a code block", () => {
	test("keeps the caret beside the same character on its line", () => {
		const editor = editorFor("```\na\n\nbb\nccc\n```\n");
		caret(editor, "a\n\nbb\nccc", "end");
		blockCommand(editor, "paragraph");
		expect(md(editor)).toBe("a\n\nbb\n\nccc\n");
		expect(at(editor)).toBe("paragraph:ccc|");
	});

	test("keeps the caret mid-line in a one-line block", () => {
		const editor = editorFor("```\nabc\n```\n");
		caret(editor, "abc", 2);
		blockCommand(editor, "paragraph");
		expect(at(editor)).toBe("paragraph:ab|c");
	});

	test("on a dropped blank line, ends the caret where the line above ended", () => {
		const editor = editorFor("```\na\n\nbb\n```\n");
		caret(editor, "a\n\nbb", 2);
		blockCommand(editor, "paragraph");
		expect(md(editor)).toBe("a\n\nbb\n");
		expect(at(editor)).toBe("paragraph:a|");
	});

	test("on a blank first line, puts the caret at the start of the first line kept", () => {
		const editor = editorFor("```\n\nbb\n```\n");
		caret(editor, "\nbb", 0);
		blockCommand(editor, "paragraph");
		expect(md(editor)).toBe("bb\n");
		expect(at(editor)).toBe("paragraph:|bb");
	});

	test("undo puts the caret back in the code", () => {
		const editor = editorFor("```\nabc\nde\n```\n");
		caret(editor, "abc\nde", 5);
		blockCommand(editor, "paragraph");
		expect(at(editor)).toBe("paragraph:d|e");
		editor.commands.undo();
		expect(at(editor)).toBe("codeBlock:abc\nd|e");
	});
});

describe("/Table before text", () => {
	test("at the start of a line enters the new table's first cell", () => {
		const editor = editorFor("Hello\n");
		caret(editor, "Hello", 0);
		blockCommand(editor, "table");
		expect(md(editor)).toBe(
			"|   |   |   |\n| - | - | - |\n|   |   |   |\n|   |   |   |\n\nHello\n",
		);
		const { $from } = editor.state.selection;
		expect($from.parent.type.name).toBe("tableCell");
		expect($from.index($from.depth - 2)).toBe(0);
		expect($from.index($from.depth - 1)).toBe(0);
	});

	test("in the middle of a line enters the new table's first cell", () => {
		const editor = editorFor("Hello world\n");
		caret(editor, "Hello world", 5);
		blockCommand(editor, "table");
		expect(editor.state.selection.$from.parent.type.name).toBe("tableCell");
		expect(md(editor)).toContain("Hello\n\n|");
	});

	test("after another table enters the new one, not the old one", () => {
		const editor = editorFor("| x |\n| - |\n| y |\n\nHello\n");
		caret(editor, "Hello", 0);
		blockCommand(editor, "table");
		const { $from } = editor.state.selection;
		expect($from.parent.type.name).toBe("tableCell");
		// The first table in the document is the old one.
		expect(editor.state.doc.child(1).type.name).toBe("table");
		expect($from.before(1)).toBe(editor.state.doc.child(0).nodeSize);
	});
});

describe("/Divider before text", () => {
	test("at the start of a line keeps the caret with the text and opens no empty line", () => {
		const editor = editorFor("Hello\n");
		caret(editor, "Hello", 0);
		blockCommand(editor, "horizontalRule");
		expect(md(editor)).toBe("***\n\nHello\n");
		expect(at(editor)).toBe("paragraph:|Hello");
	});

	test("in the middle of a line keeps the caret with the rest of the line", () => {
		const editor = editorFor("Hello world\n");
		caret(editor, "Hello world", 5);
		blockCommand(editor, "horizontalRule");
		expect(md(editor)).toBe("Hello\n\n***\n\nworld\n");
		expect(at(editor)).toBe("paragraph:| world");
	});

	test("at the end of a line still opens a line below the rule", () => {
		const editor = editorFor("Hello\n");
		caret(editor, "Hello", "end");
		blockCommand(editor, "horizontalRule");
		expect(md(editor)).toBe("Hello\n\n***\n\n<span></span>\n");
		expect(at(editor)).toBe("paragraph:|");
	});
});
