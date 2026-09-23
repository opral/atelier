import { describe, expect, test } from "vitest";
import { toHtml } from "@opral/zettel-html";
import type { Document } from "@opral/zettel-ast";
import { openLix } from "@/test-utils/node-lix-sdk";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import {
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
	test("creates a titled global discussion and replies from the local session", async () => {
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
			expect(conversations[0]?.title).toBe("First note");
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
