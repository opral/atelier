// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { tiptapDocToAst } from "./tiptap-to-mdwc";
import { parseMarkdown, serializeAst } from "../markdown";

const editors: Editor[] = [];
function load(markdown: string) {
	const editor = new Editor({
		extensions: MarkdownWc(),
		content: astToTiptapDoc(parseMarkdown(markdown)),
	});
	editors.push(editor);
	return editor;
}
function markdownOf(editor: Editor) {
	return serializeAst(tiptapDocToAst(editor.getJSON()));
}
function semanticAst(markdown: string) {
	return JSON.parse(
		JSON.stringify(parseMarkdown(markdown), (key, value) =>
			key === "position" || key === "data" ? undefined : value,
		),
	);
}
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("Markdown writing bridge QA", () => {
	test.each([
		["- > quoted\n", "blockquote"],
		["- ```js\n  const value = 1;\n  ```\n", "codeBlock"],
		["- - nested\n", "bulletList"],
		["- # heading\n", "heading"],
		["4. > quoted\n", "blockquote"],
	])(
		"block-first list remains editable without changing Markdown: %s",
		(markdown, blockType) => {
			const editor = load(markdown);
			expect(() => editor.state.doc.check()).not.toThrow();
			const item = editor.state.doc.firstChild!.firstChild!;
			expect(item.firstChild!.type.name).toBe("paragraph");
			expect(item.firstChild!.content.size).toBe(0);
			expect(item.child(1).type.name).toBe(blockType);
			expect(semanticAst(markdownOf(editor))).toEqual(semanticAst(markdown));
			const reloaded = load(markdownOf(editor));
			expect(() => reloaded.state.doc.check()).not.toThrow();
			expect(markdownOf(reloaded)).toBe(markdownOf(editor));
			editor.commands.setTextSelection(3);
			editor.commands.insertContent("intro");
			const edited = load(markdownOf(editor));
			expect(
				edited.state.doc.firstChild!.firstChild!.firstChild!.textContent,
			).toBe("intro");
			expect(edited.state.doc.firstChild!.firstChild!.child(1).type.name).toBe(
				blockType,
			);
		},
	);

	test.each([">\n", "> >\n", "- >\n"])(
		"empty quoted block supports caret input: %s",
		(markdown) => {
			const editor = load(markdown);
			expect(() => editor.state.doc.check()).not.toThrow();
			let quotedParagraphPosition: number | undefined;
			editor.state.doc.descendants((node, pos, parent) => {
				if (
					node.type.name === "paragraph" &&
					parent?.type.name === "blockquote"
				)
					quotedParagraphPosition = pos + 1;
			});
			expect(quotedParagraphPosition).toBeDefined();
			expect(semanticAst(markdownOf(editor))).toEqual(semanticAst(markdown));
			editor.commands.setTextSelection(quotedParagraphPosition!);
			editor.commands.insertContent("quote");
			expect(markdownOf(load(markdownOf(editor)))).toBe(markdownOf(editor));
			expect(editor.state.doc.textContent).toBe("quote");
		},
	);

	test("table cell line breaks survive serialization without changing table shape", () => {
		const editor = load(
			"| Header | Other |\n| --- | --- |\n| beforeafter | value |\n",
		);
		let cursor = 0;
		editor.state.doc.descendants((node, pos) => {
			if (node.isText && node.text === "beforeafter") cursor = pos + 6;
		});
		expect(cursor).toBeGreaterThan(0);
		editor.commands.setTextSelection(cursor);
		editor.commands.insertContent({ type: "hardBreak" });
		const serialized = markdownOf(editor);
		expect(serialized).toContain("before<br>after");
		const reloaded = load(serialized);
		const table = reloaded.state.doc.firstChild!;
		expect(table.type.name).toBe("table");
		expect(table.childCount).toBe(2);
		expect(table.child(1).childCount).toBe(2);
		expect(table.child(1).firstChild!.child(1).type.name).toBe("hardBreak");
		expect(markdownOf(reloaded)).toBe(serialized);
	});

	test("fenced code metadata survives a nearby text edit and reload", () => {
		const markdown =
			'before\n\n```ts title="example.ts" {1,3}\nconst value = 1;\n```\n';
		const editor = load(markdown);
		editor.commands.setTextSelection(7);
		editor.commands.insertContent(" edited");
		const serialized = markdownOf(editor);
		expect(serialized).toContain('```ts title="example.ts" {1,3}');
		expect(markdownOf(load(serialized))).toBe(serialized);
	});
});
