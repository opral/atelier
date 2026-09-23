import { describe, expect, test } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import {
	commentParagraphs,
	createCommitConversation,
	replyToConversation,
	selectCheckpointConversations,
	selectCommitConversations,
	selectConversationComments,
} from "./commit-conversations";

describe("commit conversations", () => {
	test("creates a titled global discussion and replies from the local session", async () => {
		const lix = await openLix();
		try {
			const { commitId } = await createCheckpoint(lix);
			await createCommitConversation(
				lix,
				commitId,
				"Launch plan",
				"First note\n\nSecond paragraph",
			);
			const conversations = await selectCommitConversations(
				lix,
				commitId,
			).execute();
			expect(conversations).toHaveLength(1);
			expect(conversations[0]?.title).toBe("Launch plan");
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
			await replyToConversation(lix, conversationId, "A reply");
			comments = await selectConversationComments(
				lix,
				conversationId,
			).execute();
			expect(comments).toHaveLength(2);
			expect(commentParagraphs(comments[1]?.body)).toEqual(["A reply"]);
			const scopes = await lix.execute<{ lixcol_global: boolean }>(
				"SELECT lixcol_global FROM lix_conversation WHERE id=$1",
				[conversationId],
			);
			expect(scopes.rows[0]?.lixcol_global).toBe(true);
		} finally {
			await lix.close();
		}
	});

	test("allows a conversation without a title", async () => {
		const lix = await openLix();
		try {
			const { commitId } = await createCheckpoint(lix);
			await createCommitConversation(lix, commitId, "", "Untitled discussion");
			expect(
				(await selectCommitConversations(lix, commitId).execute())[0]?.title,
			).toBeNull();
		} finally {
			await lix.close();
		}
	});
});
