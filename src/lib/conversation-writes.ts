import type { Lix } from "@lix-js/sdk";
import { assertDocument, type Document } from "@opral/zettel-ast";
import { toPlainText } from "@opral/zettel-lexical";
import { qb, sql } from "@/lib/lix-kysely";

/*
 * Writes that act on a comment or a conversation wherever it is shown:
 * History's checkpoints, a document's margin, the conversation page. Each
 * takes the row's own scope (`lixcol_global`) rather than the caller's
 * guess, so one function serves checkpoint and block conversations alike.
 */

/** The account the reader writes as: Lix signs every change with it. */
export function selectActiveAccountId(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_account")
		.select("id")
		.where("id", "=", sql<string>`lix_active_account_id()`)
		.$castTo<{ id: string }>();
}

type Row = Record<string, unknown>;

/**
 * Deletes a comment the reader wrote. A conversation left with no comments
 * and no title goes with it, so its block loses its mark and its count; a
 * titled one (a checkpoint's name) stays. One transaction: the thread
 * never shows a conversation that has lost its last comment.
 */
export async function deleteComment(
	lix: Lix,
	commentId: string,
): Promise<{
	readonly conversationId: string;
	readonly conversationDeleted: boolean;
}> {
	const transaction = await lix.beginTransaction();
	try {
		const found = await transaction.execute(
			"SELECT comment.conversation_id AS conversation_id, comment.lixcol_global AS global, change.account_id = lix_active_account_id() AS own FROM lix_comment AS comment LEFT JOIN lix_change AS change ON change.id = comment.lixcol_change_id WHERE comment.id = $1",
			[commentId],
		);
		const row = found.rows[0] as Row | undefined;
		if (!row) throw new Error("This comment no longer exists.");
		// Lix has no permissions to ask; the thread only offers Delete on the
		// reader's own comments, and this keeps any other caller to that too.
		if (row.own !== true)
			throw new Error("Only its author can delete a comment.");
		const conversationId = String(row.conversation_id);
		const global = row.global === true;
		await transaction.execute(
			"DELETE FROM lix_comment WHERE id = $1 AND lixcol_global = $2",
			[commentId, global],
		);
		const left = await transaction.execute(
			"SELECT id FROM lix_comment WHERE conversation_id = $1 AND lixcol_global = $2 LIMIT 1",
			[conversationId, global],
		);
		let conversationDeleted = false;
		if (left.rows.length === 0) {
			const removed = await transaction.execute(
				"DELETE FROM lix_conversation WHERE id = $1 AND lixcol_global = $2 AND (title IS NULL OR title = '') RETURNING id",
				[conversationId, global],
			);
			conversationDeleted = removed.rows.length > 0;
		}
		await transaction.commit();
		return { conversationId, conversationDeleted };
	} catch (error) {
		await transaction.rollback().catch(() => {});
		throw error;
	}
}

/*
 * Resolving a conversation: `lix_conversation.resolved` (boolean, false by
 * default, also for conversations written before the column existed).
 * Resolved conversations are not counted and do not mark their blocks.
 */

/**
 * Resolves or reopens a conversation. A note (what the reply field held
 * when Resolve was pressed) is posted first, in the same transaction, so
 * the thread ends with it.
 */
export async function setConversationResolved(
	lix: Lix,
	conversationId: string,
	resolved: boolean,
	note?: Document | null,
): Promise<void> {
	const withNote = note && toPlainText(note).trim() ? note : null;
	if (withNote) assertDocument(withNote);
	const transaction = await lix.beginTransaction();
	try {
		if (withNote) {
			const posted = await transaction.execute(
				"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) SELECT $1, id, $2::jsonb, lixcol_global FROM lix_conversation WHERE id = $3 RETURNING id",
				[crypto.randomUUID(), JSON.stringify(withNote), conversationId],
			);
			if (posted.rows.length === 0)
				throw new Error("This conversation no longer exists.");
		}
		const updated = await transaction.execute(
			"UPDATE lix_conversation SET resolved = $1 WHERE id = $2 RETURNING id",
			[resolved, conversationId],
		);
		if (updated.rows.length === 0)
			throw new Error("This conversation no longer exists.");
		await transaction.commit();
	} catch (error) {
		await transaction.rollback().catch(() => {});
		throw error;
	}
}
