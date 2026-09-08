import { afterEach, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { MarkdownWc, astToTiptapDoc } from "./tiptap-markdown-bridge";
import { parseMarkdown } from "./markdown";
import { handlePaste } from "./handle-paste";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});
function setup(markdown: string) {
	const editor = new Editor({
		extensions: [...MarkdownWc(), History],
		content: astToTiptapDoc(parseMarkdown(markdown)),
	});
	editors.push(editor);
	return editor;
}
function paste(editor: Editor, text: string) {
	expect(
		handlePaste({
			editor,
			event: {
				preventDefault() {},
				clipboardData: {
					getData: (type: string) => (type === "text/plain" ? text : ""),
				},
			},
		}),
	).toBe(true);
	editor.state.doc.check();
}
test("pasting a word in a sentence preserves the sentence and clipboard spacing", () => {
	const editor = setup("Hello world");
	editor.commands.setTextSelection(7);
	paste(editor, "beautiful ");
	expect(editor.state.doc.childCount).toBe(1);
	expect(editor.state.doc.textContent).toBe("Hello beautiful world");
});
test("pasting source code inside a code fence preserves literal markdown and whitespace", () => {
	const editor = setup("```js\nbeforeAFTER\n```");
	editor.commands.setTextSelection(7);
	const text = "\n# heading\n- item\n\n  **literal**  \n";
	paste(editor, text);
	expect(editor.state.doc.childCount).toBe(1);
	expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock");
	expect(editor.state.doc.textContent).toBe("before" + text + "AFTER");
});
test("pasting whitespace over selected code does not delete the code block", () => {
	const editor = setup("```\nreplace\n```");
	editor.commands.setTextSelection({ from: 1, to: 8 });
	paste(editor, "  \n\t");
	expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock");
	expect(editor.state.doc.textContent).toBe("  \n\t");
});

test.each([
	"- Hello world",
	"1. Hello world",
	"- [ ] Hello world",
	"## Hello world",
])("inline paste preserves its surrounding block: %s", (markdown) => {
	const editor = setup(markdown);
	let position = 0;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === "Hello world") position = pos + 6;
	});
	editor.commands.setTextSelection(position);
	paste(editor, "**beautiful** ");
	expect(editor.state.doc.childCount).toBe(1);
	expect(editor.state.doc.textContent).toBe("Hello beautiful world");
	let bold = false;
	editor.state.doc.descendants((node) => {
		if (node.isText && node.text === "beautiful")
			bold = node.marks.some((mark) => mark.type.name === "bold");
	});
	expect(bold).toBe(true);
});
test("single-line clipboard spaces are preserved when replacing selected prose", () => {
	const editor = setup("Hello old world");
	editor.commands.setTextSelection({ from: 6, to: 11 });
	paste(editor, " new ");
	expect(editor.state.doc.textContent).toBe("Hello new world");
	expect(editor.state.doc.childCount).toBe(1);
});
test("multiblock paste replaces a cross-paragraph selection without losing the suffix", () => {
	const editor = setup("Before old\n\nother after");
	editor.commands.setTextSelection({ from: 8, to: 19 });
	paste(editor, "First\n\n- Second\n\n```js\nthird()\n```");
	expect(editor.state.doc.textContent).toContain("Before");
	expect(editor.state.doc.textContent).toContain("after");
	expect(editor.state.doc.textContent).toContain("Second");
	expect(editor.state.doc.textContent).toContain("third()");
});
test("pasting inline text into a table cell preserves table structure", () => {
	const editor = setup("| Column |\n| --- |\n| Hello world |");
	let position = 0;
	editor.state.doc.descendants((node, pos) => {
		if (node.isText && node.text === "Hello world") position = pos + 6;
	});
	editor.commands.setTextSelection(position);
	paste(editor, "beautiful ");
	expect(editor.state.doc.childCount).toBe(1);
	expect(editor.state.doc.firstChild?.type.name).toBe("table");
	expect(editor.state.doc.textContent).toContain("Hello beautiful world");
});
test("literal code paste can be undone and redone", () => {
	const editor = setup("```\nstart\n```");
	editor.commands.setTextSelection(6);
	paste(editor, "\n**literal**");
	expect(editor.state.doc.textContent).toBe("start\n**literal**");
	editor.commands.undo();
	expect(editor.state.doc.textContent).toBe("start");
	editor.commands.redo();
	expect(editor.state.doc.textContent).toBe("start\n**literal**");
});

test.each(["# heading", "- one\n- two", "first\n\nsecond"])(
	"structured paste stays inside the selected table cell: %s",
	(text) => {
		const editor = setup(
			"| Column | Other |\n| --- | --- |\n| Hello world | Keep |",
		);
		let position = 0;
		editor.state.doc.descendants((node, pos) => {
			if (node.isText && node.text === "Hello world") position = pos + 6;
		});
		editor.commands.setTextSelection(position);
		paste(editor, text);
		const table = editor.state.doc.firstChild!;
		expect(editor.state.doc.childCount).toBe(1);
		expect(table.childCount).toBe(2);
		expect(table.child(1).childCount).toBe(2);
		expect(table.child(1).child(1).textContent).toBe("Keep");
		expect(table.child(1).child(0).textContent).toBe(
			"Hello " + text.replace(/\n/g, "") + "world",
		);
		expect(
			table
				.child(1)
				.child(0)
				.content.content.filter((node) => node.type.name === "hardBreak"),
		).toHaveLength(text.split("\n").length - 1);
	},
);
