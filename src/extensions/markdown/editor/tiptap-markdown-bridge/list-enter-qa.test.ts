// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { closeHistory } from "@tiptap/pm/history";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";
import { parseMarkdown } from "../markdown";
import { astToTiptapDoc } from "./mdwc-to-tiptap";

const editors: Editor[] = [];
const paragraph = (text = ""): JSONContent => ({
	type: "paragraph",
	...(text ? { content: [{ type: "text", text }] } : {}),
});
const item = (
	content: JSONContent[],
	checked: boolean | null = null,
): JSONContent => ({
	type: "listItem",
	attrs: { checked },
	content,
});
const list = (content: JSONContent[], type = "bulletList"): JSONContent => ({
	type,
	...(type === "orderedList" ? { attrs: { start: 4 } } : {}),
	content,
});
function editorFor(content: JSONContent[], history = false) {
	const editor = new Editor({
		extensions: [...MarkdownWc(), ...(history ? [History] : [])],
		content: { type: "doc", content },
	});
	editors.push(editor);
	return editor;
}
function paragraphPositions(editor: Editor) {
	const positions: number[] = [];
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "paragraph") positions.push(pos + 1);
	});
	return positions;
}
function enter(editor: Editor) {
	const event = new KeyboardEvent("keydown", {
		key: "Enter",
		bubbles: true,
		cancelable: true,
	});
	return editor.view.someProp("handleKeyDown", (handler) =>
		handler(editor.view, event),
	);
}
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("Enter list regression QA", () => {
	test("list items are valid only inside list containers", () => {
		const editor = editorFor([paragraph()]);
		const bareItem = editor.schema.nodes.listItem.create(
			null,
			editor.schema.nodes.paragraph.create(),
		);
		const malformedDoc = editor.schema.nodes.doc.create(null, bareItem);
		expect(malformedDoc.type.validContent(malformedDoc.content)).toBe(false);
		const malformedParent = editor.schema.nodes.listItem.create(null, [
			editor.schema.nodes.paragraph.create(),
			bareItem,
		]);
		expect(malformedParent.type.validContent(malformedParent.content)).toBe(
			false,
		);
		for (const type of ["bulletList", "orderedList"]) {
			const validList = editor.schema.nodes[type].create(null, bareItem);
			expect(validList.type.validContent(validList.content)).toBe(true);
		}
	});

	test("nested empty Enter preserves parent identities through undo, redo, and reload", () => {
		const content = [
			list([
				item([
					paragraph("parent"),
					list([item([paragraph("child")]), item([paragraph()])]),
				]),
			]),
		];
		const editor = editorFor(content, true);
		editor.commands.setContent({ type: "doc", content });
		editor.view.dispatch(closeHistory(editor.state.tr));
		editor.commands.setTextSelection(paragraphPositions(editor)[2]);
		const before = editor.getJSON();
		const originalParent = editor.state.doc.firstChild!.firstChild!;
		const parentId = originalParent.attrs.data.id;
		const originalParagraph = originalParent.firstChild!.toJSON();
		const originalChild = originalParent.child(1).firstChild!.toJSON();
		expect(enter(editor)).toBe(true);
		const after = editor.getJSON();
		const parent = editor.state.doc.firstChild!.firstChild!;
		expect(parent.attrs.data.id).toBe(parentId);
		expect(parent.firstChild!.toJSON()).toEqual(originalParagraph);
		expect(parent.child(1).firstChild!.toJSON()).toEqual(originalChild);
		expect(editor.commands.undo()).toBe(true);
		expect(editor.getJSON()).toEqual(before);
		expect(editor.commands.redo()).toBe(true);
		expect(editor.getJSON()).toEqual(after);
		const markdown = buildMarkdownFromEditor(editor);
		const reloaded = editorFor(
			astToTiptapDoc(parseMarkdown(markdown)).content!,
		);
		expect(buildMarkdownFromEditor(reloaded)).toBe(markdown);
	});

	test.each(["bulletList", "orderedList"])(
		"empty final %s item exits without lifting its populated sibling",
		(type) => {
			const editor = editorFor([
				list(
					[
						item([paragraph("parent"), list([item([paragraph("child")])])]),
						item([paragraph()]),
					],
					type,
				),
			]);
			const original = editor.state.doc.firstChild!.firstChild!.toString();
			editor.commands.setTextSelection(paragraphPositions(editor)[2]);
			expect(enter(editor)).toBe(true);
			expect(editor.state.doc.childCount).toBe(2);
			expect(editor.state.doc.child(0).type.name).toBe(type);
			expect(editor.state.doc.child(0).firstChild!.toString()).toEqual(
				original,
			);
			expect(editor.state.doc.child(0).childCount).toBe(1);
			expect(editor.state.doc.child(1).type.name).toBe("paragraph");
			expect(editor.state.selection.$from.depth).toBe(1);
		},
	);

	test.each([null, false, true])(
		"nested empty item outdents one level and preserves task state %s",
		(checked) => {
			const editor = editorFor([
				list([
					item([
						paragraph("parent"),
						list([item([paragraph("child")]), item([paragraph()], checked)]),
					]),
				]),
			]);
			editor.commands.setTextSelection(paragraphPositions(editor)[2]);
			expect(enter(editor)).toBe(true);
			const outer = editor.state.doc.firstChild!;
			expect(outer.type.name).toBe("bulletList");
			expect(outer.childCount).toBe(2);
			expect(outer.child(0).child(0).textContent).toBe("parent");
			expect(outer.child(0).child(1).childCount).toBe(1);
			expect(outer.child(1).attrs.checked).toBe(checked);
			expect(editor.state.selection.$from.depth).toBe(3);
		},
	);

	test("repeated Enter after a nested list exits only the empty item", () => {
		const editor = editorFor([
			list([item([paragraph("parent"), list([item([paragraph("child")])])])]),
		]);
		editor.commands.setTextSelection(paragraphPositions(editor)[1] + 5);
		expect(enter(editor)).toBe(true);
		expect(enter(editor)).toBe(true);
		editor.state.doc.descendants((node, _pos, parent) => {
			if (node.type.name === "listItem") {
				expect(["bulletList", "orderedList"]).toContain(parent!.type.name);
			}
		});
		expect(enter(editor)).toBe(true);
		expect(editor.state.doc.childCount).toBe(2);
		const retainedList = editor.state.doc.child(0);
		expect(retainedList.type.name).toBe("bulletList");
		expect(retainedList.childCount).toBe(1);
		expect(retainedList.child(0).child(0).textContent).toBe("parent");
		expect(retainedList.child(0).child(1).type.name).toBe("bulletList");
		expect(retainedList.child(0).child(1).textContent).toBe("child");
		const markdown = buildMarkdownFromEditor(editor);
		expect(markdown).toContain("- parent\n  - child");
		const reloaded = editorFor(
			astToTiptapDoc(parseMarkdown(markdown)).content!,
		);
		expect(buildMarkdownFromEditor(reloaded)).toBe(markdown);
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
		expect(editor.state.selection.$from.depth).toBe(1);
	});

	test.each(["bulletList", "orderedList"])(
		"empty middle %s item leaves surrounding items in separate lists",
		(type) => {
			const editor = editorFor([
				list(
					[
						item([paragraph("before")]),
						item([paragraph()]),
						item([paragraph("after")]),
					],
					type,
				),
			]);
			editor.commands.setTextSelection(paragraphPositions(editor)[1]);
			expect(enter(editor)).toBe(true);
			expect(editor.state.doc.childCount).toBe(3);
			expect(editor.state.doc.child(0).textContent).toBe("before");
			expect(editor.state.doc.child(1).type.name).toBe("paragraph");
			expect(editor.state.doc.child(2).type.name).toBe(type);
			expect(editor.state.doc.child(2).textContent).toBe("after");
			// The empty item carried nothing, so the items after it close the gap.
			if (type === "orderedList")
				expect(editor.state.doc.child(2).attrs.start).toBe(5);
		},
	);

	test("hard-break-only list paragraph remains a list when split", () => {
		const editor = editorFor([
			list([item([{ type: "paragraph", content: [{ type: "hardBreak" }] }])]),
		]);
		editor.commands.setTextSelection(paragraphPositions(editor)[0] + 1);
		expect(enter(editor)).toBe(true);
		expect(editor.state.doc.firstChild!.type.name).toBe("bulletList");
		expect(editor.state.doc.firstChild!.childCount).toBe(2);
		expect(
			editor.state.doc.firstChild!.firstChild!.firstChild!.firstChild!.type
				.name,
		).toBe("hardBreak");
	});

	test("range starting in an empty item deletes selected text before splitting", () => {
		const editor = editorFor([
			list([item([paragraph()]), item([paragraph("remove keep")])]),
		]);
		const [empty, text] = paragraphPositions(editor);
		editor.commands.setTextSelection({ from: empty, to: text + 7 });
		expect(enter(editor)).toBe(true);
		expect(editor.state.doc.textContent).toBe("keep");
		expect(editor.state.doc.firstChild!.type.name).toBe("bulletList");
		expect(editor.state.selection.empty).toBe(true);
	});

	test("splitting a checked task preserves original checkbox and creates unchecked task", () => {
		const editor = editorFor([list([item([paragraph("beforeafter")], true)])]);
		editor.commands.setTextSelection(paragraphPositions(editor)[0] + 6);
		expect(enter(editor)).toBe(true);
		const outer = editor.state.doc.firstChild!;
		expect(outer.childCount).toBe(2);
		expect(outer.child(0).attrs.checked).toBe(true);
		expect(outer.child(0).textContent).toBe("before");
		expect(outer.child(1).attrs.checked).toBe(false);
		expect(outer.child(1).textContent).toBe("after");
	});
});
