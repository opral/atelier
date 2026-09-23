import type { Lix } from "@lix-js/sdk";
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

export function selectConversationComments(lix: Lix, conversationId: string) {
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
		.where("comment.conversation_id", "=", conversationId)
		.where("comment.lixcol_global", "=", true)
		.orderBy("comment.lixcol_created_at", "asc")
		.orderBy("comment.id", "asc")
		.$castTo<ConversationComment>();
}

export function commentBody(text: string) {
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

/** A useful immediate label until the reader chooses a checkpoint title. */
export function titleFromFirstComment(text: string): string {
	const firstLine =
		text.trim().split(/\r?\n/, 1)[0]?.replace(/\s+/g, " ").trim() ?? "";
	if (firstLine.length <= 60) return firstLine;
	const prefix = firstLine.slice(0, 59);
	const lastSpace = prefix.lastIndexOf(" ");
	return `${(lastSpace > 30 ? prefix.slice(0, lastSpace) : prefix).trimEnd()}…`;
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
	text: string,
): Promise<void> {
	const conversationId = crypto.randomUUID();
	const transaction = await lix.beginTransaction();
	try {
		await transaction.execute(
			"INSERT INTO lix_conversation (id, target, title, lixcol_global) VALUES ($1, lix_row_ref('lix_commit', NULL, $2), $3, true)",
			[conversationId, commitId, titleFromFirstComment(text)],
		);
		await transaction.execute(
			"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) VALUES ($1, $2, $3::jsonb, true)",
			[
				crypto.randomUUID(),
				conversationId,
				JSON.stringify(commentBody(text.trim())),
			],
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
	text: string,
): Promise<void> {
	const result = await lix.execute(
		"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) SELECT $1, id, $2::jsonb, lixcol_global FROM lix_conversation WHERE id = $3 AND lixcol_global = true RETURNING id",
		[
			crypto.randomUUID(),
			JSON.stringify(commentBody(text.trim())),
			conversationId,
		],
	);
	if (result.rows.length === 0)
		throw new Error("Conversation no longer exists.");
}
