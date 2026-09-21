import { describe, expect, test, vi } from "vitest";
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

test("a click under a document that ends in a table opens a line after it, saved once typed", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("round11_browser_click_below");
	const markdown = "# T\n\nIntro.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n";
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fileId,
			path: "/click-below.md",
			content: new TextEncoder().encode(markdown),
		})
		.execute();
	const editor = createEditor({
		lix,
		fileId,
		initialMarkdown: markdown,
		persistDebounceMs: 0,
	});
	document.body.appendChild(editor.view.dom);
	try {
		// The click lands on the editor's own box, under its last block.
		const event = new MouseEvent("mousedown", {
			bubbles: true,
			cancelable: true,
			button: 0,
			clientY: 10_000,
		});
		editor.view.dom.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		const { selection, doc } = editor.state;
		expect(doc.lastChild?.type.name).toBe("paragraph");
		expect(selection.$from.parent).toBe(doc.lastChild);

		// Nothing typed yet: the file is as it was.
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await readMarkdown(lix, fileId)).toBe(markdown);

		editor.view.dispatch(editor.state.tr.insertText("New line"));
		await waitFor(async () =>
			(await readMarkdown(lix, fileId)).endsWith("\n\nNew line\n"),
		);
		expect(await readMarkdown(lix, fileId)).toBe(`${markdown}\nNew line\n`);
		// Once typed into, it is an ordinary paragraph: emptied again, the empty
		// line is written like any other.
		await waitFor(async () =>
			Object.keys(editor.state.doc.lastChild?.attrs.data ?? {}).every(
				(key) => key === "id",
			),
		);

		// A second click under the (now paragraph-ending) document adds nothing.
		const count = editor.state.doc.childCount;
		editor.view.dom.dispatchEvent(
			new MouseEvent("mousedown", {
				bubbles: true,
				cancelable: true,
				button: 0,
				clientY: 10_000,
			}),
		);
		expect(editor.state.doc.childCount).toBe(count);
		expect(editor.state.selection.$from.parent).toBe(
			editor.state.doc.lastChild,
		);
	} finally {
		editor.view.dom.remove();
		editor.destroy();
		await lix.close();
	}
});

describe("arrow keys into a table keep the caret's column", () => {
	const markdown =
		"Above the table.\n\n| Name | Value | Third |\n| - | - | - |\n| a | 1 | x |\n| b | 2 | y |\n\nBelow the table.\n";

	// Lays the three columns out side by side and puts the caret at `left`;
	// the test DOM has no layout of its own.
	function layOut(editor: ReturnType<typeof createEditor>, left: number) {
		editor.view.coordsAtPos = () =>
			({ left, right: left, top: 0, bottom: 0 }) as never;
		for (const row of editor.view.dom.querySelectorAll("tr"))
			row.querySelectorAll("td, th").forEach((cell, column) => {
				cell.getBoundingClientRect = () =>
					new DOMRect(100 * column, 0, 100, 20);
			});
	}

	function cellText(editor: ReturnType<typeof createEditor>, side: "head") {
		const $pos = editor.state.selection[`$${side}`];
		return $pos.parent.type.name === "tableCell"
			? $pos.parent.textContent
			: null;
	}

	function press(
		editor: ReturnType<typeof createEditor>,
		key: string,
		shiftKey = false,
	) {
		editor.view.dom.dispatchEvent(
			new KeyboardEvent("keydown", {
				key,
				shiftKey,
				bubbles: true,
				cancelable: true,
			}),
		);
	}

	test("down from above lands in the column under the caret, up from below too", async () => {
		const lix = await openLix();
		const editor = createEditor({
			lix,
			initialMarkdown: markdown,
			persistState: false,
		});
		document.body.appendChild(editor.view.dom);
		try {
			layOut(editor, 250);
			editor.commands.setTextSelection(
				textPosition(editor, "Above the table.") + 16,
			);
			press(editor, "ArrowDown");
			expect(cellText(editor, "head")).toBe("Third");

			editor.commands.setTextSelection(
				textPosition(editor, "Below the table.") + 16,
			);
			press(editor, "ArrowUp");
			expect(cellText(editor, "head")).toBe("y");

			layOut(editor, 150);
			editor.commands.setTextSelection(
				textPosition(editor, "Below the table."),
			);
			press(editor, "ArrowUp");
			expect(cellText(editor, "head")).toBe("2");
		} finally {
			editor.view.dom.remove();
			editor.destroy();
			await lix.close();
		}
	});

	test("Shift+ArrowDown grows the selection a row at a time", async () => {
		const lix = await openLix();
		const editor = createEditor({
			lix,
			initialMarkdown: markdown,
			persistState: false,
		});
		document.body.appendChild(editor.view.dom);
		try {
			layOut(editor, 150);
			const anchor = textPosition(editor, "Above the table.") + 16;
			editor.commands.setTextSelection(anchor);
			press(editor, "ArrowDown", true);
			expect(cellText(editor, "head")).toBe("Value");
			press(editor, "ArrowDown", true);
			expect(cellText(editor, "head")).toBe("1");
			press(editor, "ArrowDown", true);
			expect(cellText(editor, "head")).toBe("2");
			expect(editor.state.selection.anchor).toBe(anchor);
		} finally {
			editor.view.dom.remove();
			editor.destroy();
			await lix.close();
		}
	});
});

test("a text selection over an image and a rule marks them as selected too", async () => {
	const lix = await openLix();
	const editor = createEditor({
		lix,
		initialMarkdown:
			"Before.\n\n![Alt](https://example.com/a.png)\n\nBetween.\n\n---\n\nAfter.\n",
		persistState: false,
	});
	try {
		const marked = () =>
			[...editor.view.dom.querySelectorAll(".markdown-in-selection")].map(
				(element) => element.nodeName,
			);
		const from = textPosition(editor, "Before.") + 3;
		const to = textPosition(editor, "After.") + 2;
		editor.commands.setTextSelection({ from, to });
		expect(marked()).toHaveLength(2);
		expect(marked()).toContain("HR");

		// Only blocks the selection covers whole.
		editor.commands.setTextSelection({
			from,
			to: textPosition(editor, "Between.") + 2,
		});
		expect(marked()).toHaveLength(1);
		expect(marked()).not.toContain("HR");

		editor.commands.setTextSelection(from);
		expect(marked()).toHaveLength(0);
	} finally {
		editor.destroy();
		await lix.close();
	}
});
