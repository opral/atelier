// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";
import { parseMarkdown } from "../markdown";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { calloutFolded } from "./callout-node-view";

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
/** The caret's line: its type, its text and the offset in it. */
function at(editor: Editor) {
	const { $from } = editor.state.selection;
	return {
		type: $from.parent.type.name,
		text: $from.parent.textContent,
		offset: $from.parentOffset,
	};
}
/** Position of the first callout in the document. */
function calloutPos(editor: Editor) {
	let found = -1;
	editor.state.doc.descendants((node, pos) => {
		if (found < 0 && node.type.name === "callout") found = pos;
	});
	return found;
}
const md = (editor: Editor) => buildMarkdownFromEditor(editor);
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("Enter in the title", () => {
	test("at the end opens a new first body line", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", "end");
		expect(key(editor, "Enter")).toBe(true);
		expect(at(editor)).toEqual({ type: "paragraph", text: "", offset: 0 });
		type(editor, "New");
		expect(md(editor)).toBe("> [!NOTE] Title\n> New\n>\n> Body\n");
	});

	test("in the middle does not split the title", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", 2);
		expect(key(editor, "Enter")).toBe(true);
		type(editor, "New");
		expect(md(editor)).toBe("> [!NOTE] Title\n> New\n>\n> Body\n");
	});

	test("goes into an empty first line instead of adding another", () => {
		const editor = editorFor("> [!NOTE] Title\n");
		caret(editor, "Title", "end");
		expect(key(editor, "Enter")).toBe(true);
		type(editor, "x");
		expect(md(editor)).toBe("> [!NOTE] Title\n> x\n");
	});

	test("a body that starts with a list gets a line before it", () => {
		const editor = editorFor("> [!NOTE] Title\n>\n> - one\n");
		caret(editor, "Title", "end");
		expect(key(editor, "Enter")).toBe(true);
		expect(at(editor).type).toBe("paragraph");
		type(editor, "Intro");
		expect(md(editor)).toBe("> [!NOTE] Title\n> Intro\n>\n> - one\n");
	});

	test("replaces a selection inside the title", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", 0);
		const from = editor.state.selection.from;
		editor.commands.setTextSelection({ from: from + 2, to: from + 5 });
		expect(key(editor, "Enter")).toBe(true);
		type(editor, "New");
		expect(md(editor)).toBe("> [!NOTE] Ti\n> New\n>\n> Body\n");
	});

	test("Shift-Enter does the same: the title is one line", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", 2);
		expect(key(editor, "Enter", { shiftKey: true })).toBe(true);
		type(editor, "New");
		expect(md(editor)).toBe("> [!NOTE] Title\n> New\n>\n> Body\n");
	});
});

describe("Enter in a folded callout's title", () => {
	test("unfolds it and goes into the body", () => {
		const editor = editorFor("> [!NOTE]- Title\n> Body\n");
		expect(calloutFolded(editor.view, calloutPos(editor))).toBe(true);
		caret(editor, "Title", "end");
		expect(key(editor, "Enter")).toBe(true);
		expect(calloutFolded(editor.view, calloutPos(editor))).toBe(false);
		type(editor, "New");
		expect(md(editor)).toBe("> [!NOTE]- Title\n> New\n>\n> Body\n");
	});
});

describe("Enter in the body", () => {
	test("makes a new line inside, as in a quote", () => {
		const editor = editorFor("> [!NOTE] T\n> Body\n");
		caret(editor, "Body", "end");
		expect(key(editor, "Enter")).toBe(true);
		type(editor, "two");
		expect(md(editor)).toBe("> [!NOTE] T\n> Body\n>\n> two\n");
	});

	test("on an empty last line leaves the callout with that line", () => {
		const editor = editorFor("> [!NOTE] T\n> Body\n");
		caret(editor, "Body", "end");
		key(editor, "Enter");
		expect(key(editor, "Enter")).toBe(true);
		expect(editor.state.selection.$from.depth).toBe(1);
		type(editor, "after");
		expect(md(editor)).toBe("> [!NOTE] T\n> Body\n\nafter\n");
	});

	test("on the only, empty body line keeps it and goes below", () => {
		const editor = editorFor("> [!NOTE] T\n");
		caret(editor, "T", "end");
		key(editor, "Enter");
		expect(key(editor, "Enter")).toBe(true);
		expect(editor.state.doc.firstChild!.childCount).toBe(2);
		expect(editor.state.selection.$from.depth).toBe(1);
		type(editor, "after");
		expect(md(editor)).toBe("> [!NOTE] T\n\nafter\n");
	});

	test("on an empty middle line stays inside and adds a line", () => {
		const editor = editorFor("> [!NOTE] T\n> a\n>\n> b\n");
		caret(editor, "a", "end");
		key(editor, "Enter");
		expect(key(editor, "Enter")).toBe(true);
		expect(editor.state.doc.childCount).toBe(1);
		expect(editor.state.selection.$from.node(-1).type.name).toBe("callout");
		const lines: string[] = [];
		editor.state.doc.firstChild!.forEach((line) =>
			lines.push(line.textContent),
		);
		expect(lines).toEqual(["T", "a", "", "", "b"]);
		expect(at(editor)).toEqual({ type: "paragraph", text: "", offset: 0 });
		expect(editor.state.selection.$from.index(-1)).toBe(3);
	});

	test("Shift-Enter is a line break", () => {
		const editor = editorFor("> [!NOTE] T\n> ab\n");
		caret(editor, "ab", 1);
		expect(key(editor, "Enter", { shiftKey: true })).toBe(true);
		expect(md(editor)).toBe("> [!NOTE] T\n> a\\\n> b\n");
	});

	test("a callout inside a list keeps Enter in the callout", () => {
		const editor = editorFor("- item\n\n  > [!TIP]\n  > Body\n");
		caret(editor, "Body", "end");
		expect(key(editor, "Enter")).toBe(true);
		type(editor, "two");
		expect(md(editor)).toBe("- item\n\n  > [!TIP]\n  > Body\n  >\n  > two\n");
		key(editor, "Enter");
		key(editor, "Enter");
		type(editor, "after");
		expect(md(editor)).toBe(
			"- item\n\n  > [!TIP]\n  > Body\n  >\n  > two\n\n  after\n",
		);
	});
});

describe("Backspace at the start of the body", () => {
	test("goes to the end of the title without joining", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Body", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("> [!NOTE] Title\n> Body\n");
		expect(at(editor)).toEqual({
			type: "calloutTitle",
			text: "Title",
			offset: 5,
		});
	});

	test("keeps an empty only body line", () => {
		const editor = editorFor("> [!NOTE] Title\n");
		caret(editor, "Title", "end");
		key(editor, "Enter");
		expect(key(editor, "Backspace")).toBe(true);
		expect(editor.state.doc.firstChild!.childCount).toBe(2);
		expect(at(editor)).toEqual({
			type: "calloutTitle",
			text: "Title",
			offset: 5,
		});
	});

	test("removes an empty first line when more follow", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", "end");
		key(editor, "Enter");
		expect(editor.state.doc.firstChild!.childCount).toBe(3);
		expect(key(editor, "Backspace")).toBe(true);
		expect(editor.state.doc.firstChild!.childCount).toBe(2);
		expect(md(editor)).toBe("> [!NOTE] Title\n> Body\n");
		expect(at(editor).type).toBe("calloutTitle");
	});

	test("inside a quote goes to the title, not out of the quote", () => {
		const editor = editorFor("> outer\n>\n> > [!NOTE] T\n> > Body\n");
		caret(editor, "Body", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("> outer\n>\n> > [!NOTE] T\n> > Body\n");
		expect(at(editor)).toEqual({ type: "calloutTitle", text: "T", offset: 1 });
	});

	test("undo restores a removed empty line and the caret", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", "end");
		key(editor, "Enter");
		key(editor, "Backspace");
		editor.commands.undo();
		expect(editor.state.doc.firstChild!.childCount).toBe(3);
		expect(at(editor)).toEqual({ type: "paragraph", text: "", offset: 0 });
	});
});

describe("Backspace at the start of the title", () => {
	test("turns the callout back into text", () => {
		const editor = editorFor("Before\n\n> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("Before\n\nTitle\n\nBody\n");
		expect(at(editor)).toEqual({ type: "paragraph", text: "Title", offset: 0 });
	});

	test("an empty title leaves the body, caret at its start", () => {
		const editor = editorFor("> [!NOTE]\n> Body\n>\n> - one\n");
		caret(editor, "", 0);
		expect(at(editor).type).toBe("calloutTitle");
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("Body\n\n- one\n");
		expect(at(editor)).toEqual({ type: "paragraph", text: "Body", offset: 0 });
	});

	test("a callout with only a title becomes one line", () => {
		const editor = editorFor("> [!TIP] Only\n");
		caret(editor, "Only", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(editor.state.doc.childCount).toBe(1);
		expect(md(editor)).toBe("Only\n");
	});

	test("undo brings the callout back in one step", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", 0);
		key(editor, "Backspace");
		editor.commands.undo();
		expect(md(editor)).toBe("> [!NOTE] Title\n> Body\n");
		expect(at(editor)).toEqual({
			type: "calloutTitle",
			text: "Title",
			offset: 0,
		});
	});
});

describe("arrows", () => {
	test("Up from the title's start goes to the block above", () => {
		const editor = editorFor("Above\n\n> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", 0);
		expect(key(editor, "ArrowUp")).toBe(true);
		expect(at(editor)).toEqual({ type: "paragraph", text: "Above", offset: 5 });
	});

	test("Up from the title's start opens a line above a first callout", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", 0);
		expect(key(editor, "ArrowUp")).toBe(true);
		expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
		expect(at(editor)).toEqual({ type: "paragraph", text: "", offset: 0 });
	});

	test("Down from the end of the body goes to the block below", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n\nBelow\n");
		caret(editor, "Body", "end");
		expect(key(editor, "ArrowDown")).toBe(true);
		expect(at(editor)).toEqual({ type: "paragraph", text: "Below", offset: 0 });
	});

	test("Down from the end of the body opens a line below a last callout", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Body", "end");
		expect(key(editor, "ArrowDown")).toBe(true);
		expect(editor.state.doc.lastChild!.type.name).toBe("paragraph");
		expect(at(editor)).toEqual({ type: "paragraph", text: "", offset: 0 });
	});

	test("Down from the end of a list that ends the body leaves the callout", () => {
		const editor = editorFor("> [!NOTE] T\n>\n> - one\n\nBelow\n");
		caret(editor, "one", "end");
		expect(key(editor, "ArrowDown")).toBe(true);
		expect(at(editor).text).toBe("Below");
	});

	test("Down from a folded title steps over the body", () => {
		const editor = editorFor("> [!NOTE]- Title\n> Body\n\nBelow\n");
		caret(editor, "Title", 2);
		expect(key(editor, "ArrowDown")).toBe(true);
		expect(at(editor)).toEqual({ type: "paragraph", text: "Below", offset: 0 });
	});

	test("Up from below a folded callout lands on its title", () => {
		const editor = editorFor("> [!NOTE]- Title\n> Body\n\nBelow\n");
		caret(editor, "Below", 0);
		expect(key(editor, "ArrowUp")).toBe(true);
		expect(at(editor)).toEqual({
			type: "calloutTitle",
			text: "Title",
			offset: 5,
		});
	});

	test("Up from below an open callout is the browser's", () => {
		const editor = editorFor("> [!NOTE]+ Title\n> Body\n\nBelow\n");
		caret(editor, "Below", 0);
		expect(key(editor, "ArrowUp")).toBeFalsy();
	});
});

describe("Tab in the body", () => {
	test("outside a list is swallowed and changes nothing", () => {
		const editor = editorFor("> [!NOTE] T\n> Body\n");
		caret(editor, "Body", 2);
		expect(key(editor, "Tab")).toBe(true);
		expect(md(editor)).toBe("> [!NOTE] T\n> Body\n");
		expect(at(editor)).toEqual({ type: "paragraph", text: "Body", offset: 2 });
	});

	test("indents a list item", () => {
		const editor = editorFor("> [!NOTE] T\n>\n> - one\n> - two\n");
		caret(editor, "two", 0);
		expect(key(editor, "Tab")).toBe(true);
		expect(md(editor)).toBe("> [!NOTE] T\n>\n> - one\n>   - two\n");
	});

	test("does not indent the list item a callout sits in", () => {
		const markdown = "- a\n- b\n\n  > [!TIP]\n  > Body\n";
		const editor = editorFor(markdown);
		caret(editor, "Body", 0);
		expect(key(editor, "Tab")).toBe(true);
		expect(key(editor, "Tab", { shiftKey: true })).toBe(true);
		expect(md(editor)).toBe(markdown);
	});
});

describe("undo", () => {
	test("after Enter in the title", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", "end");
		key(editor, "Enter");
		editor.commands.undo();
		expect(md(editor)).toBe("> [!NOTE] Title\n> Body\n");
		expect(at(editor)).toEqual({
			type: "calloutTitle",
			text: "Title",
			offset: 5,
		});
	});

	test("after Enter leaves the callout", () => {
		const editor = editorFor("> [!NOTE] T\n> Body\n");
		caret(editor, "Body", "end");
		key(editor, "Enter");
		key(editor, "Enter");
		editor.commands.undo();
		expect(editor.state.doc.childCount).toBe(1);
		expect(editor.state.doc.firstChild!.childCount).toBe(3);
		expect(at(editor)).toEqual({ type: "paragraph", text: "", offset: 0 });
	});

	test("after Up opens a line above", () => {
		const editor = editorFor("> [!NOTE] Title\n> Body\n");
		caret(editor, "Title", 0);
		key(editor, "ArrowUp");
		editor.commands.undo();
		expect(md(editor)).toBe("> [!NOTE] Title\n> Body\n");
		expect(at(editor).type).toBe("calloutTitle");
	});
});

describe("quotes are unchanged", () => {
	test("Enter on an empty last quoted line leaves the quote", () => {
		const editor = editorFor("> a\n");
		caret(editor, "a", "end");
		key(editor, "Enter");
		key(editor, "Enter");
		type(editor, "b");
		expect(md(editor)).toBe("> a\n\nb\n");
	});

	test("Backspace at the start of a quote's first line leaves the quote", () => {
		const editor = editorFor("x\n\n> a\n");
		caret(editor, "a", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("x\n\na\n");
	});
});
