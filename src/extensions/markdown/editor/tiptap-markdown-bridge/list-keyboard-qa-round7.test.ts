// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";

const editors: Editor[] = [];
const paragraph = (...content: JSONContent[]): JSONContent => ({
	type: "paragraph",
	...(content.length ? { content } : {}),
});
const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({
	type: "text",
	text: value,
	...(marks ? { marks } : {}),
});
const item = (
	content: JSONContent[],
	checked: boolean | null = null,
): JSONContent => ({ type: "listItem", attrs: { checked }, content });
const list = (
	content: JSONContent[],
	type: "bulletList" | "orderedList" = "bulletList",
	start?: number,
): JSONContent => ({
	type,
	...(start !== undefined ? { attrs: { start } } : {}),
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
function placeCaret(editor: Editor, matcher: string, offset: "start" | "end") {
	let target: number | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (target !== null || !node.isTextblock) return;
		if (node.textContent === matcher) {
			target = offset === "start" ? pos + 1 : pos + 1 + node.content.size;
		}
	});
	if (target === null) throw new Error(`no textblock "${matcher}"`);
	editor.view.dispatch(
		editor.state.tr.setSelection(
			TextSelection.create(editor.state.doc, target),
		),
	);
}
const structure = (editor: Editor) => editor.getJSON() as JSONContent;
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("list keyboard QA round 7", () => {
	test("Backspace at the start of an item's text lifts it out of the list", () => {
		const editor = editorFor([
			list([
				item([paragraph(text("first"))]),
				item([paragraph(text("second"))]),
			]),
		]);
		placeCaret(editor, "second", "start");
		expect(key(editor, "Backspace")).toBe(true);
		const doc = structure(editor);
		expect(doc.content?.map((node) => node.type)).toEqual([
			"bulletList",
			"paragraph",
		]);
		expect(doc.content?.[1]?.content?.[0]?.text).toBe("second");
		expect(editor.state.selection.$from.parent.textContent).toBe("second");
		expect(editor.state.selection.$from.parentOffset).toBe(0);
	});

	test("Backspace at the start of a nested item outdents it one level", () => {
		const editor = editorFor([
			list([
				item([
					paragraph(text("parent")),
					list([item([paragraph(text("child"))])]),
				]),
			]),
		]);
		placeCaret(editor, "child", "start");
		expect(key(editor, "Backspace")).toBe(true);
		const top = structure(editor).content?.[0];
		expect(
			top?.content?.map((node) => node.content?.[0]?.content?.[0]?.text),
		).toEqual(["parent", "child"]);
	});

	test("Enter at the start of a checked task opens an unchecked item above and keeps the check", () => {
		const editor = editorFor([list([item([paragraph(text("done"))], true)])]);
		placeCaret(editor, "done", "start");
		expect(key(editor, "Enter")).toBe(true);
		const items = structure(editor).content?.[0]?.content ?? [];
		expect(items.map((entry) => entry.attrs?.checked)).toEqual([false, true]);
		expect(items[1]?.content?.[0]?.content?.[0]?.text).toBe("done");
		expect(editor.state.selection.$from.parent.textContent).toBe("done");
	});

	test("Enter at the end of an item with children starts a new first child", () => {
		const editor = editorFor([
			list([
				item(
					[
						paragraph(text("parent")),
						list([item([paragraph(text("child"))], false)]),
					],
					false,
				),
			]),
		]);
		placeCaret(editor, "parent", "end");
		expect(key(editor, "Enter")).toBe(true);
		const parent = structure(editor).content?.[0]?.content?.[0];
		expect(parent?.content?.[0]?.content?.[0]?.text).toBe("parent");
		const nested = parent?.content?.[1]?.content ?? [];
		expect(
			nested.map((entry) => entry.content?.[0]?.content?.[0]?.text),
		).toEqual([undefined, "child"]);
		expect(nested[0]?.attrs?.checked).toBe(false);
		expect(editor.state.selection.$from.parent.content.size).toBe(0);
	});

	test("Enter after inline code starts the new item without the code mark", () => {
		const editor = editorFor([
			list([item([paragraph(text("run "), text("cmd", [{ type: "code" }]))])]),
		]);
		placeCaret(editor, "run cmd", "end");
		expect(key(editor, "Enter")).toBe(true);
		editor.commands.insertContent("new");
		const items = structure(editor).content?.[0]?.content ?? [];
		expect(items[1]?.content?.[0]?.content?.[0]).toEqual({
			type: "text",
			text: "new",
		});
	});

	test("lifting an empty numbered item closes the numbering gap", () => {
		const editor = editorFor([
			list(
				[
					item([paragraph(text("one"))]),
					item([paragraph()]),
					item([paragraph(text("three"))]),
				],
				"orderedList",
				1,
			),
		]);
		placeCaret(editor, "", "start");
		expect(key(editor, "Enter")).toBe(true);
		const doc = structure(editor).content ?? [];
		expect(doc.map((node) => node.type)).toEqual([
			"orderedList",
			"paragraph",
			"orderedList",
		]);
		expect(doc[2]?.attrs?.start).toBe(2);
	});

	test("Delete at the end of an item joins the next item's text", () => {
		const editor = editorFor([
			list([
				item([paragraph(text("first"))]),
				item([paragraph(text("second"))]),
			]),
		]);
		placeCaret(editor, "first", "end");
		expect(key(editor, "Delete")).toBe(true);
		const items = structure(editor).content?.[0]?.content ?? [];
		expect(items).toHaveLength(1);
		expect(items[0]?.content?.[0]?.content?.[0]?.text).toBe("firstsecond");
	});

	test("Mod-Enter toggles the task under the caret", () => {
		const editor = editorFor([list([item([paragraph(text("todo"))], false)])]);
		placeCaret(editor, "todo", "end");
		// jsdom is not a Mac, so Mod resolves to Ctrl here.
		expect(key(editor, "Enter", { ctrlKey: true })).toBe(true);
		expect(structure(editor).content?.[0]?.content?.[0]?.attrs?.checked).toBe(
			true,
		);
	});
});
