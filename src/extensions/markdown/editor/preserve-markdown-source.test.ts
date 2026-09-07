import { expect, test } from "vitest";
import { parseMarkdownSource, serializeAst } from "./markdown";
import { preserveMarkdownSource } from "./preserve-markdown-source";

const normalized = (text: string) => serializeAst(parseMarkdownSource(text));

test("editing a heading preserves table padding, escaping, emphasis, and final newline", () => {
	const original =
		"## 1\\. Old\n\n| A | B |\n| --- | --- |\n| *x* | \\$2 |\n\nUntouched *text*.";
	const expected = original.replace("## 1\\. Old", "## 1. New");
	expect(preserveMarkdownSource(original, normalized(expected))).toBe(expected);
});

test("a no-op retains original bytes including CRLF and no final newline", () => {
	const original = "# Title\r\n\r\n*text*";
	expect(preserveMarkdownSource(original, normalized(original))).toBe(original);
});

test.each([
	["First", "First\n\nSecond\n"],
	["* first\n\nHeading\n=======\n\n* second\n", "- first\n- second\n"],
	[
		"[label][ref]\n\n[ref]: https://example.com\n",
		"Changed\n\n[label](https://example.com)\n",
	],
	["# First\n\n*repeat*\n\n*repeat*\n", "# New\n\n_repeat_\n\n_repeat_\n"],
	["# Gone\n\nKeep\n", "Keep\n"],
])("preserves surrounding syntax when assembling %s", (original, edited) => {
	const target = normalized(edited);
	expect(normalized(preserveMarkdownSource(original, target))).toBe(target);
});

test("editing a neighbor preserves reference spelling and detached definitions", () => {
	const original =
		"[Read][guide]\n\nOld heading\n\n[guide]: https://example.com 'Guide'\n";
	const edited = normalized(original.replace("Old heading", "New heading"));
	const saved = preserveMarkdownSource(original, edited);
	expect(saved).toContain("[Read][guide]");
	expect(saved).toContain("[guide]: https://example.com 'Guide'");
	expect(normalized(saved)).toBe(edited);
});

test("editing a block does not insert blank lines between unchanged adjacent headings", () => {
	const original = "# First\n## Second\n\nOld\n";
	expect(
		preserveMarkdownSource(
			original,
			normalized(original.replace("Old", "New")),
		),
	).toBe(original.replace("Old", "New"));
});

test("retained definitions cannot turn newly typed literal brackets into links", () => {
	const original = "Old\n\n[ref]: https://example.com\n";
	const edited = "New [ref]\n";
	expect(normalized(preserveMarkdownSource(original, edited))).toBe(
		normalized(edited),
	);
});

test("deleting all content does not restore invisible reference definitions", () => {
	expect(
		preserveMarkdownSource("Text\n\n[ref]: https://example.com\n", ""),
	).toBe("");
});
