// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { MarkdownWc } from "../tiptap-markdown-bridge";

const editors: Editor[] = [];

function createEditor(content: any): Editor {
	const editor = new Editor({ extensions: MarkdownWc(), content });
	editors.push(editor);
	return editor;
}

function sendKey(editor: Editor, key: string): boolean {
	const event = new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
	});
	let handled = false;
	editor.view.someProp("handleKeyDown", (handler: any) => {
		handled = handler(editor.view, event) || handled;
		return handled;
	});
	return handled;
}

afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("atomic block boundary navigation", () => {
	test("ArrowRight enters a divider and then leaves it for following text", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "before" }] },
				{ type: "horizontalRule" },
				{ type: "paragraph", content: [{ type: "text", text: "after" }] },
			],
		});
		editor.commands.setTextSelection(7);

		expect(sendKey(editor, "ArrowRight")).toBe(true);
		expect(editor.state.selection).toBeInstanceOf(NodeSelection);
		expect((editor.state.selection as NodeSelection).node.type.name).toBe(
			"horizontalRule",
		);

		expect(sendKey(editor, "ArrowRight")).toBe(true);
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.textContent).toBe("after");
	});

	test("ArrowLeft enters a preceding read-only HTML block", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "markdownUnsupported",
					attrs: { kind: "html", value: "<details>" },
				},
				{ type: "paragraph", content: [{ type: "text", text: "after" }] },
			],
		});
		editor.commands.setTextSelection(2);

		expect(sendKey(editor, "ArrowLeft")).toBe(true);
		expect(editor.state.selection).toBeInstanceOf(NodeSelection);
		expect((editor.state.selection as NodeSelection).node.type.name).toBe(
			"markdownUnsupported",
		);
	});

	test("ArrowDown after a terminal divider creates one editable paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [{ type: "horizontalRule" }],
		});
		editor.commands.setNodeSelection(0);

		expect(sendKey(editor, "ArrowDown")).toBe(true);
		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
	});

	test("ArrowUp before an initial read-only block creates an editable paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "markdownUnsupported",
					attrs: { kind: "html", value: "<details>" },
				},
			],
		});
		editor.commands.setNodeSelection(0);

		expect(sendKey(editor, "ArrowUp")).toBe(true);
		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.child(0).type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
	});

	test("ArrowUp from frontmatter keeps frontmatter at the document start", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "markdownFrontmatter",
					attrs: { value: "title: Demo" },
				},
				{ type: "paragraph", content: [{ type: "text", text: "after" }] },
			],
		});
		editor.commands.setNodeSelection(0);
		const selectionBefore = editor.state.selection;

		expect(sendKey(editor, "ArrowUp")).toBe(true);
		expect(editor.state.doc.firstChild?.type.name).toBe("markdownFrontmatter");
		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.selection.eq(selectionBefore)).toBe(true);
	});

	test("ArrowDown after a terminal standalone image creates a paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [
						{
							type: "image",
							attrs: { src: "asset.png", alt: "Asset", title: null },
						},
					],
				},
			],
		});
		editor.commands.setTextSelection(2);

		expect(sendKey(editor, "ArrowDown")).toBe(true);
		expect(editor.state.doc.childCount).toBe(2);
		expect(editor.state.doc.child(1).type.name).toBe("paragraph");
		expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
	});

	test("ArrowRight at the end of ordinary text does not create a paragraph", () => {
		const editor = createEditor({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "ordinary" }] },
			],
		});
		editor.commands.setTextSelection(9);

		expect(sendKey(editor, "ArrowRight")).toBe(false);
		expect(editor.state.doc.childCount).toBe(1);
		expect(editor.state.doc.textContent).toBe("ordinary");
	});

	test("ArrowRight after a hard break does not treat it as an atomic block", () => {
		const editor = createEditor({
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "hardBreak" }] }],
		});
		editor.commands.setTextSelection(2);

		expect(sendKey(editor, "ArrowRight")).toBe(false);
		expect(editor.state.doc.childCount).toBe(1);
	});
});
