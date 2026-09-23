import { afterEach, describe, expect, test } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { MarkdownWc, astToTiptapDoc } from "../tiptap-markdown-bridge";
import { parseMarkdown } from "../markdown";
import { assignMissingDataIds } from "../tiptap-markdown-bridge/assign-data-id";
import {
	blockCommentPluginKey,
	blockNodeId,
	createBlockCommentPlugin,
	setBlockCommentMarks,
} from "./block-comment-decoration";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

function createEditor(markdown: string): Editor {
	const element = document.createElement("div");
	document.body.append(element);
	const editor = new Editor({
		element,
		extensions: MarkdownWc() as any,
		content: astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
		onBeforeCreate: ({ editor: created }) => {
			created.options.content = assignMissingDataIds(
				created.options.content as JSONContent,
				created.schema,
			);
		},
	});
	editor.registerPlugin(createBlockCommentPlugin());
	editors.push(editor);
	return editor;
}

describe("block comment marks", () => {
	test("wash a block's text and name its state on the block", () => {
		const editor = createEditor("First.\n\nSecond.\n");
		const id = blockNodeId(editor.state.doc.child(1))!;
		setBlockCommentMarks(editor, new Map([[id, "active"]]));
		const block = editor.view.dom.children[1] as HTMLElement;
		expect(block.getAttribute("data-block-comment")).toBe("active");
		expect(block.querySelector(".markdown-block-comment")).not.toBeNull();
	});

	test("wait for a press in the document to end, and never move the caret", async () => {
		const editor = createEditor("First.\n\nSecond.\n");
		editor.commands.setTextSelection(3);
		const id = blockNodeId(editor.state.doc.child(1))!;
		const input = (editor.view as unknown as { input: { mouseDown: unknown } })
			.input;
		// The browser has moved the caret for this press; ProseMirror has not
		// read it yet. A transaction now would put the old caret back.
		input.mouseDown = {};
		setBlockCommentMarks(editor, new Map([[id, "rest"]]));
		expect(blockCommentPluginKey.getState(editor.state)?.marks.size).toBe(0);

		input.mouseDown = null;
		window.dispatchEvent(new MouseEvent("mouseup"));
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(blockCommentPluginKey.getState(editor.state)?.marks.get(id)).toBe(
			"rest",
		);
		expect(editor.state.selection.from).toBe(3);
	});
});
