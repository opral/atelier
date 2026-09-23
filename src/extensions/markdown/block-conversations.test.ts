import { describe, expect, test } from "vitest";
import { bundledPluginArchives } from "@lix-js/sdk";
import { Editor, type JSONContent } from "@tiptap/core";
import type { Document } from "@opral/zettel-ast";
import { openLix } from "@/test-utils/node-lix-sdk";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import {
	MarkdownWc,
	astToTiptapDoc,
} from "@/extensions/markdown/editor/tiptap-markdown-bridge";
import { parseMarkdown } from "./editor/markdown";
import {
	alignBlocks,
	blockAlignment,
	blockCommentLayout,
	createBlockConversation,
	groupBlockThreads,
	replyToBlockConversation,
	selectBlockComments,
	selectChangedBlockConversationCounts,
	selectCommentAuthors,
	selectMarkdownBlocks,
	stackMarginCards,
	withAuthors,
	type MarkdownBlockRow,
} from "./block-conversations";
import { selectedTopLevelBlock } from "./components/block-comments-context";

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

function editorFor(markdown: string): Editor {
	return new Editor({
		extensions: MarkdownWc() as any,
		content: astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
	});
}

const row = (id: string, kind: string, text?: string): MarkdownBlockRow => ({
	id,
	kind,
	payload_json:
		text === undefined ? {} : { inline: [{ type: "text", value: text }] },
});

describe("alignBlocks", () => {
	test("pairs blocks one to one when kinds agree", () => {
		expect(
			alignBlocks(
				[
					{ kind: "heading", text: "Title" },
					{ kind: "paragraph", text: "Body" },
				],
				[row("a", "heading", "Title"), row("b", "paragraph", "Body")],
			),
		).toEqual([0, 1]);
	});

	test("an unpaired block costs only itself its pairing", () => {
		// The editor holds an empty paragraph the file does not have.
		expect(
			alignBlocks(
				[
					{ kind: "heading", text: "Title" },
					{ kind: "paragraph", text: "" },
					{ kind: "paragraph", text: "Body" },
					{ kind: "list", text: "item" },
				],
				[
					row("a", "heading", "Title"),
					row("b", "paragraph", "Body"),
					row("c", "list"),
				],
			),
		).toEqual([0, -1, 1, 2]);
	});
});

describe("blockCommentLayout", () => {
	test("keeps the margin only while the column and the margin both fit", () => {
		expect(blockCommentLayout(1184)).toBe("margin");
		expect(blockCommentLayout(1183)).toBe("narrow");
		expect(blockCommentLayout(640)).toBe("narrow");
	});
});

describe("stackMarginCards", () => {
	test("pushes an overlapping card below the one above it", () => {
		expect(
			stackMarginCards(
				[
					{ top: 100, height: 80 },
					{ top: 120, height: 60 },
					{ top: 400, height: 40 },
				],
				-1,
			),
		).toEqual([100, 188, 400]);
	});

	test("an active card stays level with its block and the cards above make room", () => {
		expect(
			stackMarginCards(
				[
					{ top: 100, height: 80 },
					{ top: 120, height: 60 },
				],
				1,
			),
		).toEqual([32, 120]);
	});

	test("cards above an active card stay on the page; the active card goes down", () => {
		expect(
			stackMarginCards(
				[
					{ top: 10, height: 80 },
					{ top: 40, height: 60 },
				],
				1,
			),
		).toEqual([10, 98]);
	});
});

describe("selectedTopLevelBlock", () => {
	test("names the block a selection or caret sits in, not a selection across blocks", () => {
		const editor = editorFor("First block.\n\n- one\n- two\n\nLast block.\n");
		try {
			let one = -1;
			let two = -1;
			editor.state.doc.descendants((node, pos) => {
				if (node.isText && node.text === "one") one = pos;
				if (node.isText && node.text === "two") two = pos;
			});
			// Across two items of the same list: still one top-level block.
			editor.commands.setTextSelection({ from: one + 1, to: two + 2 });
			expect(selectedTopLevelBlock(editor.state)).toBe(1);
			editor.commands.setTextSelection(one + 1);
			expect(selectedTopLevelBlock(editor.state)).toBe(1);
			editor.commands.setTextSelection({ from: 2, to: two + 2 });
			expect(selectedTopLevelBlock(editor.state)).toBeNull();
		} finally {
			editor.destroy();
		}
	});
});

describe("block conversations in Lix", () => {
	test("a comment is stored on the block's markdown_node row, branch-local, and replies keep its scope", async () => {
		const lix = await openLix();
		const editor = editorFor(
			"# opral monorepo\n\nHome of Atelier.\n\nResearch moved to /archive.\n",
		);
		try {
			// The rows a conversation attaches to are the Markdown plugin's.
			const plugin = (await bundledPluginArchives()).find(
				(archive) => archive.key === "plugin_markdown",
			);
			if (!plugin) throw new Error("expected the bundled Markdown plugin");
			await lix.execute(
				"INSERT INTO lix_file (path, content) VALUES ($1, $2)",
				[`/.lix/plugins/${plugin.key}.lixplugin`, plugin.archiveBytes],
			);
			const inserted = await lix.execute(
				"INSERT INTO lix_file (path, content) VALUES ($1, $2) RETURNING id",
				[
					"/README.md",
					new TextEncoder().encode(
						"# opral monorepo\n\nHome of Atelier.\n\nResearch moved to /archive.\n",
					),
				],
			);
			const fileId = inserted.rows[0]!.id as string;
			const rows = (await selectMarkdownBlocks(
				lix,
				fileId,
			).execute()) as MarkdownBlockRow[];
			expect(rows.map((block) => block.kind)).toEqual([
				"heading",
				"paragraph",
				"paragraph",
			]);

			// The third editor block is the third row.
			const { rowOfBlock } = blockAlignment(editor.state.doc, rows);
			const nodeId = rowOfBlock[2]!;
			expect(nodeId).toBe(rows[2]!.id);

			const conversationId = await createBlockConversation(
				lix,
				fileId,
				nodeId,
				comment("Moving research breaks the links from gtm/."),
			);
			const stored = await lix.execute(
				"SELECT target = lix_row_ref('markdown_node', $2, $3) AS on_block, lixcol_global FROM lix_conversation WHERE id = $1",
				[conversationId, fileId, nodeId],
			);
			expect(stored.rows[0]?.on_block).toBe(true);
			expect(stored.rows[0]?.lixcol_global).toBe(false);

			await replyToBlockConversation(
				lix,
				conversationId,
				comment("Added stubs in research/."),
			);
			const commentRows = await selectBlockComments(lix, fileId).execute();
			const comments = withAuthors(
				commentRows,
				await selectCommentAuthors(
					lix,
					commentRows.map((entry) => entry.change_id!),
				).execute(),
			);
			expect(comments).toHaveLength(2);
			expect(comments[0]?.author_name).toBeTruthy();
			expect(comments.every((entry) => entry.node_id === nodeId)).toBe(true);
			const scopes = await lix.execute(
				"SELECT lixcol_global FROM lix_comment WHERE conversation_id = $1",
				[conversationId],
			);
			expect(scopes.rows.map((entry) => entry.lixcol_global)).toEqual([
				false,
				false,
			]);
			const threads = groupBlockThreads(comments);
			expect(threads.get(nodeId)?.conversationId).toBe(conversationId);

			// Nothing is written into the file.
			const file = await lix.execute(
				"SELECT content FROM lix_file WHERE id = $1",
				[fileId],
			);
			expect(
				new TextDecoder().decode(file.rows[0]!.content as Uint8Array),
			).toBe(
				"# opral monorepo\n\nHome of Atelier.\n\nResearch moved to /archive.\n",
			);

			// Editing the paragraph keeps the conversation on it.
			await lix.execute("UPDATE lix_file SET content = $2 WHERE id = $1", [
				fileId,
				new TextEncoder().encode(
					"# opral monorepo\n\nHome of Atelier.\n\nResearch moved to /archive. Start there.\n",
				),
			]);
			const afterEdit = await selectBlockComments(lix, fileId).execute();
			expect(afterEdit.map((entry) => entry.node_id)).toEqual([nodeId, nodeId]);

			// History: a checkpoint that changed the commented block counts its
			// conversation for the file; one that changed another block does not.
			const base = await createCheckpoint(lix);
			await lix.execute("UPDATE lix_file SET content = $2 WHERE id = $1", [
				fileId,
				new TextEncoder().encode(
					"# opral monorepo\n\nHome of Atelier.\n\nResearch moved to /archive. Start here.\n",
				),
			]);
			const edited = await createCheckpoint(lix);
			expect(
				await selectChangedBlockConversationCounts(
					lix,
					base.commitId,
					edited.commitId,
				).execute(),
			).toEqual([{ file_id: fileId, conversation_count: 1 }]);
			await lix.execute("UPDATE lix_file SET content = $2 WHERE id = $1", [
				fileId,
				new TextEncoder().encode(
					"# opral monorepo\n\nHome of Atelier and Lix.\n\nResearch moved to /archive. Start here.\n",
				),
			]);
			const elsewhere = await createCheckpoint(lix);
			expect(
				await selectChangedBlockConversationCounts(
					lix,
					edited.commitId,
					elsewhere.commitId,
				).execute(),
			).toEqual([]);
		} finally {
			editor.destroy();
			await lix.close();
		}
	});
});
