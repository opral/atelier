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

describe("autolink on Enter", () => {
	test("a URL that ends the line becomes a link when Enter splits it", () => {
		const editor = editorFor("");
		type(editor, "see https://example.com/a.");
		key(editor, "Enter");
		type(editor, "next");
		expect(runs(editor)).toEqual([
			["see ", ""],
			["https://example.com/a", "link:https://example.com/a"],
			[".", ""],
			["next", ""],
		]);
		expect(editor.state.doc.childCount).toBe(2);
	});

	test("in a list item too; undo takes back the split, then the link", () => {
		const editor = editorFor("- a\n");
		caret(editor, "a", "end");
		type(editor, " www.x.io");
		key(editor, "Enter");
		expect(md(editor)).toBe("- a [www.x.io](https://www.x.io)\n-\n");
		editor.commands.undo();
		expect(md(editor)).toBe("- a [www.x.io](https://www.x.io)\n");
		editor.commands.undo();
		expect(runs(editor)).toEqual([["a www.x.io", ""]]);
	});
	test("not inside inline code", () => {
		const editor = editorFor("run `https://a.b`\n");
		caret(editor, "run https://a.b", "end");
		editor.view.dispatch(editor.state.tr.setStoredMarks(null));
		key(editor, "Enter");
		expect(runs(editor)[1]).toEqual(["https://a.b", "code"]);
	});
});

describe("inline code edges", () => {
	test("ArrowRight at the end of a line steps out of a code span", () => {
		const editor = editorFor("run `ls`\n");
		caret(editor, "run ls", "end");
		expect(key(editor, "ArrowRight")).toBe(true);
		type(editor, " now");
		expect(runs(editor)).toEqual([
			["run ", ""],
			["ls", "code"],
			[" now", ""],
		]);
	});

	test("a second ArrowRight moves on as usual", () => {
		const editor = editorFor("run `ls`\n\nnext\n");
		caret(editor, "run ls", "end");
		key(editor, "ArrowRight");
		expect(key(editor, "ArrowRight")).toBeFalsy();
	});

	test("typing at the very start of a line does not join a code span", () => {
		const editor = editorFor("`ls` it\n");
		caret(editor, "ls it", 0);
		type(editor, "Run ");
		expect(runs(editor)).toEqual([
			["Run ", ""],
			["ls", "code"],
			[" it", ""],
		]);
	});

	test("typing at the end of a span inside a line still extends it", () => {
		const editor = editorFor("`ls` it\n");
		caret(editor, "ls it", 2);
		type(editor, " -a");
		expect(runs(editor)[0]).toEqual(["ls -a", "code"]);
	});

	test("Mod-e then typing writes code", () => {
		const editor = editorFor("x\n");
		caret(editor, "x", "end");
		key(editor, "e", { ctrlKey: true });
		type(editor, "abc");
		expect(runs(editor)).toEqual([
			["x", ""],
			["abc", "code"],
		]);
	});

	test("Markdown typed inside a code span stays code", () => {
		const editor = editorFor("`a b`\n");
		caret(editor, "a b", 1);
		type(editor, " **k** _i_ ");
		expect(runs(editor)).toEqual([["a **k** _i_  b", "code"]]);
	});

	test("bold around code still round-trips", () => {
		const editor = editorFor("**`x`** and [`y`](https://y.io)\n");
		expect(md(editor)).toBe("**`x`** and [`y`](https://y.io)\n");
	});
});

describe("emphasis after opening punctuation", () => {
	test("brackets, quotes and dashes may open a delimiter run", () => {
		const editor = editorFor("");
		type(editor, '(**bold**) "*quote*" (`code`) [~~s~~] —_i_');
		expect(runs(editor)).toEqual([
			["(", ""],
			["bold", "bold"],
			[') "', ""],
			["quote", "italic"],
			['" (', ""],
			["code", "code"],
			[") [", ""],
			["s", "strike"],
			["] —", ""],
			["i", "italic"],
		]);
	});

	test.each(["2*3*4", "snake_case_name", "a*b*c", "foo__bar__", "file_*name*"])(
		"%s stays literal",
		(text) => {
			const editor = editorFor("");
			type(editor, text);
			expect(runs(editor)).toEqual([[text, ""]]);
		},
	);
});

describe("undo right after an inline autoformat", () => {
	test.each([
		[
			"hello **b**",
			[
				["hello ", ""],
				["b", "bold"],
			],
		],
		[
			"run `c`",
			[
				["run ", ""],
				["c", "code"],
			],
		],
		[
			"go [a](b.com)",
			[
				["go ", ""],
				["a", "link:https://b.com"],
			],
		],
		[
			"x https://a.b ",
			[
				["x ", ""],
				["https://a.b", "link:https://a.b"],
				[" ", ""],
			],
		],
	])(
		"%s: undo gives the literal text back, redo the format",
		(text, formatted) => {
			const editor = editorFor("");
			type(editor, text);
			expect(runs(editor)).toEqual(formatted);
			editor.commands.undo();
			expect(runs(editor)).toEqual([[text, ""]]);
			editor.commands.redo();
			expect(runs(editor)).toEqual(formatted);
			editor.commands.undo();
			editor.commands.undo();
			expect(editor.state.doc.textContent).toBe("");
		},
	);

	test("text typed after the format is its own undo step", () => {
		const editor = editorFor("");
		type(editor, "hello **b** more");
		editor.commands.undo();
		expect(runs(editor)).toEqual([
			["hello ", ""],
			["b", "bold"],
		]);
		editor.commands.undo();
		expect(runs(editor)).toEqual([["hello **b**", ""]]);
	});

	test("Backspace right after the format still gives the literal back", () => {
		const editor = editorFor("");
		type(editor, "hello **b**");
		key(editor, "Backspace");
		expect(runs(editor)).toEqual([["hello **b**", ""]]);
	});
});

describe("task shortcut in an ordered list", () => {
	test("[ ] in a new numbered item makes that item a task", () => {
		const editor = editorFor("1. a\n");
		caret(editor, "a", "end");
		key(editor, "Enter");
		type(editor, "[ ] b");
		editor.state.doc.check();
		expect(md(editor)).toBe("1. a\n2. [ ] b\n");
	});

	test("1. [x] in an empty document", () => {
		const editor = editorFor("");
		type(editor, "1. [x] done");
		editor.state.doc.check();
		expect(md(editor)).toBe("1. [x] done\n");
	});
});

describe("divider in an empty list item", () => {
	test("--- leaves the list and puts the rule after it", () => {
		const editor = editorFor("- a\n");
		caret(editor, "a", "end");
		key(editor, "Enter");
		type(editor, "---");
		editor.state.doc.check();
		expect(editor.state.doc.child(1).type.name).toBe("horizontalRule");
		expect(editor.state.selection.$from.depth).toBe(1);
		type(editor, "next");
		expect(md(editor)).toBe("- a\n\n***\n\nnext\n");
	});

	test("between two items it splits the list", () => {
		const editor = editorFor("- a\n- b\n");
		caret(editor, "a", "end");
		key(editor, "Enter");
		type(editor, "---");
		editor.state.doc.check();
		expect(editor.state.doc.content.content.map((n) => n.type.name)).toEqual([
			"bulletList",
			"horizontalRule",
			"paragraph",
			"bulletList",
		]);
	});

	test("in a nested item it leaves every list", () => {
		const editor = editorFor("1. a\n   - b\n");
		caret(editor, "b", "end");
		key(editor, "Enter");
		type(editor, "---");
		editor.state.doc.check();
		expect(editor.state.doc.content.content.map((n) => n.type.name)).toEqual([
			"orderedList",
			"horizontalRule",
			"paragraph",
		]);
	});
});
