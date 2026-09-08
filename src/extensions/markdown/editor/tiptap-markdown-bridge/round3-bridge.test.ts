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

describe("round 3 Markdown preservation", () => {
	test.each([
		"**outer _inner_ tail**\n",
		"_outer **inner** tail_\n",
		"~~outer **inner** tail~~\n",
		"**`code`**\n",
		"_`code`_\n",
		"~~`code`~~\n",
		'[**linked _nested_ words**](https://example.com "title")\n',
		"<https://example.com/a?q=x>\n",
		"first\nsecond  \nthird\n",
		"[line one\nline two](https://example.com)\n",
	])(
		"retains text and inline marks through repeated reload: %s",
		(markdown) => {
			const editor = load(markdown);
			const expected = semantic(editor);
			const first = load(serialize(editor));
			expect(semantic(first)).toEqual(expected);
			expect(semantic(load(serialize(first)))).toEqual(expected);
		},
	);

	test.each([
		"**outer ~~inner~~ tail**\n",
		"_outer ~~inner~~ tail_\n",
		"~~outer _inner_ tail~~\n",
		"~~outer **_inner_** tail~~\n",
		"[outer **inner** tail](https://example.com)\n",
		"[one](https://one.example) [two](https://two.example)\n",
		"~~left~~ **middle** ~~right~~\n",
		"**[![alt](image.png)](https://example.com)**\n",
	])(
		"nested formatting and adjacent links retain their boundaries: %s",
		(markdown) => {
			const editor = load(markdown);
			expect(semantic(load(serialize(editor)))).toEqual(semantic(editor));
		},
	);

	test("linked inline image keeps its link when loaded and saved", () => {
		const markdown =
			'before [![alt](image.png "image")](https://example.com "link") after\n';
		const editor = load(markdown);
		const paragraph = editor.state.doc.firstChild!;
		const image = paragraph.child(1);
		expect(image.type.name).toBe("image");
		expect(
			image.marks.find((mark) => mark.type.name === "link")?.attrs.href,
		).toBe("https://example.com");
		expect(serialize(editor)).toContain(
			'[![alt](image.png "image")](https://example.com "link")',
		);
		expect(semantic(load(serialize(editor)))).toEqual(semantic(editor));
	});
});
