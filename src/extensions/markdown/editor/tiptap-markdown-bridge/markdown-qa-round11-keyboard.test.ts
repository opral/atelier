// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
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
describe("Delete at the end of a list or quote never reaches into what follows", () => {
	test("before a table keeps the table intact", () => {
		const editor = editorFor("- a\n- b\n\n| x | z |\n| - | - |\n| y | w |\n");
		caret(editor, "b", "end");
		expect(key(editor, "Delete")).toBe(true);
		expect(md(editor)).toBe("- a\n- b\n\n| x | z |\n| - | - |\n| y | w |\n");
	});
	test("before a rule selects the rule instead of deleting it", () => {
		const editor = editorFor("- a\n- b\n\n***\n\nc\n");
		caret(editor, "b", "end");
		expect(key(editor, "Delete")).toBe(true);
		expect(md(editor)).toBe("- a\n- b\n\n***\n\nc\n");
		expect((editor.state.selection as NodeSelection).node?.type.name).toBe(
			"horizontalRule",
		);
	});
	test("at the end of a quote before a rule selects the rule", () => {
		const editor = editorFor("> a\n\n***\n");
		caret(editor, "a", "end");
		expect(key(editor, "Delete")).toBe(true);
		expect(md(editor)).toBe("> a\n\n***\n");
		expect((editor.state.selection as NodeSelection).node?.type.name).toBe(
			"horizontalRule",
		);
	});
	test("still folds the next item's text onto this line", () => {
		const editor = editorFor("- a\n- b\n\nc\n");
		caret(editor, "b", "end");
		expect(key(editor, "Delete")).toBe(true);
		expect(md(editor)).toBe("- a\n- bc\n");
	});
	test("in an empty last item removes the item, not the paragraph after", () => {
		const editor = editorFor("- a\n-\n\npara\n");
		caret(editor, "", 0);
		expect(key(editor, "Delete")).toBe(true);
		expect(md(editor)).toBe("- a\n\npara\n");
	});
	test("in a quote before an image keeps the image", () => {
		const editor = editorFor("> a\n\n![i](i.png)\n\nc\n");
		caret(editor, "a", "end");
		expect(key(editor, "Delete")).toBe(true);
		expect(md(editor)).toContain("![i](i.png)");
	});
});

describe("Backspace after a quote or list never reaches through its last block", () => {
	test("an image at the end of a quote survives", () => {
		const editor = editorFor("> a\n>\n> ![i](i.png)\n\npara\n");
		caret(editor, "para", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toContain("![i](i.png)");
	});
	test("prose never joins a code block at the end of a quote", () => {
		const editor = editorFor("> ```\n> x\n> ```\n\npara\n");
		caret(editor, "para", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("> ```\n> x\n> ```\n\npara\n");
	});
	test("prose never joins a table cell at the end of a list item", () => {
		const editor = editorFor("- a\n\n  | x |\n  | - |\n  | y |\n\npara\n");
		caret(editor, "para", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toContain("| y |");
		expect(md(editor)).toContain("para");
		expect(md(editor)).not.toContain("ypara");
	});
});

describe("Backspace inside a quote or list item treats blocks above like the top level", () => {
	test("prose never joins a code block", () => {
		const editor = editorFor("> ```\n> code\n> ```\n>\n> b\n");
		caret(editor, "b", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("> ```\n> code\n> ```\n>\n> b\n");
		expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
	});
	test("a rule is selected first", () => {
		const editor = editorFor("> a\n>\n> ***\n>\n> b\n");
		caret(editor, "b", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("> a\n>\n> ***\n>\n> b\n");
		expect((editor.state.selection as NodeSelection).node?.type.name).toBe(
			"horizontalRule",
		);
	});
	test("an image is selected first", () => {
		const editor = editorFor("> ![alt](a.png)\n>\n> b\n");
		caret(editor, "b", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toContain("![alt](a.png)");
	});
	test("text after a table is not merged into its last cell", () => {
		const editor = editorFor("- a\n\n  | x |\n  | - |\n  | y |\n\n  b\n");
		caret(editor, "b", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).not.toContain("yb");
	});
});

describe("Backspace on a line after a list inside a quote", () => {
	test("folds onto the last item instead of toggling back into the list", () => {
		const editor = editorFor("> - a\n> - b\n");
		caret(editor, "b", 0);
		key(editor, "Backspace"); // lifts: "> - a\n>\n> b"
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("> - ab\n");
	});
});

describe("Backspace on an empty line in the middle of a quote", () => {
	test("takes back the line and keeps one quote", () => {
		const editor = editorFor("> a\n>\n> b\n");
		caret(editor, "a", "end");
		key(editor, "Enter");
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("> a\n>\n> b\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("a");
		expect(editor.state.selection.$from.parentOffset).toBe(1);
	});
});

describe("Backspace on an empty line below a non-text block removes the line", () => {
	test.each([
		["code block", "```\ncode\n```"],
		["table", "| a |\n| - |\n| c |"],
		["rule", "***"],
		["image", "![a](a.png)"],
		["frontmatter", "---\nt: x\n---"],
	])("below a %s", (_name, block) => {
		const editor = editorFor(`${block}\n\n<span></span>\n\nend\n`);
		caret(editor, "", 0);
		key(editor, "Backspace");
		expect(md(editor)).toBe(`${block}\n\nend\n`);
	});
});

describe("Delete at the end of a code block", () => {
	test("does not pull the next paragraph into the code", () => {
		const editor = editorFor("```\nx\n```\n\npara\n");
		caret(editor, "x", "end");
		key(editor, "Delete");
		expect(md(editor)).toBe("```\nx\n```\n\npara\n");
	});
});
describe("footnote definitions survive block-boundary keys", () => {
	test("Backspace at the start of a definition keeps the footnote", () => {
		const editor = editorFor("text[^1]\n\n[^1]: note one\n");
		caret(editor, "note one", 0);
		key(editor, "Backspace");
		const out = md(editor);
		expect(out).toContain("[^1]: ");
		expect(md(editorFor(out))).toBe(out);
	});
	test("Delete at the end of the text above keeps the definition", () => {
		const editor = editorFor("text[^1]\n\n[^1]: note one\n");
		caret(editor, "text", "end");
		key(editor, "Delete");
		const out = md(editor);
		expect(md(editorFor(out))).toBe(out);
		expect(out).toContain("[^1]: note one");
	});
	test("Delete at the end of one definition does not swallow the next", () => {
		const editor = editorFor("a[^1] b[^2]\n\n[^1]: one\n\n[^2]: two\n");
		caret(editor, "one", "end");
		key(editor, "Delete");
		expect(md(editor)).toContain("[^2]: two");
	});
});
describe("undo after Enter and typing", () => {
	test("the first Mod-z takes back the typing, the second the new block", () => {
		const editor = editorFor("para\n");
		caret(editor, "para", "end");
		key(editor, "Enter");
		type(editor, "xy");
		editor.commands.undo();
		expect(md(editor)).toBe("para\n\n<span></span>\n");
		editor.commands.undo();
		expect(md(editor)).toBe("para\n");
	});
	test("in a list too", () => {
		const editor = editorFor("- a\n");
		caret(editor, "a", "end");
		key(editor, "Enter");
		type(editor, "xy");
		editor.commands.undo();
		expect(md(editor)).toBe("- a\n-\n");
	});
});
describe("Tab and Shift-Tab in a code block", () => {
	test("Tab over selected lines indents them instead of replacing them", () => {
		const editor = editorFor("```js\nif (a) {\nfoo();\n}\n```\n");
		const start = 1 + "if (a) {\n".length;
		editor.view.dispatch(
			editor.state.tr.setSelection(
				TextSelection.create(editor.state.doc, 1, start + 6),
			),
		);
		expect(key(editor, "Tab")).toBe(true);
		expect(md(editor)).toBe("```js\n\tif (a) {\n\tfoo();\n}\n```\n");
	});
	test("Shift-Tab outdents the line and keeps focus in the document", () => {
		const editor = editorFor("```js\n\tfoo();\n```\n");
		caret(editor, "\tfoo();", 3);
		expect(key(editor, "Tab", { shiftKey: true })).toBe(true);
		expect(md(editor)).toBe("```js\nfoo();\n```\n");
	});
	test("Shift-Tab over selected lines outdents each of them", () => {
		const editor = editorFor("```js\n\ta();\n  b();\nc();\n```\n");
		const code = "\ta();\n  b();\nc();";
		editor.view.dispatch(
			editor.state.tr.setSelection(
				TextSelection.create(editor.state.doc, 2, 1 + code.length),
			),
		);
		expect(key(editor, "Tab", { shiftKey: true })).toBe(true);
		expect(md(editor)).toBe("```js\na();\nb();\nc();\n```\n");
	});
	test("Shift-Tab in a plain paragraph is consumed like Tab", () => {
		const editor = editorFor("para\n");
		caret(editor, "para", 0);
		expect(key(editor, "Tab", { shiftKey: true })).toBe(true);
	});
});

describe("leaving a footnote definition from the keyboard", () => {
	test("Enter on the empty last line of a definition exits it", () => {
		const editor = editorFor("text[^1]\n\n[^1]: note one\n");
		caret(editor, "note one", "end");
		key(editor, "Enter");
		key(editor, "Enter");
		type(editor, "x");
		expect(md(editor)).toBe("text[^1]\n\n[^1]: note one\n\nx\n");
	});
	test("Backspace on that empty line takes it back instead", () => {
		const editor = editorFor("text[^1]\n\n[^1]: note one\n");
		caret(editor, "note one", "end");
		key(editor, "Enter");
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("text[^1]\n\n[^1]: note one\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("note one");
	});
	test("ArrowDown at the end of the last definition opens a line below", () => {
		const editor = editorFor("text[^1]\n\n[^1]: note one\n");
		caret(editor, "note one", "end");
		expect(key(editor, "ArrowDown")).toBe(true);
		type(editor, "x");
		expect(md(editor)).toBe("text[^1]\n\n[^1]: note one\n\nx\n");
	});
});

describe("a code block at the top of the document", () => {
	test("ArrowUp at its start opens a line above, like a table or a rule", () => {
		const editor = editorFor("```\nx\n```\n\nafter\n");
		caret(editor, "x", 0);
		expect(key(editor, "ArrowUp")).toBe(true);
		type(editor, "y");
		expect(md(editor)).toBe("y\n\n```\nx\n```\n\nafter\n");
	});
	test("ArrowLeft at its start does the same", () => {
		const editor = editorFor("```\nx\n```\n");
		caret(editor, "x", 0);
		expect(key(editor, "ArrowLeft")).toBe(true);
		type(editor, "y");
		expect(md(editor)).toBe("y\n\n```\nx\n```\n");
	});
});

describe("a table deleted from inside", () => {
	test("Backspace in the first cell of an emptied table removes it", () => {
		const editor = editorFor(
			"before\n\n| A | B |\n| - | - |\n| a1 | b1 |\n\nafter\n",
		);
		select(editor, "A", 0, "b1", 2);
		expect(key(editor, "Backspace")).toBe(true);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("before\n\nafter\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("before");
	});
	test("a table with text left in a cell stays", () => {
		const editor = editorFor("before\n\n| A | B |\n| - | - |\n| a1 | b1 |\n");
		const original = md(editor);
		caret(editor, "A", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe(original);
	});
});

describe("Enter at the start of an item's continuation line", () => {
	test("gives the line an item of its own and loses nothing on reload", () => {
		const editor = editorFor("- a\n\n  b\n");
		caret(editor, "b", 0);
		expect(key(editor, "Enter")).toBe(true);
		const out = md(editor);
		expect(out).toBe("- a\n- b\n");
		expect(md(editorFor(out))).toBe(out);
		expect(editor.state.selection.$from.parent.textContent).toBe("b");
		expect(editor.state.selection.$from.parentOffset).toBe(0);
	});
});
