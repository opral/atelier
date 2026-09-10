// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "../tiptap-markdown-bridge";
import { buildMarkdownFromEditor } from "../build-markdown-from-editor";
import { parseMarkdown } from "../markdown";
import { astToTiptapDoc } from "../tiptap-markdown-bridge/mdwc-to-tiptap";
import { JoinAdjacentListsExtension } from "./join-adjacent-lists";

const editors: Editor[] = [];
function editorFor(markdown: string) {
	const editor = new Editor({
		extensions: [...(MarkdownWc() as any[]), JoinAdjacentListsExtension],
		content: { type: "doc", content: [{ type: "paragraph" }] },
	});
	// setContent is a transaction, so the join runs as it would after an edit.
	editor.commands.setContent(
		astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
	);
	editors.push(editor);
	return editor;
}
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("adjacent lists join into one", () => {
	test("bullet lists that touch become one list, tasks included", () => {
		const editor = editorFor(
			"- [x] done\n\n* [ ] next\n* [ ] later\n\n- plain\n",
		);
		expect(editor.state.doc.childCount).toBe(1);
		expect(editor.state.doc.firstChild?.attrs.isTaskList).toBe(true);
		expect(buildMarkdownFromEditor(editor)).toBe(
			"- [x] done\n- [ ] next\n- [ ] later\n- plain\n",
		);
	});

	test("an ordered list that continues the numbering joins; a restart stays apart", () => {
		const continued = editorFor("1. a\n2. b\n\n3) c\n");
		expect(buildMarkdownFromEditor(continued)).toBe("1. a\n2. b\n3. c\n");
		const restarted = editorFor("1. a\n2. b\n\n1) c\n");
		expect(restarted.state.doc.childCount).toBe(2);
	});

	test("deleting the paragraph between two lists merges them", () => {
		const editor = editorFor("- a\n\nbetween\n\n- b\n");
		expect(editor.state.doc.childCount).toBe(3);
		let from = -1;
		editor.state.doc.descendants((node, pos) => {
			if (node.isTextblock && node.textContent === "between") from = pos;
		});
		editor.view.dispatch(
			editor.state.tr.delete(
				from,
				from + editor.state.doc.nodeAt(from)!.nodeSize,
			),
		);
		expect(buildMarkdownFromEditor(editor)).toBe("- a\n- b\n");
	});

	test("nested lists join too", () => {
		const editor = editorFor("- parent\n  - one\n\n  * two\n");
		// The blank line in the source made the parent item loose; the nested
		// lists are one list.
		expect(buildMarkdownFromEditor(editor)).toBe(
			"- parent\n\n  - one\n  - two\n",
		);
		expect(editor.state.doc.firstChild?.firstChild?.childCount).toBe(2);
	});
});
