// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc } from "./markdown-wc";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { tiptapDocToAst } from "./tiptap-to-mdwc";
import { parseMarkdown, serializeAst } from "../markdown";

function editorFor(markdown: string): Editor {
	return new Editor({
		extensions: MarkdownWc(),
		content: astToTiptapDoc(parseMarkdown(markdown)),
	});
}

function markdownOf(editor: Editor): string {
	return serializeAst(tiptapDocToAst(editor.getJSON() as any));
}

/** Position just after the given text, for a caret in a paragraph. */
function after(editor: Editor, text: string): number {
	let found = -1;
	editor.state.doc.descendants((node, pos) => {
		if (found >= 0) return false;
		if (node.isText && node.text?.includes(text)) {
			found = pos + node.text.indexOf(text) + text.length;
		}
		return found < 0;
	});
	if (found < 0) throw new Error(`no text ${JSON.stringify(text)}`);
	return found;
}

describe("insertFootnote", () => {
	test("puts a marker at the caret, a definition at the end, and the caret in the note", () => {
		const editor = editorFor("Claim one.\n\nClaim two.\n");
		try {
			editor.commands.setTextSelection(after(editor, "Claim one."));
			expect(editor.commands.insertFootnote()).toBe(true);
			// The caret is inside the new definition's paragraph.
			const { $from } = editor.state.selection;
			expect($from.node($from.depth - 1).type.name).toBe("footnoteDef");
			expect($from.parent.textContent).toBe("");
			editor.commands.insertContent("The note.");
			expect(markdownOf(editor)).toBe(
				"Claim one.[^1]\n\nClaim two.\n\n[^1]: The note.\n",
			);
		} finally {
			editor.destroy();
		}
	});

	test("the label is the smallest number not already in use", () => {
		const editor = editorFor(
			"A[^1] B[^3] C[^note]\n\n[^1]: One.\n\n[^3]: Three.\n\n[^note]: Named.\n",
		);
		try {
			// The caret at the end of the line, past the existing markers.
			const firstParagraph = editor.state.doc.firstChild!;
			editor.commands.setTextSelection(firstParagraph.nodeSize - 1);
			editor.commands.insertFootnote();
			expect(markdownOf(editor)).toContain("C[^note][^2]");
			expect(markdownOf(editor)).toContain("[^note]: Named.");
		} finally {
			editor.destroy();
		}
	});

	test("a new definition joins the others where the author keeps them", () => {
		const editor = editorFor(
			[
				"Intro.[^1]",
				"",
				"## Sources",
				"",
				"[^1]: First source.",
				"",
				"## Appendix",
				"",
				"Closing words.",
				"",
			].join("\n"),
		);
		try {
			editor.commands.setTextSelection(after(editor, "Closing words."));
			editor.commands.insertFootnote();
			editor.commands.insertContent("Second source.");
			expect(markdownOf(editor)).toBe(
				[
					"Intro.[^1]",
					"",
					"## Sources",
					"",
					"[^1]: First source.",
					"",
					"[^2]: Second source.",
					"",
					"## Appendix",
					"",
					"Closing words.[^2]",
					"",
				].join("\n"),
			);
		} finally {
			editor.destroy();
		}
	});

	test("has no place inside a code block or inside a note", () => {
		const editor = editorFor(
			"```js\ncode\n```\n\nText.[^1]\n\n[^1]: A note.\n",
		);
		try {
			editor.commands.setTextSelection(after(editor, "code"));
			expect(editor.can().insertFootnote()).toBe(false);
			editor.commands.setTextSelection(after(editor, "A note."));
			expect(editor.can().insertFootnote()).toBe(false);
			editor.commands.setTextSelection(after(editor, "Text."));
			expect(editor.can().insertFootnote()).toBe(true);
		} finally {
			editor.destroy();
		}
	});

	test("Mod-Alt-F is the keyboard way in", () => {
		const editor = editorFor("Claim.\n");
		try {
			editor.commands.setTextSelection(after(editor, "Claim."));
			editor.view.dom.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "f",
					code: "KeyF",
					// jsdom is not a Mac, so Mod is Ctrl here.
					ctrlKey: true,
					altKey: true,
					bubbles: true,
				}),
			);
			// An empty note serializes as GFM writes it, colon and a space,
			// until the author types.
			expect(markdownOf(editor)).toBe("Claim.[^1]\n\n[^1]: \n");
		} finally {
			editor.destroy();
		}
	});
});
