import { Editor, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import { expect, test } from "vitest";
import { buildNormalizedMarkdownFromTiptapDoc } from "./build-markdown-from-editor";
import {
	buildNormalizedMarkdownIncrementally,
	createIncrementalMarkdownSource,
} from "./incremental-markdown-save";
import { parseMarkdown, parseMarkdownSource, serializeAst } from "./markdown";
import { preserveMarkdownSource } from "./preserve-markdown-source";
import {
	MarkdownWc,
	astToTiptapDoc,
	tiptapDocToAst,
} from "./tiptap-markdown-bridge";
import { JoinAdjacentListsExtension } from "./extensions/join-adjacent-lists";

const CORPUS: Record<string, string> = {
	nonCanonical: [
		"# Long doc",
		"",
		...Array.from({ length: 12 }, (_, i) =>
			[
				`## Section ${i}`,
				"",
				`This is paragraph ${i} with **bold**, _italic_, \`code\` and a [link](https://example.com/${i}).`,
				"",
				`* item a ${i}`,
				`* item b ${i}`,
				"",
				i % 4 === 0
					? "| A | B |\n| - | - |\n| 1 | 2 |\n\n~~~js\nconst v = 1;\n~~~\n"
					: "",
			].join("\n"),
		),
	].join("\n"),
	mixed: `---
title: Mixed
---

# Title heading

Intro paragraph with some text.

Setext heading
==============

| Name  | Value |
| :---- | ----: |
| a     | 1     |

\`\`\`js
const x = 1;

const y = 2;
\`\`\`

![Alt image](https://placehold.co/300x120.png)

___

- [ ] task one
- [x] task two

1) first
2) second

> A quote line
> - quoted item

<div>
  html block
</div>

<!-- a comment

spanning a blank line -->

Line with hard break
next line and trailing\\
break.

<span></span>

Last paragraph.`,
	tight:
		"# Heading\nParagraph right under.\n- a\n- b\n\n+ c\n+ d\n\n1. one\n2. two\n***\nEnd",
	adjacentLists: "- a\n- b\n\n\n* c\n* d\n\n- e\n\nText\n\n1. x\n\n3) y\n",
	nested:
		"- a\n  - b\n    - c\n\n  para in a\n\n- d\n\n> quote\n>\n> > nested\n\n    indented code\n\nafter",
	leadingBlank: "\n\n\n# Starts late\n\ntext\n\n\n\nmore text   \n\n",
	noFinalNewline: "one\n\ntwo\n\n```\ncode\n```",
	unclosedFence: "intro\n\n```\nnever closed\n\nstill code",
	definitions:
		"See [the docs][d] and [^1].\n\nOther.\n\n[d]: https://example.com\n\n[^1]: A note.\n",
	crlf: "# CRLF\r\n\r\nText here.\r\n\r\n- a\r\n- b\r\n",
	sourceStyles:
		"Intro\n\n---\n\nSetext\n------\n\n+ plus\n+ bullets\n\n3) three\n4) four\n\n-   wide indent\n-   items\n\n- loose\n\n- list\n- tight tail\n\nSee https://example.com and www.example.com or me@example.com.\n\nLine\\\nbreak and&nbsp;space &copy;\n\n|a|b|\n|-|-|\n|1|2|3|\n\n````md\n```\ninner\n```\n````\n\n* * *\n\nend",
	escapes:
		"1\\. not a list\n\n\\# not a heading\n\na * b * c and _under_score_ and <b>inline</b>\n\n&copy; entity",
};

function mulberry32(seed: number) {
	return () => {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function canonical(text: string): string {
	return serializeAst(
		tiptapDocToAst(astToTiptapDoc(parseMarkdownSource(text) as never)),
	);
}

function createTestEditor(markdown: string): Editor {
	return new Editor({
		extensions: [...MarkdownWc(), JoinAdjacentListsExtension, History],
		content: astToTiptapDoc(parseMarkdown(markdown) as never) as JSONContent,
	});
}

function textPositions(editor: Editor): number[] {
	const positions: number[] = [];
	editor.state.doc.descendants((node, pos) => {
		if (node.isTextblock) {
			for (let offset = 0; offset <= node.content.size; offset++)
				positions.push(pos + 1 + offset);
			return false;
		}
		return true;
	});
	return positions;
}

const TYPED = [
	"x",
	" word",
	"*",
	"_",
	"#",
	"1. ",
	"`",
	"- ",
	"a  b",
	"---",
	"```",
	"<div>",
	"> ",
	"|",
	"[x]: y",
	"\\",
];
const SEEDS = Number(process.env.MARKDOWN_SAVE_FUZZ_SEEDS ?? 3);

function randomEdit(editor: Editor, random: () => number): void {
	const positions = textPositions(editor);
	if (positions.length === 0) return;
	const pick = () => positions[Math.floor(random() * positions.length)]!;
	const at = pick();
	const chain = () => editor.chain().setTextSelection(at);
	switch (Math.floor(random() * 11)) {
		case 0:
		case 1:
		case 2:
			chain()
				.insertContent(TYPED[Math.floor(random() * TYPED.length)]!)
				.run();
			return;
		case 3: {
			const other = pick();
			editor
				.chain()
				.setTextSelection({
					from: Math.min(at, other),
					to: Math.max(at, other),
				})
				.deleteSelection()
				.run();
			return;
		}
		case 4:
			chain().splitBlock().run();
			return;
		case 5:
			chain().joinBackward().run();
			return;
		case 6:
			(chain() as any).wrapInList("bulletList").run();
			return;
		case 7:
			chain().setNode("heading", { level: 2 }).run();
			return;
		case 8: {
			// Remove a whole top-level block.
			const doc = editor.state.doc;
			if (doc.childCount < 2) return;
			const index = Math.floor(random() * doc.childCount);
			let from = 0;
			for (let i = 0; i < index; i++) from += doc.child(i).nodeSize;
			editor.view.dispatch(
				editor.state.tr.delete(from, from + doc.child(index).nodeSize),
			);
			return;
		}
		case 9: {
			// Append a paragraph after the last block.
			const end = editor.state.doc.content.size;
			editor
				.chain()
				.insertContentAt(end, {
					type: "paragraph",
					content: [{ type: "text", text: "appended" }],
				})
				.run();
			return;
		}
		default:
			editor.commands.undo();
	}
}

test("per-block serialization equals whole-document serialization under random edits", () => {
	for (const [name, markdown] of Object.entries(CORPUS)) {
		for (let seed = 1; seed <= SEEDS; seed++) {
			const random = mulberry32(seed * 7919 + name.length);
			const editor = createTestEditor(markdown);
			try {
				for (let step = 0; step < 60; step++) {
					const doc = editor.state.doc;
					expect(
						buildNormalizedMarkdownIncrementally(doc),
						`${name}/${seed} step ${step}`,
					).toBe(buildNormalizedMarkdownFromTiptapDoc(doc));
					randomEdit(editor, random);
				}
			} finally {
				editor.destroy();
			}
		}
	}
});

test("incremental source preservation saves the edited document and keeps untouched spelling", () => {
	let compared = 0;
	let identical = 0;
	for (const [name, markdown] of Object.entries(CORPUS)) {
		for (let seed = 1; seed <= SEEDS; seed++) {
			const random = mulberry32(seed * 104729 + name.length);
			const editor = createTestEditor(markdown);
			const source = createIncrementalMarkdownSource();
			let original = markdown;
			source.prime(original, editor.state.doc);
			try {
				for (let step = 0; step < 40; step++) {
					randomEdit(editor, random);
					const doc = editor.state.doc;
					const normalized = buildNormalizedMarkdownFromTiptapDoc(doc);
					const saved = source.preserve(original, doc, normalized);
					const reference = preserveMarkdownSource(original, normalized);
					const label = `${name}/${seed} step ${step}\n--- original\n${original}\n--- saved\n${saved.markdown}\n--- reference\n${reference}`;
					// The file must hold exactly the document on screen.
					expect(canonical(saved.markdown), label).toBe(canonical(normalized));
					compared += 1;
					if (saved.markdown === reference) identical += 1;
					original = saved.markdown;
					saved.accept();
				}
			} finally {
				source.dispose();
				editor.destroy();
			}
		}
	}
	expect(identical / compared).toBeGreaterThan(0.9);
});

test("a save after an edit reuses the spelling of every other block", () => {
	const markdown = CORPUS.nonCanonical!;
	const editor = createTestEditor(markdown);
	const source = createIncrementalMarkdownSource();
	source.prime(markdown, editor.state.doc);
	try {
		const position = textPositions(editor)[3]!;
		editor.chain().setTextSelection(position).insertContent("Typed ").run();
		const doc = editor.state.doc;
		const saved = source.preserve(
			markdown,
			doc,
			buildNormalizedMarkdownFromTiptapDoc(doc),
		);
		expect(saved.markdown).toBe(
			markdown.replace("# Long doc", `# ${doc.child(0).textContent}`),
		);
	} finally {
		source.dispose();
		editor.destroy();
	}
});

test("the empty paragraph a lone document serializes to still round-trips", () => {
	const editor = createTestEditor("");
	try {
		expect(buildNormalizedMarkdownIncrementally(editor.state.doc)).toBe(
			buildNormalizedMarkdownFromTiptapDoc(editor.state.doc),
		);
	} finally {
		editor.destroy();
	}
});
