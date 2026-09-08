// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { closeHistory } from "@tiptap/pm/history";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { tiptapDocToAst } from "./tiptap-to-mdwc";
import { parseMarkdown, serializeAst } from "../markdown";
const editors: Editor[] = [];
function load(markdown: string) {
	const editor = new Editor({
		extensions: [...MarkdownWc(), History],
		content: astToTiptapDoc(parseMarkdown(markdown)),
	});
	editors.push(editor);
	return editor;
}
function serialize(editor: Editor) {
	return serializeAst(tiptapDocToAst(editor.getJSON()));
}
function semantic(editor: Editor) {
	return JSON.parse(
		JSON.stringify(editor.getJSON(), (key, value) =>
			key === "data" ? undefined : value,
		),
	);
}
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

describe("fresh round 6 asset and table bridge verification", () => {
	test.each([
		"| Asset | Text |\n| --- | --- |\n| **![alt](image.png)** | value |\n",
		"| Asset | Text |\n| --- | --- |\n| before ![alt](image.png 'title') after | value |\n",
		"| Asset | Text |\n| --- | --- |\n| [![alt](image.png)](https://example.com) | value |\n",
		"*before ![alt](image.png) after*\n",
		"- **before ![alt](image.png) after**\n",
		"- ![alt](image.png 'title')\n  - child\n",
		"![asset][image] and [documentation][docs]\n\n[image]: image.png 'title'\n[docs]: https://example.com\n",
		"[![asset][image]][docs]\n\n[image]: image.png\n[docs]: https://example.com\n",
	])(
		"asset formatting survives unrelated edit and two reloads: %s",
		(markdown) => {
			const editor = load("Before\n\n" + markdown);
			editor.commands.setTextSelection(7);
			editor.commands.insertContent(" changed");
			const first = load(serialize(editor));
			expect(semantic(first)).toEqual(semantic(editor));
			expect(semantic(load(serialize(first)))).toEqual(semantic(editor));
		},
	);

	test("replacing selected cell contents with text and an image preserves the table", () => {
		const editor = load("| A | B |\n| --- | --- |\n| replace this | keep |\n");
		let start = 0;
		editor.state.doc.descendants((node, pos) => {
			if (node.isText && node.text === "replace this") start = pos;
		});
		expect(start).toBeGreaterThan(0);
		editor.commands.setTextSelection({ from: start, to: start + 12 });
		editor.commands.insertContent([
			{ type: "text", text: "new " },
			{ type: "image", attrs: { src: "image.png", alt: "asset" } },
			{ type: "text", text: " value" },
		]);
		expect(() => editor.state.doc.check()).not.toThrow();
		const reloaded = load(serialize(editor));
		expect(semantic(reloaded)).toEqual(semantic(editor));
		expect(reloaded.state.doc.firstChild!.child(1).childCount).toBe(2);
	});

	test.each(["- [ ] \n", "- parent\n  - child\n  -\n"])(
		"undo to an empty item remains editable after save: %s",
		(markdown) => {
			const editor = load(markdown);
			editor.commands.setContent(editor.getJSON());
			editor.view.dispatch(closeHistory(editor.state.tr));
			let cursor = 0;
			editor.state.doc.descendants((node, pos) => {
				if (node.type.name === "paragraph" && node.content.size === 0)
					cursor = pos + 1;
			});
			expect(cursor).toBeGreaterThan(0);
			editor.commands.setTextSelection(cursor);
			editor.commands.insertContent("temporary");
			expect(editor.commands.undo()).toBe(true);
			const reloaded = load(serialize(editor));
			expect(semantic(reloaded)).toEqual(semantic(editor));
			expect(() => reloaded.state.doc.check()).not.toThrow();
			reloaded.commands.setTextSelection(cursor);
			reloaded.commands.insertContent("restored");
			expect(reloaded.state.selection.$from.parent.textContent).toBe(
				"restored",
			);
		},
	);
});
