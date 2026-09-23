import { Suspense } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { bundledPluginArchives } from "@lix-js/sdk";
import type { Editor } from "@tiptap/core";
import type { Document } from "@opral/zettel-ast";
import { LixProvider } from "@/lib/lix-react";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { MarkdownView } from "./index";
import {
	blockRowText,
	createBlockConversation,
	selectMarkdownBlocks,
	type MarkdownBlockRow,
} from "./block-conversations";

/*
 * Block conversations against the real Markdown plugin: the editor saves
 * the file, the plugin re-derives its rows, and a conversation must stay on
 * the block the writer sees through merges, deletions, undo and twins.
 */

function comment(text: string): Document {
	return {
		_type: "zettel_doc",
		blocks: [
			{
				_type: "zettel_block",
				_key: crypto.randomUUID(),
				style: "normal",
				markDefs: [],
				children: [
					{ _type: "zettel_span", _key: crypto.randomUUID(), text, marks: [] },
				],
			},
		],
	};
}

async function setup(
	markdown: string,
	commentedText: string,
	{ last = false }: { readonly last?: boolean } = {},
) {
	const lix = await openLix();
	const plugin = (await bundledPluginArchives()).find(
		(archive) => archive.key === "plugin_markdown",
	);
	if (!plugin) throw new Error("expected the bundled Markdown plugin");
	await lix.execute("INSERT INTO lix_file (path, content) VALUES ($1, $2)", [
		`/.lix/plugins/${plugin.key}.lixplugin`,
		plugin.archiveBytes,
	]);
	const inserted = await lix.execute(
		"INSERT INTO lix_file (path, content) VALUES ($1, $2) RETURNING id",
		["/doc.md", new TextEncoder().encode(markdown)],
	);
	const fileId = inserted.rows[0]!.id as string;
	const rows = (await selectMarkdownBlocks(
		lix,
		fileId,
	).execute()) as MarkdownBlockRow[];
	const holding = rows.filter(
		(candidate) => blockRowText(candidate) === commentedText,
	);
	const row = last ? holding.at(-1) : holding[0];
	if (!row) throw new Error(`no row holds "${commentedText}"`);
	const conversationId = await createBlockConversation(
		lix,
		fileId,
		row.id,
		comment("On this block"),
	);
	let utils: ReturnType<typeof render> | undefined;
	await act(async () => {
		utils = render(
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<MarkdownView fileId={fileId} filePath="/doc.md" />
				</Suspense>
			</LixProvider>,
		);
	});
	const editor = await waitFor(() => {
		const dom = document.querySelector(".ProseMirror") as
			| (HTMLElement & { editor?: Editor })
			| null;
		if (!dom?.editor) throw new Error("no editor yet");
		return dom.editor;
	});
	// The conversation is known to the editor once its block is marked.
	await waitFor(() =>
		expect(
			document.querySelector(".ProseMirror > [data-block-comment]"),
		).not.toBeNull(),
	);
	return {
		lix,
		fileId,
		conversationId,
		editor,
		async close() {
			await act(async () => utils?.unmount());
			await lix.close();
		},
	};
}

/** The text of the block the conversation is on, or null when it is gone. */
async function targetText(lix: Lix, conversationId: string) {
	const result = await lix.execute(
		"SELECT n.id, n.kind, n.payload_json FROM lix_conversation c JOIN markdown_node n ON c.target = lix_row_ref('markdown_node', n.lixcol_file_id, n.id) WHERE c.id = $1",
		[conversationId],
	);
	const row = result.rows[0] as MarkdownBlockRow | undefined;
	return row ? blockRowText(row) : null;
}

async function fileText(lix: Lix, fileId: string) {
	const result = await lix.execute(
		"SELECT content FROM lix_file WHERE id = $1",
		[fileId],
	);
	return new TextDecoder().decode(result.rows[0]!.content as Uint8Array);
}

/** Position just inside the start of the top-level block holding `text`. */
function startOf(editor: Editor, text: string): number {
	let found = -1;
	editor.state.doc.forEach((node, offset) => {
		if (found < 0 && node.textContent === text) found = offset + 1;
	});
	if (found < 0) throw new Error(`no block holds "${text}"`);
	return found;
}

describe("block conversations follow their block through edits", () => {
	test("a merge hands the conversation to the block merged into; undo gives it back", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			await act(async () => {
				editor
					.chain()
					.setTextSelection(startOf(editor, "Second para."))
					.joinBackward()
					.run();
			});
			await waitFor(async () =>
				expect(await fileText(lix, fileId)).toContain(
					"First para.Second para.",
				),
			);
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe(
					"First para.Second para.",
				),
			);

			await act(async () => {
				editor.commands.undo();
			});
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Second para."),
			);
		} finally {
			await view.close();
		}
	});

	test("deleting the block keeps the conversation on the block that takes its place", async () => {
		const view = await setup(
			"# Title\n\nFirst para.\n\nSecond para.\n\nTail.\n",
			"Second para.",
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			await act(async () => {
				const from = startOf(editor, "Second para.") - 1;
				const to = from + editor.state.doc.nodeAt(from)!.nodeSize;
				editor.view.dispatch(editor.state.tr.delete(from, to));
			});
			await waitFor(async () =>
				expect(await fileText(lix, fileId)).not.toContain("Second para."),
			);
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Tail."),
			);
		} finally {
			await view.close();
		}
	});

	test("deleting one of two identical paragraphs keeps the other's conversation", async () => {
		// The conversation is on the second twin; the writer deletes the first.
		// The plugin keeps rows by position, so the surviving text keeps the
		// first twin's row and the second twin's row (the conversation's) goes.
		const view = await setup(
			"# Title\n\nIntro.\n\nSame text.\n\nSame text.\n\nOutro.\n",
			"Same text.",
			{ last: true },
		);
		try {
			const { editor, lix, fileId, conversationId } = view;
			const first = startOf(editor, "Same text.") - 1;
			await act(async () => {
				editor.view.dispatch(
					editor.state.tr.delete(
						first,
						first + editor.state.doc.nodeAt(first)!.nodeSize,
					),
				);
			});
			await waitFor(async () =>
				expect(
					(await fileText(lix, fileId)).match(/Same text\./g),
				).toHaveLength(1),
			);
			await waitFor(async () =>
				expect(await targetText(lix, conversationId)).toBe("Same text."),
			);
		} finally {
			await view.close();
		}
	});

	test("an external write that adds blocks above leaves the conversation on its block", async () => {
		const view = await setup(
			"# Title\n\nHome.\n\nResearch.\n\n## Releases\n\nTail.\n",
			"Research.",
		);
		try {
			const { lix, fileId, conversationId, editor } = view;
			await lix.execute(
				"UPDATE lix_file SET content = $2 WHERE id = $1",
				[
					fileId,
					new TextEncoder().encode(
						"# New heading\n\nIntro by an agent.\n\nHome.\n\nResearch.\n\n## Releases\n\nTail.\n",
					),
				],
				{ originKey: "an-agent" },
			);
			await waitFor(() =>
				expect(editor.state.doc.textContent).toContain("Intro by an agent."),
			);
			// A later edit of the writer's own that restructures the document.
			await act(async () => {
				editor
					.chain()
					.setTextSelection(startOf(editor, "Tail.") + 5)
					.splitBlock()
					.insertContent("More.")
					.run();
			});
			await waitFor(async () =>
				expect(await fileText(lix, fileId)).toContain("More."),
			);
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(await targetText(lix, conversationId)).toBe("Research.");
		} finally {
			await view.close();
		}
	});
});
