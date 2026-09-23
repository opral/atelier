import { describe, expect, test } from "vitest";
import { toHtml } from "@opral/zettel-html";
import type { Document } from "@opral/zettel-ast";
import { bundledPluginArchives } from "@lix-js/sdk";
import { openLix } from "@/test-utils/node-lix-sdk";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import {
	selectCheckpointFileConversationCounts,
	selectInstalledCommentableRelations,
	commentParagraphs,
	commentBody,
	parseCommentBody,
	createCommitConversation,
	replyToConversation,
	selectCheckpointConversations,
	selectCommitConversations,
	selectConversationCounts,
	selectConversationComments,
	setCommitConversationTitle,
} from "./commit-conversations";

describe("commit conversations", () => {
	test("creates an untitled global discussion and replies from the local session", async () => {
		const lix = await openLix();
		try {
			const { commitId } = await createCheckpoint(lix);
			await createCommitConversation(
				lix,
				commitId,
				commentBody("First note\n\nSecond paragraph"),
			);
			const conversations = await selectCommitConversations(
				lix,
				commitId,
			).execute();
			expect(conversations).toHaveLength(1);
			// A comment never names the checkpoint; only the reader's title does.
			expect(conversations[0]?.title).toBeNull();
			expect(
				(await selectCheckpointConversations(lix, [commitId]).execute())[0]
					?.commit_id,
			).toBe(commitId);
			const conversationId = conversations[0]!.id;
			let comments = await selectConversationComments(
				lix,
				conversationId,
			).execute();
			expect(comments).toHaveLength(1);
			expect(commentParagraphs(comments[0]?.body)).toEqual([
				"First note",
				"Second paragraph",
			]);
			await replyToConversation(lix, conversationId, commentBody("A reply"));
			comments = await selectConversationComments(
				lix,
				conversationId,
			).execute();
			expect(comments).toHaveLength(2);
			expect(commentParagraphs(comments[1]?.body)).toEqual(["A reply"]);
			expect(
				(await selectConversationCounts(lix, [conversationId]).execute())[0]
					?.comment_count,
			).toBe(2);
			const scopes = await lix.execute<{ lixcol_global: boolean }>(
				"SELECT lixcol_global FROM lix_conversation WHERE id=$1",
				[conversationId],
			);
			expect(scopes.rows[0]?.lixcol_global).toBe(true);
		} finally {
			await lix.close();
		}
	});

	test("creates and clears a checkpoint title without posting a comment", async () => {
		const lix = await openLix();
		try {
			const { commitId } = await createCheckpoint(lix);
			await setCommitConversationTitle(lix, commitId, null, "Legal sign-off");
			const conversation = (
				await selectCommitConversations(lix, commitId).execute()
			)[0]!;
			expect(conversation.title).toBe("Legal sign-off");
			expect(
				await selectConversationComments(lix, conversation.id).execute(),
			).toHaveLength(0);
			await setCommitConversationTitle(lix, commitId, conversation.id, "");
			expect(
				(await selectCommitConversations(lix, commitId).execute())[0]?.title,
			).toBeNull();
			await replyToConversation(
				lix,
				conversation.id,
				commentBody("First comment"),
			);
			expect(
				(await selectCommitConversations(lix, commitId).execute())[0]?.title,
			).toBeNull();
		} finally {
			await lix.close();
		}
	});

	test("stores Zettel marks and links without flattening them to text", async () => {
		const lix = await openLix();
		try {
			const { commitId } = await createCheckpoint(lix);
			const body: Document = {
				_type: "zettel_doc",
				blocks: [
					{
						_type: "zettel_block",
						_key: "p1",
						style: "normal",
						markDefs: [
							{
								_type: "zettel_link",
								_key: "link1",
								href: "https://example.com",
							},
						],
						children: [
							{
								_type: "zettel_span",
								_key: "s1",
								text: "Review",
								marks: ["strong", "link1"],
							},
						],
					},
				],
			};
			await createCommitConversation(lix, commitId, body);
			const conversation = (
				await selectCommitConversations(lix, commitId).execute()
			)[0]!;
			const stored = (
				await selectConversationComments(lix, conversation.id).execute()
			)[0]!;
			expect(parseCommentBody(stored.body)).toEqual(body);
			expect(toHtml(parseCommentBody(stored.body))).toContain(
				"https://example.com",
			);
			expect(toHtml(parseCommentBody(stored.body))).toContain("<strong>");
		} finally {
			await lix.close();
		}
	});
});

describe("per-file conversation counts under a checkpoint", () => {
	test("counts conversations on the Markdown blocks a checkpoint changed", async () => {
		const lix = await openLix();
		try {
			const plugin = (await bundledPluginArchives()).find(
				(archive) => archive.key === "plugin_markdown",
			);
			if (!plugin) throw new Error("expected the bundled Markdown plugin");
			await lix.execute(
				"INSERT INTO lix_file (path, content) VALUES ($1, $2)",
				[`/.lix/plugins/${plugin.key}.lixplugin`, plugin.archiveBytes],
			);
			const encode = (text: string) => new TextEncoder().encode(text);
			const fileId = (
				await lix.execute(
					"INSERT INTO lix_file (path, content) VALUES ($1, $2) RETURNING id",
					["/README.md", encode("# Title\n\nFirst.\n\nSecond.\n")],
				)
			).rows[0]!.id as string;
			const before = await createCheckpoint(lix);
			await lix.execute("UPDATE lix_file SET content = $2 WHERE id = $1", [
				fileId,
				encode("# Title\n\nFirst, edited.\n\nSecond.\n"),
			]);
			const after = await createCheckpoint(lix);

			const relations = (
				await selectInstalledCommentableRelations(lix).execute()
			).map((row) => row.schema_key);
			expect(relations).toEqual(["markdown_node"]);
			const changed = await lix.execute(
				"SELECT id FROM lix_diff('markdown_node', $1, $2) WHERE to_kind = 'paragraph'",
				[before.commitId, after.commitId],
			);
			expect(changed.rows).toHaveLength(1);
			const changedId = String(changed.rows[0]!.id);
			const unchanged = await lix.execute(
				"SELECT id FROM markdown_node WHERE lixcol_file_id = $1 AND kind = 'paragraph' AND id <> $2",
				[fileId, changedId],
			);
			for (const nodeId of [changedId, String(unchanged.rows[0]!.id)])
				await lix.execute(
					"INSERT INTO lix_conversation (id, target) VALUES ($1, lix_row_ref('markdown_node', $2, $3))",
					[crypto.randomUUID(), fileId, nodeId],
				);

			const counts = await selectCheckpointFileConversationCounts(
				lix,
				before.commitId,
				after.commitId,
				relations,
			).execute();
			// Only the edited paragraph's conversation belongs to this checkpoint.
			expect(counts).toEqual([{ file_id: fileId, conversation_count: 1 }]);
		} finally {
			await lix.close();
		}
	});
});
