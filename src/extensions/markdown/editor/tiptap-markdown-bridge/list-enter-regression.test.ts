// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "./markdown-wc";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { parseMarkdown } from "../markdown";
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));
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
test("loaded Ideas example outdents then exits only the empty item", () => {
	const editor = new Editor({
		extensions: MarkdownWc(),
		content: astToTiptapDoc(
			parseMarkdown(
				"# Ideas\n\n<span></span>\n\n- Rapid API but for coding agents\n  - rapid api is outdated. api's are massively more impactful for coding agents\n  -\n",
			),
		),
	});
	editors.push(editor);
	let emptyPos = 0;
	editor.state.doc.descendants((node, pos) => {
		if (node.type.name === "paragraph" && node.content.size === 0)
			emptyPos = pos + 1;
	});
	editor.commands.setTextSelection(emptyPos);
	expect(enter(editor)).toBe(true);
	const before = editor.state.doc.child(2).child(0).toString();
	expect(enter(editor)).toBe(true);
	expect(editor.state.doc.child(2).type.name).toBe("bulletList");
	expect(editor.state.doc.child(2).child(0).toString()).toEqual(before);
	expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
	expect(editor.state.selection.$from.depth).toBe(1);
});
