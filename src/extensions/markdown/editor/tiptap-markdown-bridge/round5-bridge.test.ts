// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { tiptapDocToAst } from "./tiptap-to-mdwc";
import { parseMarkdown, serializeAst } from "../markdown";
import { preserveMarkdownSource } from "../preserve-markdown-source";
const editors: Editor[] = [];
function load(markdown: string) {
	const editor = new Editor({
		extensions: MarkdownWc(),
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

describe("round 5 bridge load-edit-save matrix", () => {
	test.each([
		"**before <kbd>key</kbd> after**\n",
		"~~before <kbd>key</kbd> after~~\n",
		"[before <kbd>key</kbd> after](https://example.com)\n",
		"before <!-- hidden --> after\n",
		'<custom data-value="x">\nbody\n</custom>\n',
		"| code | escaped |\n| --- | --- |\n| `a\\|b` | a\\|b |\n",
		"| A | B |\n| :- | -: |\n| **bold**<br>tail | [link](https://example.com?q=a%7Cb) |\n",
		"space\u00a0inside and \u2003wide\u2003space\n",
		"emoji 👨‍👩‍👧‍👦 and 中文 **粗体**\n",
		"escaped \\~\\~strike\\~\\~ and \\`tick\\`\n",
		'![a \\[bracket\\] and &lt;tag&gt;](image.png "title")\n',
		'[escaped \\[label\\]][id]\n\n[id]: <https://example.com/a?q=1&b=2> "title"\n',
	])("retains semantics after nearby edit and two reloads: %s", (markdown) => {
		const original = "Edit here\n\n" + markdown;
		const editor = load(original);
		editor.commands.setTextSelection(10);
		editor.commands.insertContent(" changed");
		const expected = semantic(editor);
		const first = load(serialize(editor));
		expect(semantic(first)).toEqual(expected);
		expect(semantic(load(serialize(first)))).toEqual(expected);
		const source = preserveMarkdownSource(original, serialize(editor));
		expect(semantic(load(source))).toEqual(expected);
	});
	test.each([
		"~~~python\r\nprint('x')  \r\n~~~",
		"```text\n  leading\ntrailing  \n\n```\n",
		"Inline `` spaced `tick` `` and `   `.",
		"[read][REF]\n\n[ref]: https://example.com 'Single title'\n",
		'[read][ref]\n\n[ref]: https://example.com\n  "Multiline title"\n',
		"* one\n\n* two\n",
		"9) nine\n10) ten",
		"| A    | B    |\n| :--- | ---: |\n| x    | y    |",
		"<div class='custom'>\n  raw &amp; untouched\n</div>\n",
		"Escaped \\*literal\\* and &#160; entity.",
	])(
		"follow-up: untouched source spelling survives a neighbor edit: %s",
		(markdown) => {
			const original = "Edit here\n\n" + markdown;
			const editor = load(original);
			editor.commands.setTextSelection(10);
			editor.commands.insertContent(" changed");
			const saved = preserveMarkdownSource(original, serialize(editor));
			expect(saved.endsWith(markdown)).toBe(true);
			expect(semantic(load(saved))).toEqual(semantic(editor));
			expect(preserveMarkdownSource(saved, serialize(load(saved)))).toBe(saved);
		},
	);
});
