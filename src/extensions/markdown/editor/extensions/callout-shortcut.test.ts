// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "../tiptap-markdown-bridge/markdown-wc";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";
import { parseMarkdown } from "../markdown";
import { astToTiptapDoc } from "../tiptap-markdown-bridge/mdwc-to-tiptap";
import {
	calloutKindAutocompleteKey,
	calloutKindOptions,
} from "./callout-shortcut";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

function editorFor(markdown: string) {
	const editor = new Editor({
		extensions: [...(MarkdownWc() as any[]), History],
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

function caretAt(editor: Editor, text: string, offset = 0) {
	let target: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (target === null && node.isTextblock && node.textContent === text)
			target = pos + 1 + offset;
	});
	if (target === null) throw new Error(`no textblock "${text}"`);
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, target),
		),
	);
}

const md = (editor: Editor) => buildMarkdownFromEditor(editor).trim();
const autocomplete = (editor: Editor) =>
	calloutKindAutocompleteKey.getState(editor.state)!;
const where = (editor: Editor) => {
	const { $head } = editor.state.selection;
	return {
		block: $head.parent.type.name,
		in: $head.node($head.depth - 1).type.name,
		text: $head.parent.textContent,
		offset: $head.parentOffset,
	};
};

describe("a typed marker", () => {
	test("`> [!note] ` on an empty line makes a callout, the caret in its body", () => {
		const editor = editorFor("");
		type(editor, "> [!note] ");
		const callout = editor.state.doc.firstChild!;
		expect(callout.type.name).toBe("callout");
		expect(callout.attrs).toMatchObject({
			kind: "note",
			marker: "note",
			fold: null,
		});
		expect(callout.firstChild!.content.size).toBe(0);
		expect(md(editor)).toBe("> [!note]");
		expect(where(editor)).toEqual({
			block: "paragraph",
			in: "callout",
			text: "",
			offset: 0,
		});
		type(editor, "Body");
		expect(md(editor)).toBe("> [!note]\n> Body");
	});

	test("any case and a fold sign, before the line's text", () => {
		const editor = editorFor("> Existing line\n>\n> More\n");
		caretAt(editor, "Existing line");
		type(editor, "[!WARNING]- ");
		expect(md(editor)).toBe("> [!WARNING]-\n> Existing line\n>\n> More");
		expect(where(editor)).toEqual({
			block: "paragraph",
			in: "callout",
			text: "Existing line",
			offset: 0,
		});
	});

	test("only at the start of a quote's first line", () => {
		const outside = editorFor("");
		type(outside, "[!note] ");
		expect(outside.state.doc.firstChild!.type.name).toBe("paragraph");

		const second = editorFor("> First\n>\n> x\n");
		caretAt(second, "x");
		type(second, "[!note] ");
		expect(second.state.doc.firstChild!.type.name).toBe("blockquote");
	});

	test("Backspace right after gives the typed text back", () => {
		const editor = editorFor("");
		type(editor, "> [!tip] ");
		expect(editor.state.doc.firstChild!.type.name).toBe("callout");
		key(editor, "Backspace");
		expect(editor.state.doc.toString()).toBe(
			'doc(blockquote(paragraph("[!tip] ")))',
		);
		expect(where(editor)).toMatchObject({ in: "blockquote", offset: 7 });
	});

	test("undo takes the conversion back, and only it", () => {
		const editor = editorFor("");
		type(editor, "> [!tip] ");
		editor.commands.undo();
		expect(editor.state.doc.toString()).toBe(
			'doc(blockquote(paragraph("[!tip]")))',
		);
	});
});

describe("the kind autocomplete", () => {
	test("filters by the letters after [!", () => {
		expect(calloutKindOptions("")).toEqual([
			"note",
			"tip",
			"important",
			"warning",
			"caution",
		]);
		expect(calloutKindOptions("W")).toEqual(["warning"]);
		expect(calloutKindOptions("x")).toEqual([]);
	});

	test("opens on [! at the start of a quote, and Enter picks", () => {
		const editor = editorFor("");
		type(editor, "> [!");
		expect(autocomplete(editor)).toMatchObject({
			active: true,
			query: "",
			options: ["note", "tip", "important", "warning", "caution"],
			index: 0,
		});
		type(editor, "w");
		expect(autocomplete(editor)).toMatchObject({
			active: true,
			options: ["warning"],
		});
		expect(key(editor, "Enter")).toBe(true);
		expect(md(editor)).toBe("> [!WARNING]");
		expect(autocomplete(editor).active).toBe(false);
		expect(where(editor)).toEqual({
			block: "paragraph",
			in: "callout",
			text: "",
			offset: 0,
		});
	});

	test("arrows move, Tab picks", () => {
		const editor = editorFor("");
		type(editor, "> [!");
		key(editor, "ArrowDown");
		key(editor, "ArrowDown");
		expect(autocomplete(editor).index).toBe(2);
		key(editor, "ArrowUp");
		expect(autocomplete(editor).index).toBe(1);
		key(editor, "ArrowUp");
		key(editor, "ArrowUp");
		expect(autocomplete(editor).index).toBe(4);
		expect(key(editor, "Tab")).toBe(true);
		expect(md(editor)).toBe("> [!CAUTION]");
	});

	test("the rest of the line becomes the body", () => {
		const editor = editorFor("> Keep this\n");
		caretAt(editor, "Keep this");
		type(editor, "[!i");
		key(editor, "Enter");
		expect(md(editor)).toBe("> [!IMPORTANT]\n> Keep this");
	});

	test("Escape dismisses it until the [! goes", () => {
		const editor = editorFor("");
		type(editor, "> [!");
		expect(key(editor, "Escape")).toBe(true);
		expect(autocomplete(editor).active).toBe(false);
		type(editor, "t");
		expect(autocomplete(editor).active).toBe(false);
		// Enter is the editor's again.
		expect(md(editor)).toBe("> \\[!t");
		// The browser deletes the text; the [! goes with it.
		const { from } = editor.state.selection;
		editor.view.dispatch(editor.state.tr.delete(from - 3, from));
		type(editor, "[!");
		expect(autocomplete(editor).active).toBe(true);
	});

	test("closes when nothing matches, and a hand-typed marker still converts", () => {
		const editor = editorFor("");
		type(editor, "> [!ex");
		expect(autocomplete(editor).active).toBe(false);
		type(editor, "ample] ");
		expect(md(editor)).toBe("> [!example]");
	});

	test("not in a plain paragraph", () => {
		const editor = editorFor("");
		type(editor, "[!");
		expect(autocomplete(editor).active).toBe(false);
	});

	test("a pick is one undo step, and Backspace gives the [! back", () => {
		const editor = editorFor("");
		type(editor, "> [!n");
		key(editor, "Enter");
		key(editor, "Backspace");
		expect(editor.state.doc.toString()).toBe(
			'doc(blockquote(paragraph("[!n")))',
		);
	});
});
