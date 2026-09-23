import { describe, expect, test } from "vitest";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import {
	commentBody,
	createCommitConversation,
	replyToConversation,
	selectCommitConversations,
	selectConversationComments,
	selectConversationCounts,
	setCommitConversationTitle,
} from "@/extensions/history/commit-conversations";
import {
	conversationsResolvable,
	deleteComment,
	selectActiveAccountId,
} from "./conversation-writes";

/** A comment written by someone else: their own account, their session. */
async function replyAs(
	lix: Lix,
	name: string,
	conversationId: string,
	text: string,
): Promise<void> {
	const accountId = crypto.randomUUID();
	await lix.execute(
		"INSERT INTO lix_account (id, kind, name, status, lixcol_global) VALUES ($1, 'human', $2, 'active', true)",
		[accountId, name],
	);
	const session = await lix.openAnotherSession({ accountId });
	try {
		await replyToConversation(session, conversationId, commentBody(text));
	} finally {
		await session.close();
	}
}

async function conversationExists(lix: Lix, id: string): Promise<boolean> {
	const result = await lix.execute(
		"SELECT id FROM lix_conversation WHERE id = $1",
		[id],
	);
	return result.rows.length > 0;
}

describe("deleteComment", () => {
	test("deletes the reader's comment and the thread's count follows", async () => {
		const lix = await openLix();
		try {
			const { commitId } = await createCheckpoint(lix);
			await createCommitConversation(lix, commitId, commentBody("First"));
			const conversation = (
				await selectCommitConversations(lix, commitId).execute()
			)[0]!;
			await replyToConversation(lix, conversation.id, commentBody("Second"));
			const [first] = await selectConversationComments(
				lix,
				conversation.id,
			).execute();
			const accountId = (await selectActiveAccountId(lix).execute())[0]?.id;
			expect(first?.author_id).toBe(accountId);

			const result = await deleteComment(lix, first!.id);
			expect(result).toEqual({
				conversationId: conversation.id,
				conversationDeleted: false,
			});
			const left = await selectConversationComments(
				lix,
				conversation.id,
			).execute();
			expect(left.map((comment) => comment.id)).not.toContain(first!.id);
			expect(left).toHaveLength(1);
			expect(
				(await selectConversationCounts(lix, [conversation.id]).execute())[0]
					?.comment_count,
			).toBe(1);
		} finally {
			await lix.close();
		}
	});

	test("the last comment takes an untitled conversation with it", async () => {
		const lix = await openLix();
		try {
			const { commitId } = await createCheckpoint(lix);
			await createCommitConversation(lix, commitId, commentBody("Only one"));
			const conversation = (
				await selectCommitConversations(lix, commitId).execute()
			)[0]!;
			const [only] = await selectConversationComments(
				lix,
				conversation.id,
			).execute();
			const result = await deleteComment(lix, only!.id);
			expect(result.conversationDeleted).toBe(true);
			expect(await conversationExists(lix, conversation.id)).toBe(false);
			expect(await selectCommitConversations(lix, commitId).execute()).toEqual(
				[],
			);
		} finally {
			await lix.close();
		}
	});

	test("a titled conversation stays when its last comment goes", async () => {
		const lix = await openLix();
		try {
			const { commitId } = await createCheckpoint(lix);
			await setCommitConversationTitle(lix, commitId, null, "Sent to legal");
			const conversation = (
				await selectCommitConversations(lix, commitId).execute()
			)[0]!;
			await replyToConversation(lix, conversation.id, commentBody("Signed"));
			const [only] = await selectConversationComments(
				lix,
				conversation.id,
			).execute();
			const result = await deleteComment(lix, only!.id);
			expect(result.conversationDeleted).toBe(false);
			const kept = await selectCommitConversations(lix, commitId).execute();
			expect(kept.map((row) => row.title)).toEqual(["Sent to legal"]);
			expect(
				await selectConversationCounts(lix, [conversation.id]).execute(),
			).toEqual([]);
		} finally {
			await lix.close();
		}
	});

	test("keeps a conversation that still has someone else's comment", async () => {
		const lix = await openLix();
		try {
			const { commitId } = await createCheckpoint(lix);
			await createCommitConversation(lix, commitId, commentBody("Mine"));
			const conversation = (
				await selectCommitConversations(lix, commitId).execute()
			)[0]!;
			await replyAs(lix, "Mara", conversation.id, "Hers");
			const [mine, hers] = await selectConversationComments(
				lix,
				conversation.id,
			).execute();
			expect(hers?.author_name).toBe("Mara");
			expect(hers?.author_id).not.toBe(mine?.author_id);
			// Only its author may delete a comment.
			await expect(deleteComment(lix, hers!.id)).rejects.toThrow(
				"Only its author",
			);
			await deleteComment(lix, mine!.id);
			expect(await conversationExists(lix, conversation.id)).toBe(true);
			expect(
				(await selectConversationComments(lix, conversation.id).execute()).map(
					(comment) => comment.id,
				),
			).toEqual([hers!.id]);
		} finally {
			await lix.close();
		}
	});

	test("a branch-local comment is deleted in its own scope", async () => {
		const lix = await openLix();
		try {
			const conversationId = crypto.randomUUID();
			const commentId = crypto.randomUUID();
			await lix.execute(
				"INSERT INTO lix_conversation (id, target) VALUES ($1, NULL)",
				[conversationId],
			);
			await lix.execute(
				"INSERT INTO lix_comment (id, conversation_id, body) VALUES ($1, $2, $3::jsonb)",
				[commentId, conversationId, JSON.stringify(commentBody("Local"))],
			);
			const result = await deleteComment(lix, commentId);
			expect(result).toEqual({ conversationId, conversationDeleted: true });
			expect(await conversationExists(lix, conversationId)).toBe(false);
		} finally {
			await lix.close();
		}
	});

	test("a comment that is already gone says so", async () => {
		const lix = await openLix();
		try {
			await expect(deleteComment(lix, crypto.randomUUID())).rejects.toThrow(
				"no longer exists",
			);
		} finally {
			await lix.close();
		}
	});
});

describe("conversationsResolvable", () => {
	test("is false until lix_conversation has a resolved column", async () => {
		const lix = await openLix();
		try {
			const columns = (
				await lix.execute("SELECT * FROM lix_conversation LIMIT 0")
			).columns.map((column) => column.name);
			expect(await conversationsResolvable(lix)).toBe(
				columns.includes("resolved"),
			);
		} finally {
			await lix.close();
		}
	});
});
