// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, test } from "vitest";
import { buildMarkdownFromEditor } from "./build-markdown-from-editor";
import { createEditor } from "./create-editor";
import { parseMarkdown } from "./markdown";
import { MarkdownWc } from "./tiptap-markdown-bridge/markdown-wc";
import { astToTiptapDoc } from "./tiptap-markdown-bridge/mdwc-to-tiptap";

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
		expect(saved).toBe("[a\\\nb](u) endZ\n");
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
