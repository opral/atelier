// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";

const editors: Editor[] = [];
const paragraph = (...content: JSONContent[]): JSONContent => ({
	type: "paragraph",
	...(content.length ? { content } : {}),
});
const text = (value: string): JSONContent => ({ type: "text", text: value });
const item = (content: JSONContent[]): JSONContent => ({
	type: "listItem",
	attrs: { checked: null },
	content,
});
function editorFor(content: JSONContent[]) {
	const editor = new Editor({
		extensions: MarkdownWc(),
		content: { type: "doc", content },
	});
	editors.push(editor);
	return editor;
}
function key(editor: Editor, key: string) {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
	});
	return editor.view.someProp("handleKeyDown", (handler) =>
		handler(editor.view, event),
	);
}
function caretAtStart(editor: Editor, matcher: string) {
	let target: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (target !== null || !node.isTextblock) return;
		if (node.textContent === matcher) target = pos + 1;
	});
	if (target === null) throw new Error(`no textblock "${matcher}"`);
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, target),
		),
	);
}
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("Backspace at a block start removes an empty block above", () => {
	test("an item folds into the empty item above it and takes its number", () => {
		const editor = editorFor([
			{
				type: "orderedList",
				content: [
					item([paragraph(text("Sales"))]),
					item([paragraph()]),
					item([paragraph(text("PLG"))]),
				],
			},
		]);
		caretAtStart(editor, "PLG");
		expect(key(editor, "Backspace")).toBe(true);
		expect(buildMarkdownFromEditor(editor)).toBe("1. Sales\n2. PLG\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("PLG");
		expect(editor.state.selection.$from.parentOffset).toBe(0);
	});

	test("a paragraph after a list drops the list's empty last item", () => {
		const editor = editorFor([
			{
				type: "orderedList",
				content: [item([paragraph(text("Sales"))]), item([paragraph()])],
			},
			paragraph(text("PLG")),
		]);
		caretAtStart(editor, "PLG");
		expect(key(editor, "Backspace")).toBe(true);
		expect(buildMarkdownFromEditor(editor)).toBe("1. Sales\n\nPLG\n");
		expect(editor.state.selection.$from.parent.textContent).toBe("PLG");
	});

	test("a paragraph after an empty paragraph removes the empty one", () => {
		const editor = editorFor([
			paragraph(text("above")),
			paragraph(),
			paragraph(text("below")),
		]);
		caretAtStart(editor, "below");
		expect(key(editor, "Backspace")).toBe(true);
		expect(buildMarkdownFromEditor(editor)).toBe("above\n\nbelow\n");
	});

	test("the first item of a list still lifts out when nothing is above it", () => {
		const editor = editorFor([
			{ type: "bulletList", content: [item([paragraph(text("only"))])] },
		]);
		caretAtStart(editor, "only");
		expect(key(editor, "Backspace")).toBe(true);
		expect(buildMarkdownFromEditor(editor)).toBe("only\n");
	});
});
