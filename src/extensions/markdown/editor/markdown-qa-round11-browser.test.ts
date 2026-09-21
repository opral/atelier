import { expect, test, vi } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { qb } from "@/lib/lix-kysely";
import { createEditor } from "./create-editor";

// Counts the Markdown handed to the parser from outside its module: the
// save path's source preservation and alignment.
const parsed = vi.hoisted(() => ({ characters: 0 }));
vi.mock("./markdown", async (importOriginal) => {
	const original = await importOriginal<typeof import("./markdown")>();
	return {
		...original,
		parseMarkdownSource: (markdown: string) => {
			parsed.characters += markdown.length;
			return original.parseMarkdownSource(markdown);
		},
		parseMarkdownSourceRaw: (markdown: string) => {
			parsed.characters += markdown.length;
			return original.parseMarkdownSourceRaw(markdown);
		},
	};
});

function longDocument(sections: number): string {
	let markdown = "# Long doc\n\n";
	for (let i = 0; i < sections; i++) {
		markdown += `## Section ${i}\n\nParagraph ${i} with **bold**, _italic_ and a [link](https://example.com/${i}).\n\n* item a ${i}\n* item b ${i}\n\n`;
		if (i % 10 === 0)
			markdown +=
				"| A | B |\n| - | - |\n| 1 | 2 |\n\n~~~js\nconst v = 1;\n~~~\n\n";
	}
	return markdown;
}

async function readMarkdown(
	lix: Awaited<ReturnType<typeof openLix>>,
	fileId: string,
): Promise<string> {
	const row = await qb(lix)
		.selectFrom("lix_file")
		.where("id", "=", fileId)
		.select("content")
		.executeTakeFirst();
	return new TextDecoder().decode(row?.content ?? new Uint8Array());
}

async function waitFor(check: () => Promise<boolean>): Promise<void> {
	const deadline = Date.now() + 10_000;
	while (!(await check())) {
		if (Date.now() > deadline) throw new Error("timed out");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function textPosition(
	editor: ReturnType<typeof createEditor>,
	needle: string,
): number {
	let found = -1;
	editor.state.doc.descendants((node, pos) => {
		if (found >= 0) return false;
		const index = node.isText ? (node.text ?? "").indexOf(needle) : -1;
		if (index >= 0) found = pos + index;
		return found < 0;
	});
	return found;
}

test("a keystroke in a long document saves without re-reading the whole file", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("round11_browser_long_save");
	const markdown = longDocument(150);
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/long.md",
			content: new TextEncoder().encode(markdown),
		})
		.execute();
	const editor = createEditor({
		lix,
		fileId,
		initialMarkdown: markdown,
		persistDebounceMs: 0,
	});
	try {
		// The first save lines the file up with the document (in a browser
		// that happens while idle, before anyone types).
		const first = textPosition(editor, "Paragraph 3 with") + 13;
		editor.view.dispatch(editor.state.tr.insertText("A", first));
		await waitFor(async () =>
			(await readMarkdown(lix, fileId)).includes("Paragraph 3 wAith"),
		);

		parsed.characters = 0;
		const at = textPosition(editor, "Paragraph 90 with") + 14;
		editor.view.dispatch(editor.state.tr.insertText("B", at));
		await waitFor(async () =>
			(await readMarkdown(lix, fileId)).includes("Paragraph 90 wBith"),
		);

		const saved = await readMarkdown(lix, fileId);
		// The two edited paragraphs are written the editor's way; every other
		// block keeps its spelling.
		expect(saved).toBe(
			markdown
				.replace(
					"Paragraph 3 with **bold**, _italic_",
					"Paragraph 3 wAith **bold**, *italic*",
				)
				.replace(
					"Paragraph 90 with **bold**, _italic_",
					"Paragraph 90 wBith **bold**, *italic*",
				),
		);
		// Around the edited block, not the whole file several times over.
		expect(parsed.characters).toBeLessThan(markdown.length / 5);
	} finally {
		editor.destroy();
		await lix.close();
	}
});

test("a long document's first keystroke does not rewrite every block", async () => {
	const lix = await openLix();
	const editor = createEditor({
		lix,
		initialMarkdown: longDocument(20),
		persistState: false,
	});
	try {
		let missing = 0;
		editor.state.doc.descendants((node) => {
			const attrs = node.type.spec.attrs;
			if (attrs && "data" in attrs && !node.attrs.data?.id) missing += 1;
		});
		expect(missing).toBe(0);

		const steps: number[] = [];
		editor.on("transaction", ({ transaction, appendedTransactions }) => {
			steps.push(
				[transaction, ...appendedTransactions].reduce(
					(count, tr) => count + tr.steps.length,
					0,
				),
			);
		});
		const at = textPosition(editor, "Paragraph 3 with");
		editor.view.dispatch(editor.state.tr.insertText("x", at));
		expect(steps).toEqual([1]);
	} finally {
		editor.destroy();
		await lix.close();
	}
});
