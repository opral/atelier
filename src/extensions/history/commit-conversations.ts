import type { Lix } from "@lix-js/sdk";
import { assertDocument, type Document } from "@opral/zettel-ast";
import { toPlainText } from "@opral/zettel-lexical";
import { qb, sql } from "@/lib/lix-kysely";

export type CommitConversation = {
	id: string;
	title: string | null;
	lixcol_created_at: string | null;
};

export type CheckpointConversation = CommitConversation & { commit_id: string };

export type ConversationComment = {
	id: string;
	body: unknown;
	lixcol_created_at: string | null;
	author_name: string | null;
};

export type ConversationCount = {
	conversation_id: string;
	comment_count: number;
};

export function selectConversationCounts(
	lix: Lix,
	conversationIds: readonly string[],
) {
	return qb(lix)
		.selectFrom("lix_comment")
		.select("conversation_id")
		.select(sql<number>`COUNT(*)`.as("comment_count"))
		.where("conversation_id", "in", conversationIds)
		.where("lixcol_global", "=", true)
		.groupBy("conversation_id")
		.$castTo<ConversationCount>();
}

export function selectCommitConversations(lix: Lix, commitId: string) {
	return qb(lix)
		.selectFrom("lix_conversation")
		.select(["id", "title", "lixcol_created_at"])
		.where(
			"target",
			"=",
			sql<string>`lix_row_ref('lix_commit', NULL, ${commitId})`,
		)
		.where("lixcol_global", "=", true)
		.orderBy("lixcol_created_at", "asc")
		.orderBy("id", "asc")
		.$castTo<CommitConversation>();
}

/** One observable query for a history page instead of one per checkpoint row. */
export function selectCheckpointConversations(
	lix: Lix,
	commitIds: readonly string[],
) {
	const refs = commitIds.map(
		(id) => sql<string>`lix_row_ref('lix_commit', NULL, ${id})`,
	);
	const cases = commitIds.map(
		(id) =>
			sql`WHEN target = lix_row_ref('lix_commit', NULL, ${id}) THEN ${id}`,
	);
	return qb(lix)
		.selectFrom("lix_conversation")
		.select(["id", "title", "lixcol_created_at"])
		.select(
			sql<string>`CASE ${sql.join(cases, sql.raw(" "))} END`.as("commit_id"),
		)
		.where("lixcol_global", "=", true)
		.where("target", "in", refs)
		.orderBy("lixcol_created_at", "asc")
		.orderBy("id", "asc")
		.$castTo<CheckpointConversation>();
}

/** One conversation's comments, or several read as one thread in time order. */
export function selectConversationComments(
	lix: Lix,
	conversationIds: string | readonly string[],
) {
	const ids =
		typeof conversationIds === "string"
			? [conversationIds]
			: [...conversationIds];
	return qb(lix)
		.selectFrom("lix_comment as comment")
		.leftJoin("lix_change as change", "change.id", "comment.lixcol_change_id")
		.leftJoin("lix_account as author", "author.id", "change.account_id")
		.select([
			"comment.id as id",
			"comment.body as body",
			"comment.lixcol_created_at as lixcol_created_at",
			"author.name as author_name",
		])
		.where("comment.conversation_id", "in", ids.length ? ids : [""])
		.where("comment.lixcol_global", "=", true)
		.orderBy("comment.lixcol_created_at", "asc")
		.orderBy("comment.id", "asc")
		.$castTo<ConversationComment>();
}

export function commentBody(text: string): Document {
	return {
		_type: "zettel_doc",
		blocks: text.split(/\n\s*\n/).map((paragraph) => ({
			_type: "zettel_block",
			_key: crypto.randomUUID(),
			style: "normal",
			markDefs: [],
			children: [
				{
					_type: "zettel_span",
					_key: crypto.randomUUID(),
					text: paragraph,
					marks: [],
				},
			],
		})),
	};
}

export { parseCommentBody } from "@/components/comments/comment-thread";

/** The initial composer writes plain text Zettel blocks; read them safely as text. */
export function commentParagraphs(body: unknown): string[] {
	if (typeof body === "string") {
		const raw = body;
		try {
			body = JSON.parse(raw);
		} catch {
			return [raw];
		}
	}
	if (!body || typeof body !== "object") return [];
	const blocks = (body as { blocks?: unknown }).blocks;
	if (!Array.isArray(blocks)) return [];
	return blocks.map((block) => {
		if (!block || typeof block !== "object") return "";
		const children = (block as { children?: unknown }).children;
		return Array.isArray(children)
			? children
					.map((child) =>
						child && typeof child === "object" && typeof child.text === "string"
							? child.text
							: "",
					)
					.join("")
			: "";
	});
}

export async function setCommitConversationTitle(
	lix: Lix,
	commitId: string,
	conversationId: string | null,
	title: string,
): Promise<void> {
	const normalizedTitle = title.trim() || null;
	if (conversationId) {
		const result = await lix.execute(
			"UPDATE lix_conversation SET title = $1 WHERE id = $2 AND target = lix_row_ref('lix_commit', NULL, $3) AND lixcol_global = true RETURNING id",
			[normalizedTitle, conversationId, commitId],
		);
		if (result.rows.length === 0)
			throw new Error("Conversation no longer exists.");
		return;
	}
	if (!normalizedTitle) return;
	await lix.execute(
		"INSERT INTO lix_conversation (id, target, title, lixcol_global) VALUES ($1, lix_row_ref('lix_commit', NULL, $2), $3, true)",
		[crypto.randomUUID(), commitId, normalizedTitle],
	);
}

export async function createCommitConversation(
	lix: Lix,
	commitId: string,
	body: Document,
): Promise<void> {
	assertDocument(body);
	if (!toPlainText(body).trim()) throw new Error("Comment cannot be empty.");
	const conversationId = crypto.randomUUID();
	const transaction = await lix.beginTransaction();
	try {
		await transaction.execute(
			"INSERT INTO lix_conversation (id, target, lixcol_global) VALUES ($1, lix_row_ref('lix_commit', NULL, $2), true)",
			[conversationId, commitId],
		);
		await transaction.execute(
			"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) VALUES ($1, $2, $3::jsonb, true)",
			[crypto.randomUUID(), conversationId, JSON.stringify(body)],
		);
		await transaction.commit();
	} catch (error) {
		await transaction.rollback().catch(() => {});
		throw error;
	}
}

export async function replyToConversation(
	lix: Lix,
	conversationId: string,
	body: Document,
): Promise<void> {
	assertDocument(body);
	if (!toPlainText(body).trim()) throw new Error("Comment cannot be empty.");
	const result = await lix.execute(
		"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) SELECT $1, id, $2::jsonb, lixcol_global FROM lix_conversation WHERE id = $3 AND lixcol_global = true RETURNING id",
		[crypto.randomUUID(), JSON.stringify(body), conversationId],
	);
	if (result.rows.length === 0)
		throw new Error("Conversation no longer exists.");
}

/**
 * Plugin relations whose rows people comment on (a Markdown block, a CSV
 * row). History counts their conversations per file under a checkpoint;
 * relations a repository has not installed are skipped.
 */
export const COMMENTABLE_ROW_RELATIONS = ["markdown_node", "csv_row"] as const;

export function selectInstalledCommentableRelations(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_registered_schema")
		.select("schema_key")
		.distinct()
		.where("schema_key", "in", [...COMMENTABLE_ROW_RELATIONS])
		.$castTo<{ schema_key: string }>();
}

export type FileConversationCount = {
	file_id: string;
	conversation_count: number;
};

/**
 * Design 4a, "File count in accent": per file, the conversations on rows
 * this checkpoint changed. Row conversations live in their branch, so only
 * local ones count. `relations` must be installed (see above).
 */
export function selectCheckpointFileConversationCounts(
	lix: Lix,
	beforeCommitId: string | null,
	afterCommitId: string,
	relations: readonly string[],
) {
	const perRelation = relations.map((relation) => {
		// The relation must be a literal, not a parameter (opral/lix#1889).
		const fileId = sql<string>`coalesce(changed.to_lixcol_file_id, changed.from_lixcol_file_id)`;
		return qb(lix)
			.selectFrom(
				sql<{
					row_ref: string;
				}>`lix_diff(${sql.lit(relation)}, ${beforeCommitId}, ${afterCommitId})`.as(
					"changed",
				),
			)
			.innerJoin(
				"lix_conversation as conversation",
				"conversation.target",
				"changed.row_ref",
			)
			.select([fileId.as("file_id"), "conversation.id as conversation_id"])
			.where("conversation.lixcol_global", "=", false);
	});
	const [first, ...rest] = perRelation;
	const changedRows = first
		? rest.reduce((union, next) => union.unionAll(next), first)
		: qb(lix)
				.selectFrom("lix_conversation")
				.select([sql<string>`NULL`.as("file_id"), "id as conversation_id"])
				.where(sql<boolean>`false`);
	return qb(lix)
		.selectFrom(changedRows.as("row_conversation"))
		.select([
			"row_conversation.file_id as file_id",
			sql<number>`count(DISTINCT row_conversation.conversation_id)`.as(
				"conversation_count",
			),
		])
		.groupBy("row_conversation.file_id")
		.$castTo<FileConversationCount>();
}
