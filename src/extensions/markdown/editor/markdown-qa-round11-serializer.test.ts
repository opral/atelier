// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, test } from "vitest";
import { buildMarkdownFromEditor } from "./build-markdown-from-editor";
import { createEditor } from "./create-editor";
import { parseMarkdown, serializeAst } from "./markdown";
import { MarkdownWc } from "./tiptap-markdown-bridge/markdown-wc";
import { astToTiptapDoc } from "./tiptap-markdown-bridge/mdwc-to-tiptap";
import { tiptapDocToAst } from "./tiptap-markdown-bridge/tiptap-to-mdwc";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

async function settle() {
	for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

/** Opens `markdown` through the real save path and returns what gets written. */
async function openForSave(markdown: string) {
	const writes: string[] = [];
	const lix = {
		execute: async (sql: string, params: any[]) => {
			if (/^UPDATE lix_file/.test(sql))
				writes.push(new TextDecoder().decode(params[0]));
			return { rowsAffected: 1, rows: [], commit: null };
		},
	} as any;
	const editor = createEditor({
		lix,
		initialMarkdown: markdown,
		fileId: "f",
		persistState: true,
		persistDebounceMs: 0,
		element: document.body.appendChild(document.createElement("div")),
	} as any);
	editors.push(editor);
	await settle();
	return { editor, lastWrite: () => writes.at(-1) };
}

function textPosition(editor: Editor, needle: string): number {
	let pos: number | null = null;
	editor.state.doc.descendants((node, p) => {
		if (pos !== null) return false;
		if (node.isText && node.text!.includes(needle)) {
			pos = p + node.text!.indexOf(needle);
			return false;
		}
		return true;
	});
	if (pos === null) throw new Error(`needle not found: ${needle}`);
	return pos;
}

/** Types `ch` right after `needle` and returns the bytes saved. */
async function typeAfter(markdown: string, needle: string, ch = "Z") {
	const { editor, lastWrite } = await openForSave(markdown);
	const pos = textPosition(editor, needle) + needle.length;
	editor.view.dispatch(editor.state.tr.insertText(ch, pos, pos));
	await settle();
	return lastWrite();
}

/** Toggles `mark` over `needle` and returns the bytes saved. */
async function markText(
	markdown: string,
	needle: string,
	mark: "bold" | "italic" | "strike",
	action: "add" | "remove" = "add",
) {
	const { editor, lastWrite } = await openForSave(markdown);
	const from = textPosition(editor, needle);
	const type = editor.schema.marks[mark]!;
	const tr =
		action === "add"
			? editor.state.tr.addMark(from, from + needle.length, type.create())
			: editor.state.tr.removeMark(from, from + needle.length, type);
	editor.view.dispatch(tr);
	await settle();
	return lastWrite();
}

function editorFor(content: JSONContent) {
	const editor = new Editor({ extensions: MarkdownWc(), content });
	editors.push(editor);
	return editor;
}

describe("marks nest by span, not in a fixed order", () => {
	test("italic inside bold saves as nested emphasis", async () => {
		expect(await typeAfter("**a *b* c** end", "end")).toBe(
			"**a *b* c** endZ\n",
		);
		expect(await markText("**bold text** end", "text", "italic")).toBe(
			"**bold *text*** end\n",
		);
	});

	test("a link inside bold or strike stays one link", async () => {
		expect(await typeAfter("**see [x](https://y.z) now** end", "end")).toBe(
			"**see [x](https://y.z) now** endZ\n",
		);
		expect(await typeAfter("~~[x](u) y~~ end", "end")).toBe(
			"~~[x](u) y~~ endZ\n",
		);
	});

	test("a line break inside a link does not split it", async () => {
		const saved = await typeAfter("[a  \nb](u) end", "end");
		expect(saved).toBe("[a  \nb](u) endZ\n");
	});

	test("random mark toggles always round-trip", () => {
		let seed = 11;
		const random = () => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		const markSets = (json: JSONContent): string[] => {
			const out: string[] = [];
			for (const node of json.content?.[0]?.content ?? []) {
				if (node.type !== "text") continue;
				for (const char of node.text ?? "") {
					const marks = (node.marks ?? [])
						.filter((mark) => /\S/.test(char) || mark.type === "link")
						.map((mark) =>
							mark.type === "link" ? `link:${mark.attrs?.href}` : mark.type,
						)
						.sort();
					out.push(`${char}[${marks.join(",")}]`);
				}
			}
			return out;
		};
		// Each run toggles marks over random word ranges, the way a selection
		// does: from the start of one word to the end of another. A delimiter
		// that opens mid-word next to another delimiter (`x~~**b**~~`) is not
		// expressible in Markdown at all, so words are toggled whole.
		const kinds = [
			"bold",
			"italic",
			"strike",
			"link:https://a.b",
			"link:https://c.d",
		];
		for (let run = 0; run < 500; run++) {
			const words = 2 + Math.floor(random() * 4);
			const tokens = Array.from({ length: words * 2 - 1 }, (_, i) => ({
				text: i % 2 === 1 ? " " : ["a", "bc", "def"][Math.floor(random() * 3)]!,
				marks: new Set<string>(),
			}));
			for (let toggle = 0; toggle < 1 + Math.floor(random() * 5); toggle++) {
				const kind = kinds[Math.floor(random() * kinds.length)]!;
				const first = Math.floor(random() * words) * 2;
				const last = first + Math.floor(random() * (words - first / 2)) * 2;
				const range = tokens.slice(first, last + 1);
				const remove = range.every((token) => token.marks.has(kind));
				for (const token of range) {
					if (kind.startsWith("link:"))
						for (const mark of token.marks)
							if (mark.startsWith("link:")) token.marks.delete(mark);
					if (remove) token.marks.delete(kind);
					else token.marks.add(kind);
				}
			}
			// A link over nothing but a space is kept as its source instead
			// (see "links with no visible text"), so none is generated here.
			tokens.forEach((token, index) => {
				for (const mark of token.marks)
					if (
						token.text === " " &&
						mark.startsWith("link:") &&
						!(
							tokens[index - 1]?.marks.has(mark) ||
							tokens[index + 1]?.marks.has(mark)
						)
					)
						token.marks.delete(mark);
			});
			const content: JSONContent[] = [{ type: "text", text: "x " }];
			for (const token of tokens) {
				content.push({
					type: "text",
					text: token.text,
					marks: [...token.marks].map((mark) =>
						mark.startsWith("link:")
							? { type: "link", attrs: { href: mark.slice(5) } }
							: { type: mark },
					),
				});
			}
			content.push({ type: "text", text: " x" });
			const editor = editorFor({
				type: "doc",
				content: [{ type: "paragraph", content }],
			});
			const markdown = buildMarkdownFromEditor(editor);
			const reloaded = editorFor(
				astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
			);
			expect(markdown, JSON.stringify(content)).not.toContain("&#x");
			expect(markSets(reloaded.getJSON()), markdown).toEqual(
				markSets(editor.getJSON()),
			);
			for (const done of editors.splice(0)) done.destroy();
		}
	});
});

describe("whitespace at emphasis edges", () => {
	test("bolding a word with its trailing space", async () => {
		expect(await markText("hello world", "hello ", "bold")).toBe(
			"**hello** world\n",
		);
	});

	test("un-bolding the middle word", async () => {
		expect(await markText("**abc def ghi**", "def", "bold", "remove")).toBe(
			"**abc** def **ghi**\n",
		);
	});

	test("a bold run typed after a word", async () => {
		const { editor, lastWrite } = await openForSave("hello");
		const end = textPosition(editor, "hello") + 5;
		const bold = editor.schema.marks.bold!.create();
		editor.view.dispatch(
			editor.state.tr.insert(end, editor.schema.text(" bold", [bold])),
		);
		await settle();
		expect(lastWrite()).toBe("hello **bold**\n");
	});
});

describe("inline HTML keeps the marks around it", () => {
	test("a badge link keeps its URL", async () => {
		expect(
			await typeAfter(
				'[<img src="badge.svg">](https://ci.example.com) end',
				"end",
			),
		).toBe('[<img src="badge.svg">](https://ci.example.com) endZ\n');
	});

	test("html inside bold stays inside the bold run", async () => {
		expect(await typeAfter("**<kbd>Ctrl</kbd> key** end", "end")).toBe(
			"**<kbd>Ctrl</kbd> key** endZ\n",
		);
	});
});

/** The spelling a document has after one trip through the editor. */
function throughEditor(markdown: string): string {
	return serializeAst(
		tiptapDocToAst(astToTiptapDoc(parseMarkdown(markdown)) as any),
	);
}

describe("HTML line breaks", () => {
	test.each([
		"Line A<br>\nLine B\n",
		"Line A<br/>\nLine B\n",
		"Line A<br />\nLine B\n",
		"Line A<br><br>\nLine B\n",
		"- Line A<br>\n  Line B\n",
		"> Line A<br>\n> Line B\n",
	])("an edit elsewhere leaves %j untouched", async (block) => {
		expect(await typeAfter(`Intro\n\n${block}`, "Intro")).toBe(
			`IntroZ\n\n${block}`,
		);
	});

	test("editing the line keeps the break and its spelling", async () => {
		expect(await typeAfter("Line A<br/>\nLine B\n", "Line B")).toBe(
			"Line A<br/>\nLine BZ\n",
		);
		expect(await typeAfter("Line A<br>Line B\n", "Line B")).toBe(
			"Line A<br>Line BZ\n",
		);
	});

	test("a typed break before a source newline is written as <br>", async () => {
		const { editor, lastWrite } = await openForSave("Line A\nLine B\n");
		const end = textPosition(editor, "Line A") + 6;
		editor.view.dispatch(
			editor.state.tr.insert(end, editor.schema.nodes.hardBreak!.create()),
		);
		await settle();
		expect(lastWrite()).toBe("Line A<br>\nLine B\n");
	});
});

describe("canonical stability", () => {
	// Whatever the editor writes must be what it would write again after a
	// reload; otherwise an untouched block no longer matches its source and
	// is rewritten on an unrelated edit.
	test.each([
		"Line A<br>\nLine B",
		"Line A<br><br>\nLine B",
		"a<br/>b<br />c",
		"**a *b* c**",
		"**bold *text***",
		"~~[x](u) y~~",
		"[a  \nb](u)",
		'[<img src="badge.svg">](https://ci.example.com)',
		"**<kbd>Ctrl</kbd> key**",
		"***a*** and *__b__*",
		"| a<br>b | c |\n| --- | --- |\n| 1 | 2 |",
		"### Heading<br>\ncontinued",
		"- a<br>\n  b\n- c",
	])("%j", (markdown) => {
		const once = throughEditor(markdown);
		expect(throughEditor(once)).toBe(once);
	});
});

describe("links with no visible text", () => {
	test.each([
		"Anchor [](https://x.com/a) end",
		"[](#top) end",
		"Anchor [ ](https://x.com/a) end",
		"[ ](https://x.com/a) end",
		'Titled [](https://x.com "t") end',
		"**[](#top)** end",
	])("%j survives an edit", async (markdown) => {
		expect(await typeAfter(markdown, "end")).toBe(`${markdown}Z\n`);
	});
});

describe("escapes only where the meaning needs them", () => {
	test.each([
		"> [!NOTE]\n> Body text",
		"> [!tip]+ Title\n> Body text",
		"#project [[Note]] [[Note|alias]] ![[img.png]] ==hi== text",
		"## See [[Note]] text",
		"snake_case path/some_file.md 5 * 3 a*b AT&T ~5 #tag [b] = text",
		"$a_1 * b_2$ text",
		"$$\n\\sum_{i} x_i\n$$ text",
		"https://example.com and me@x.com text",
		"C:\\Users\\me and a\\b text",
	])("%j keeps its spelling when edited", async (markdown) => {
		expect(await typeAfter(markdown, "text")).toBe(`${markdown}Z\n`);
	});

	test.each([
		"\\*not emphasis\\* text",
		"\\# not a heading text",
		"\\- not a list text",
		"1\\. not a list text",
		"\\> not a quote text",
		"\\+ not a list text",
		"\\`not code\\` text",
		"\\~~not struck~~ text",
		"\\[x]: not a definition text",
		"a \\<b> not html text",
		"\\[not a link](u) text",
	])("%j keeps the escapes it needs", async (markdown) => {
		const saved = await typeAfter(markdown, "text");
		expect(throughEditor(saved!)).toBe(throughEditor(`${markdown}Z`));
	});

	test("a literal [label] stays escaped when the file defines that label", async () => {
		const markdown = "Literal \\[b] and [c] text\n\n[b]: https://b.example\n";
		expect(await typeAfter(markdown, "text")).toBe(
			"Literal \\[b] and [c] textZ\n\n[b]: https://b.example\n",
		);
	});

	test("bare URLs stay bare, and one typed against stays the same link", async () => {
		expect(
			await typeAfter("see https://x.com, www.x.com and me@x.com text", "text"),
		).toBe("see https://x.com, www.x.com and me@x.com textZ\n");
		const saved = await typeAfter("see https://x.com end", "https://x.com");
		const reloaded = astToTiptapDoc(parseMarkdown(saved!)) as JSONContent;
		expect(reloaded.content?.[0]?.content).toMatchObject([
			{ text: "see " },
			{ text: "https://x.com", marks: [{ attrs: { href: "https://x.com" } }] },
			{ text: "Z end" },
		]);
	});

	test("a URL typed as plain text is saved as written", async () => {
		const { editor, lastWrite } = await openForSave("Visit");
		const end = textPosition(editor, "Visit") + 5;
		editor.view.dispatch(
			editor.state.tr.insertText(" https://example.com now", end, end),
		);
		await settle();
		expect(lastWrite()).toBe("Visit https://example.com now\n");
	});
});

test("a CRLF file keeps CRLF in the edited block", async () => {
	expect(await typeAfter("Para end\r\n\r\n- a\r\n- b\r\n", "end")).toBe(
		"Para endZ\r\n\r\n- a\r\n- b\r\n",
	);
});

describe("the source around an edited block", () => {
	test("blank lines after it stay", async () => {
		expect(await typeAfter("A end\n\n\n\nB\n", "end")).toBe(
			"A endZ\n\n\n\nB\n",
		);
		expect(await typeAfter("- a end\n- b\n\n\n\nB\n", "b")).toBe(
			"- a end\n- bZ\n\n\n\nB\n",
		);
	});

	test("a reference definition stays where it was", async () => {
		expect(
			await typeAfter(
				"See [docs][d] end\n\n[d]: https://x.com\n\n## Next\n\nMore.\n",
				"end",
			),
		).toBe(
			"See [docs](https://x.com) endZ\n\n[d]: https://x.com\n\n## Next\n\nMore.\n",
		);
		expect(
			await typeAfter("[d]: https://x.com\n\nSee [docs][d] end\n", "end"),
		).toBe("[d]: https://x.com\n\nSee [docs](https://x.com) endZ\n");
	});
});

describe("characters keep their spelling in an edited block", () => {
	test.each([
		"a&nbsp;b &copy; text",
		"a&#xA0;b&#160;c text",
		"mixed \u00A0 and &nbsp; text",
		"Cafe\u0301 and \uF9D1 text",
		"`&copy;` stays code, &copy; stays a reference text",
	])("%j", async (markdown) => {
		expect(await typeAfter(markdown, "text")).toBe(`${markdown}Z\n`);
	});

	test("a new non-breaking space follows the source's spelling", async () => {
		expect(await typeAfter("a&nbsp;b text", "text", "\u00A0c")).toBe(
			"a&nbsp;b text&nbsp;c\n",
		);
	});
});

test("cells past the header's width are kept, and the header is not widened", async () => {
	expect(
		await typeAfter("| a | b |\n|---|---|\n| 1 | 2 | 3 |\n| x | y |\n", "1"),
	).toBe("| a | b |\n|---|---|\n| 1Z | 2 | 3 |\n| x | y |\n");
});

describe("an empty nested item right under its parent's text", () => {
	const nested = (list: "bulletList" | "orderedList", checked?: boolean) =>
		editorFor({
			type: "doc",
			content: [
				{
					type: "bulletList",
					content: [
						{
							type: "listItem",
							content: [
								{
									type: "paragraph",
									content: [{ type: "text", text: "parent" }],
								},
								{
									type: list,
									content: [
										{
											type: "listItem",
											...(checked === undefined ? {} : { attrs: { checked } }),
											content: [{ type: "paragraph" }],
										},
									],
								},
							],
						},
					],
				},
			],
		});

	test.each([["bulletList"], ["orderedList"]] as const)(
		"a %s child round-trips without changing the parent",
		(list) => {
			const editor = nested(list);
			const markdown = buildMarkdownFromEditor(editor);
			const reloaded = editorFor(
				astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
			);
			expect(reloaded.getJSON().content?.[0]?.type, markdown).toBe(
				"bulletList",
			);
			expect(buildMarkdownFromEditor(reloaded)).toBe(markdown);
			expect(reloaded.state.doc.toString()).toBe(editor.state.doc.toString());
		},
	);

	test("pressing Enter then Tab under a parent saves a list, not a heading", () => {
		const editor = editorFor(
			astToTiptapDoc(parseMarkdown("- parent")) as JSONContent,
		);
		editor.commands.setTextSelection(textPosition(editor, "parent") + 6);
		editor.commands.splitListItem("listItem");
		editor.commands.sinkListItem("listItem");
		const markdown = buildMarkdownFromEditor(editor);
		expect(parseMarkdown(markdown).children[0]?.type, markdown).toBe("list");
		expect(throughEditor(markdown)).toBe(markdown);
	});
});

describe("an edited block keeps its author's syntax choices", () => {
	test.each([
		["* a\n* b text", "* a\n* b textZ\n"],
		["+ a\n+ b text", "+ a\n+ b textZ\n"],
		["1. a\n1. b\n1. c text", "1. a\n1. b\n1. c textZ\n"],
		["1) a\n2) b text", "1) a\n2) b textZ\n"],
		["-   a\n-   b text", "-   a\n-   b textZ\n"],
		["* a\n  - n\n* b text", "* a\n  - n\n* b textZ\n"],
		["~~~js\ncode\n~~~\n\nPara text", "~~~js\ncode\n~~~\n\nPara textZ\n"],
		["line one  \nline two text", "line one  \nline two textZ\n"],
		["Para text\n\n---\n\nx\n", "Para textZ\n\n---\n\nx\n"],
	])("%j", async (markdown, expected) => {
		expect(await typeAfter(markdown, "text")).toBe(expected);
	});

	test("a setext heading stays setext", async () => {
		expect(await typeAfter("Title text\n=====\n\nx\n", "text")).toBe(
			"Title textZ\n===========\n\nx\n",
		);
	});

	test("a rule first in the file is not written as a frontmatter fence", () => {
		// "---" there, with another "---" below, would open YAML frontmatter.
		expect(throughEditor("---\n\nx\n")).toBe("***\n\nx\n");
		expect(throughEditor("x\n\n---\n")).toBe("x\n\n---\n");
	});

	test("editing one cell of an unaligned table leaves the other rows", async () => {
		expect(
			await typeAfter(
				"| a | b |\n|:--|---|\n| 1 | 2 |\n| long cell | y |\n",
				"1",
			),
		).toBe("| a | b |\n|:--|---|\n| 1Z | 2 |\n| long cell | y |\n");
	});

	test("an aligned table is re-aligned when a cell grows", async () => {
		expect(
			await typeAfter("| a   | b |\n| --- | - |\n| 1   | 2 |\n", "1", "Zzzz"),
		).toBe("| a     | b |\n| ----- | - |\n| 1Zzzz | 2 |\n");
	});
});
