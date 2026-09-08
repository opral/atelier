// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, test } from "vitest";
import { MarkdownWc } from "./markdown-wc";
import { astToTiptapDoc } from "./mdwc-to-tiptap";
import { tiptapDocToAst } from "./tiptap-to-mdwc";
import { parseMarkdown, parseMarkdownSource, serializeAst } from "../markdown";
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

describe("round 4 source preservation", () => {
	test.each(["- \\[ ]\n", "- \\[x]\n", "4. \\[X]\n", "- &#91; ]\n"])(
		"escaped task-like text remains literal: %s",
		(markdown) => {
			const editor = load(markdown);
			const item = editor.state.doc.firstChild!.firstChild!;
			expect(item.attrs.checked).toBeNull();
			expect(item.textContent).toMatch(/^\[[ xX]\]$/);
			expect(semantic(load(serialize(editor)))).toEqual(semantic(editor));
		},
	);

	test.each([
		"\\# heading and \\*literal\\* and \\[link](url)\n",
		"\\<span>\\</span>\n",
		"text &lt;widget&gt; after\n",
		"`  padded  `\n",
		"`` `tick` ``\n",
		"`   `\n",
		"[![alt](image.png 'image title')](https://example.com 'link title')\n",
		"inline <kbd>Ctrl</kbd> text\n",
	])("literal text, code and image titles survive reload: %s", (markdown) => {
		const editor = load(markdown);
		expect(semantic(load(serialize(editor)))).toEqual(semantic(editor));
	});

	test("editing prose preserves frontmatter bytes and reference spelling", () => {
		const original =
			"---\n# comment\ntitle: 'Original'\nvalues: [a, b]\n---\n\n[Read][ref]\n\nOld paragraph\n\n[ref]: https://example.com 'Title'\n";
		const edited = serialize(
			load(original.replace("Old paragraph", "New paragraph")),
		);
		const saved = preserveMarkdownSource(original, edited);
		expect(saved).toBe(original.replace("Old paragraph", "New paragraph"));
	});

	test("an unchanged nested reference definition is not duplicated", () => {
		const original =
			"[Read][ref]\n\n> Quote\n>\n> [ref]: https://example.com 'Title'\n\nOld\n";
		const edited = serialize(load(original.replace("Old", "New")));
		expect(preserveMarkdownSource(original, edited)).toBe(
			original.replace("Old", "New"),
		);
	});

	test.each([
		"[Read][ref]\n\n> Old\n>\n> [ref]: https://example.com 'Title'\n",
		"[Read][ref]\n\n- Old\n\n  [ref]: https://example.com 'Title'\n",
		"[Read][ref]\n\n> Old\n>\n> [ref]: https://example.com\n>   'Title'\n",
	])(
		"reference definitions inside an edited container remain available: %s",
		(original) => {
			const edited = serialize(load(original.replace("Old", "New")));
			const saved = preserveMarkdownSource(original, edited);
			expect(saved).toContain("[ref]: https://example.com");
			expect(saved).toContain("[Read][ref]");
			expect(serializeAst(parseMarkdownSource(saved))).toBe(
				serializeAst(parseMarkdownSource(edited)),
			);
		},
	);
});
