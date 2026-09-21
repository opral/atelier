// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
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

describe("input rules", () => {
	test("--- only converts a line that is nothing but dashes", () => {
		const editor = editorFor("following\n");
		caret(editor, "following", 0);
		type(editor, "---");
		expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
		expect(editor.state.doc.textContent).toBe("---following");
	});

	test("emphasis delimiters must hug the text", () => {
		const editor = editorFor("");
		type(editor, "1 * 2 * 3");
		expect(editor.state.doc.textContent).toBe("1 * 2 * 3");
		expect(editor.isActive("italic")).toBe(false);
		type(editor, " and *real*");
		expect(md(editor)).toBe("1 \\* 2 \\* 3 and *real*\n");
	});

	test("__bold__ and + bullets are input rules", () => {
		const editor = editorFor("");
		type(editor, "__bold__");
		expect(md(editor)).toBe("**bold**\n");
		const list = editorFor("");
		type(list, "+ item");
		expect(md(list)).toBe("- item\n");
	});

	test("a URL followed by a space becomes a link and the space stays plain", () => {
		const editor = editorFor("");
		type(editor, "see https://example.com/path next");
		expect(md(editor)).toBe("see <https://example.com/path> next\n");
	});

	test("undo after an input rule keeps the typed trigger", () => {
		const editor = editorFor("");
		type(editor, "# ");
		expect(editor.state.doc.firstChild?.type.name).toBe("heading");
		editor.commands.undo();
		expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
		expect(editor.state.doc.textContent).toBe("#");
	});
});

describe("Backspace across block boundaries", () => {
	test("a heading becomes text before it merges", () => {
		const editor = editorFor("Intro\n\n## Heading\n");
		caret(editor, "Heading", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("Intro\n\nHeading\n");
	});

	test("text after a list folds onto the last item", () => {
		const editor = editorFor("- a\n- b\n\npara\n");
		caret(editor, "para", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("- a\n- bpara\n");
	});

	test("an empty paragraph after a list goes and the caret ends on the last item", () => {
		const editor = editorFor("- a\n- b\n");
		caret(editor, "b", "end");
		key(editor, "Enter");
		key(editor, "Enter");
		expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("- a\n- b\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("b");
		expect(editor.state.selection.$from.parentOffset).toBe(1);
	});

	// The user asked for Notion's behaviour: Backspace below a table goes
	// into its last cell, never selects the table, and never deletes it.
	test("a table above is entered at its last cell, not merged into or selected", () => {
		const editor = editorFor("| a | b |\n| - | - |\n| c | d |\n\nafter\n");
		caret(editor, "after", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(editor.state.selection).toBeInstanceOf(TextSelection);
		expect(editor.state.selection.$from.parent.textContent).toBe("d");
		expect(editor.state.selection.$from.parentOffset).toBe(1);
		expect(md(editor)).toBe("| a | b |\n| - | - |\n| c | d |\n\nafter\n");
	});

	test("an empty line below a table goes and the caret ends in the last cell", () => {
		const editor = editorFor("| a | b |\n| - | - |\n| c | d |\n\n## Next\n");
		const tableEnd = editor.state.doc.child(0).nodeSize;
		editor
			.chain()
			.insertContentAt(tableEnd, { type: "paragraph" })
			.setTextSelection(tableEnd + 1)
			.run();
		expect(key(editor, "Backspace")).toBe(true);
		expect(editor.state.selection).toBeInstanceOf(TextSelection);
		expect(editor.state.selection.$from.parent.textContent).toBe("d");
		expect(editor.state.selection.$from.parentOffset).toBe(1);
		expect(editor.state.doc.childCount).toBe(2);
	});

	test("a blank line of spaces below a table goes as an empty one does", () => {
		const editor = editorFor("| a |\n| - |\n| c |\n\nafter\n");
		const tableEnd = editor.state.doc.child(0).nodeSize;
		editor
			.chain()
			.insertContentAt(tableEnd, {
				type: "paragraph",
				content: [{ type: "text", text: "  " }],
			})
			.setTextSelection(tableEnd + 1)
			.run();
		expect(key(editor, "Backspace")).toBe(true);
		expect(editor.state.selection.$from.parent.textContent).toBe("c");
		expect(md(editor)).toBe("| a |\n| - |\n| c |\n\nafter\n");
	});

	test("two Backspaces from below never delete a table", () => {
		const editor = editorFor("| a |\n| - |\n|  |\n\n## after\n");
		caret(editor, "after", 0);
		for (let press = 0; press < 4; press++) key(editor, "Backspace");
		expect(editor.state.doc.firstChild?.type.name).toBe("table");
	});

	test("Delete above a table enters its first cell instead of selecting it", () => {
		const editor = editorFor("before\n\n| a | b |\n| - | - |\n| c | d |\n");
		caret(editor, "before", "end");
		expect(key(editor, "Delete")).toBe(true);
		expect(editor.state.selection).toBeInstanceOf(TextSelection);
		expect(editor.state.selection.$from.parent.textContent).toBe("a");
		expect(editor.state.selection.$from.parentOffset).toBe(0);
	});

	test("a rule above is selected first", () => {
		const editor = editorFor("before\n\n***\n\nafter\n");
		caret(editor, "after", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect((editor.state.selection as NodeSelection).node?.type.name).toBe(
			"horizontalRule",
		);
	});

	test("prose never joins a code block; the caret moves into it", () => {
		const editor = editorFor("```\ncode\n```\n\nafter\n");
		caret(editor, "after", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("```\ncode\n```\n\nafter\n");
		expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
	});

	test("the first line of a second quote leaves the quote instead of merging quotes", () => {
		const editor = editorFor("> first\n\n> second\n");
		caret(editor, "second", 0);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("> first\n\nsecond\n");
	});

	test("removing an empty item settles the caret at the end of the item above", () => {
		const editor = editorFor("- a\n- \n- c\n");
		const empty = editor.state.doc.firstChild!.child(1);
		expect(empty.textContent).toBe("");
		let pos = -1;
		editor.state.doc.descendants((node, p) => {
			if (pos < 0 && node.isTextblock && node.content.size === 0) pos = p + 1;
		});
		editor.view.dispatch(
			editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
		);
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("- a\n- c\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("a");
		expect(editor.state.selection.$from.parentOffset).toBe(1);
	});

	test("a selection that reaches a nested child's start deletes only the line", () => {
		const editor = editorFor("- [ ] parent line\n  - [ ] child stays\n");
		let from = -1;
		let to = -1;
		editor.state.doc.descendants((node, pos) => {
			if (node.isTextblock && node.textContent === "parent line")
				from = pos + 1;
			if (node.isTextblock && node.textContent === "child stays") to = pos + 1;
		});
		editor.view.dispatch(
			editor.state.tr.setSelection(
				TextSelection.create(editor.state.doc, from, to),
			),
		);
		expect(key(editor, "Backspace")).toBe(true);
		// The emptied line keeps the repo's empty-paragraph placeholder.
		expect(md(editor)).toBe("- [ ] <span></span>\n  - [ ] child stays\n");
	});
});

describe("Delete across block boundaries", () => {
	test("at the end of the last item joins the paragraph after the list", () => {
		const editor = editorFor("- a\n- b\n\npara\n");
		caret(editor, "b", "end");
		expect(key(editor, "Delete")).toBe(true);
		expect(md(editor)).toBe("- a\n- bpara\n");
	});

	test("at the end of an item with children joins the first child's text", () => {
		const editor = editorFor("- a\n  - child\n- b\n");
		caret(editor, "a", "end");
		expect(key(editor, "Delete")).toBe(true);
		expect(md(editor)).toBe("- achild\n- b\n");
	});

	test("before a list joins the first item's text", () => {
		const editor = editorFor("para\n\n- a\n- b\n");
		caret(editor, "para", "end");
		expect(key(editor, "Delete")).toBe(true);
		expect(md(editor)).toBe("paraa\n\n- b\n");
	});

	test("before a rule or image selects it instead of deleting it", () => {
		const editor = editorFor("para\n\n***\n");
		caret(editor, "para", "end");
		expect(key(editor, "Delete")).toBe(true);
		expect((editor.state.selection as NodeSelection).node?.type.name).toBe(
			"horizontalRule",
		);
	});

	test("before a code block does nothing", () => {
		const editor = editorFor("para\n\n```\ncode\n```\n");
		caret(editor, "para", "end");
		expect(key(editor, "Delete")).toBe(true);
		expect(md(editor)).toBe("para\n\n```\ncode\n```\n");
	});
});

describe("Enter", () => {
	test("at the start of a heading opens a line above and keeps the heading", () => {
		const editor = editorFor("# Obsidian Version Control\n\nbody\n");
		caret(editor, "Obsidian Version Control", 0);
		expect(key(editor, "Enter")).toBe(true);
		expect(md(editor)).toBe(
			"<span></span>\n\n# Obsidian Version Control\n\nbody\n",
		);
		const $caret = editor.state.selection.$from;
		expect($caret.parent.type.name).toBe("heading");
		expect($caret.parentOffset).toBe(0);
		type(editor, "x");
		expect(md(editor)).toBe(
			"<span></span>\n\n# xObsidian Version Control\n\nbody\n",
		);
	});

	test("at the start of a heading inside a quote keeps the heading", () => {
		const editor = editorFor("> # Quoted\n");
		caret(editor, "Quoted", 0);
		expect(key(editor, "Enter")).toBe(true);
		expect(md(editor)).toBe("> <span></span>\n>\n> # Quoted\n");
	});

	test("then Backspace takes the empty line back and keeps the heading", () => {
		const editor = editorFor("# Title\n");
		caret(editor, "Title", 0);
		key(editor, "Enter");
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("# Title\n");
		// With nothing empty above, Backspace turns the heading into text.
		expect(key(editor, "Backspace")).toBe(true);
		expect(md(editor)).toBe("Title\n");
	});

	test("over a heading's whole text does not throw", () => {
		const editor = editorFor("# Title\n\nbody\n");
		const $start = editor.state.doc.resolve(1);
		editor.view.dispatch(
			editor.state.tr.setSelection(
				TextSelection.create(editor.state.doc, $start.start(), $start.end()),
			),
		);
		expect(key(editor, "Enter")).toBe(true);
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
		expect(editor.state.doc.childCount).toBe(3);
	});

	test("over the start of a heading keeps the rest a heading", () => {
		const editor = editorFor("# Title\n");
		editor.view.dispatch(
			editor.state.tr.setSelection(
				TextSelection.create(editor.state.doc, 1, 3),
			),
		);
		expect(key(editor, "Enter")).toBe(true);
		expect(md(editor)).toBe("<span></span>\n\n# tle\n");
	});

	test("splitting a heading leaves the second half as text", () => {
		const editor = editorFor("# Hello world\n");
		caret(editor, "Hello world", 5);
		expect(key(editor, "Enter")).toBe(true);
		expect(md(editor)).toBe("# Hello\n\nworld\n");
	});

	test("on a selected frontmatter block inserts the paragraph below it", () => {
		const editor = editorFor("---\ntitle: x\n---\n\nbody\n");
		editor.view.dispatch(
			editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
		);
		expect(key(editor, "Enter")).toBe(true);
		expect(editor.state.doc.firstChild?.type.name).toBe("markdownFrontmatter");
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
		expect(editor.state.doc.child(1).content.size).toBe(0);
	});

	test("next to a hard break drops the break instead of stranding it", () => {
		const editor = editorFor("- Sales:\\\n  find leads\n- b\n");
		caret(editor, "Sales:find leads", 6);
		expect(key(editor, "Enter")).toBe(true);
		expect(md(editor)).toBe("- Sales:\n- find leads\n- b\n");
	});

	test("after inline code the new paragraph is plain", () => {
		const editor = editorFor("Hello `code`\n");
		caret(editor, "Hello code", "end");
		key(editor, "Enter");
		type(editor, "x");
		expect(md(editor)).toBe("Hello `code`\n\nx\n");
	});
});

describe("outdent numbering", () => {
	test("siblings that become children of the outdented item count from 1", () => {
		const editor = editorFor("1. a\n   1. b\n   2. c\n   3. d\n2. e\n");
		caret(editor, "c", 0);
		expect(key(editor, "Tab", { shiftKey: true })).toBe(true);
		expect(md(editor)).toBe("1. a\n   1. b\n2. c\n   1. d\n3. e\n");
	});
});

describe("Delete", () => {
	test("on an empty line above a heading removes the line, not the level", () => {
		const editor = editorFor("<span></span>\n\n# Title\n");
		caret(editor, "", 0);
		expect(key(editor, "Delete")).toBe(true);
		expect(md(editor)).toBe("# Title\n");
		expect(editor.state.selection.$from.parent.type.name).toBe("heading");
	});
});

describe("serialization", () => {
	test("an empty line inside a quote survives a reload", () => {
		const editor = editorFor("> quote\n");
		caret(editor, "quote", "end");
		key(editor, "Enter");
		const out = md(editor);
		expect(out).toBe("> quote\n>\n> <span></span>\n");
		expect(md(editorFor(out))).toBe(out);
	});

	test("a line break in an h3 heading survives a reload", () => {
		const editor = editorFor("### Title\n");
		caret(editor, "Title", 2);
		key(editor, "Enter", { shiftKey: true });
		const out = md(editor);
		expect(out).toBe("### Ti<br>tle\n");
		expect(md(editorFor(out))).toBe(out);
	});
});
