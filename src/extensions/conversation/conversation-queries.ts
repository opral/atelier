import { normalizeConversationId } from "./conversation-location";
import type { Lix } from "@lix-js/sdk";
import { assertDocument, type Document } from "@opral/zettel-ast";
import { toPlainText } from "@opral/zettel-lexical";
import { qb } from "@/lib/lix-kysely";
import {
	blockRowText,
	type MarkdownBlockRow,
} from "@/extensions/markdown/block-conversations";

/*
 * A conversation is a `lix_conversation` row. Its `target` is an opaque
 * `lix_row_ref` (or NULL for a standalone conversation): a checkpoint
 * (`lix_commit`, global), a Markdown block (`markdown_node`, branch-local),
 * a CSV row (`csv_row`, branch-local), or a row of some other relation. The
 * conversation view reads one conversation by id and says what it is
 * attached to; everything here is a plain read, usable outside React.
 */

export { normalizeConversationId } from "./conversation-location";

export type ConversationRow = {
	readonly id: string;
	readonly target: string | null;
	readonly title: string | null;
	readonly lixcol_global: boolean;
	readonly lixcol_created_at: string | null;
};

/** One conversation, in whichever scope the reader's overlay shows it. */
export function selectConversation(lix: Lix, conversationId: string) {
	return qb(lix)
		.selectFrom("lix_conversation")
		.select(["id", "target", "title", "lixcol_global", "lixcol_created_at"])
		.where("id", "=", conversationId)
		.limit(1)
		.$castTo<ConversationRow>();
}

export type ConversationCommentRow = {
	readonly id: string;
	readonly body: unknown;
	readonly lixcol_created_at: string | null;
	/** The change that wrote it, whose account is the author. */
	readonly change_id: string | null;
};

/**
 * A conversation's comments in its own scope, oldest first. Authors are a
 * separate read (`selectCommentAuthors`): a live query must not observe
 * `lix_change`.
 */
export function selectConversationThread(
	lix: Lix,
	conversationId: string,
	global: boolean,
) {
	return qb(lix)
		.selectFrom("lix_comment")
		.select([
			"id",
			"body",
			"lixcol_created_at",
			"lixcol_change_id as change_id",
		])
		.where("conversation_id", "=", conversationId)
		.where("lixcol_global", "=", global)
		.orderBy("lixcol_created_at", "asc")
		.orderBy("id", "asc")
		.$castTo<ConversationCommentRow>();
}

/* ── What a conversation is attached to ─────────────────────────────── */

export type ConversationTarget =
	| { readonly kind: "none" }
	| { readonly kind: "checkpoint"; readonly commitId: string }
	| {
			readonly kind: "markdown_block";
			readonly fileId: string;
			readonly nodeId: string;
	  }
	| {
			readonly kind: "csv_row";
			readonly fileId: string;
			readonly rowId: string;
	  }
	/** A row of a relation this view does not draw. */
	| { readonly kind: "row"; readonly relation: string | null };

export type RowRefHint = {
	readonly relation: string;
	readonly fileId: string | null;
	/** UUID key components; other key types are not decoded. */
	readonly keys: readonly string[];
};

/**
 * A guess at what an opaque `lix_row_ref` names. Lix documents the
 * reference as opaque, so a guess is only ever used after
 * `lix_row_ref(guess) = target` confirms it in SQL; a changed encoding
 * costs a slower lookup, never a wrong anchor.
 */
export function rowRefHint(ref: string): RowRefHint | null {
	const prefix = "lix_row_ref:v2:";
	if (!ref.startsWith(prefix)) return null;
	let bytes: Uint8Array;
	try {
		const base64 = ref
			.slice(prefix.length)
			.replace(/-/g, "+")
			.replace(/_/g, "/");
		const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
		bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch {
		return null;
	}
	let offset = 0;
	const u32 = () => {
		if (offset + 4 > bytes.length) throw new RangeError();
		const value =
			((bytes[offset]! << 24) >>> 0) +
			(bytes[offset + 1]! << 16) +
			(bytes[offset + 2]! << 8) +
			bytes[offset + 3]!;
		offset += 4;
		return value;
	};
	const text = (length: number) => {
		if (offset + length > bytes.length) throw new RangeError();
		const value = new TextDecoder().decode(
			bytes.subarray(offset, offset + length),
		);
		offset += length;
		return value;
	};
	try {
		const relation = text(u32());
		const hasFile = bytes[offset++];
		const fileId = hasFile === 1 ? text(u32()) : null;
		if (hasFile !== 0 && hasFile !== 1) return null;
		const count = (bytes[offset]! << 8) + bytes[offset + 1]!;
		offset += 2;
		const keys: string[] = [];
		for (let index = 0; index < count; index++) {
			// 0x01: a UUID, sixteen bytes.
			if (bytes[offset] !== 1 || offset + 17 > bytes.length) break;
			const hex = Array.from(bytes.subarray(offset + 1, offset + 17), (byte) =>
				byte.toString(16).padStart(2, "0"),
			).join("");
			keys.push(
				`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
			);
			offset += 17;
		}
		return { relation, fileId, keys };
	} catch {
		return null;
	}
}

async function refEquals(
	lix: Lix,
	target: string,
	relation: "lix_commit" | "markdown_node" | "csv_row",
	fileId: string | null,
	id: string,
): Promise<boolean> {
	// The relation is a literal: lix_row_ref validates it at construction.
	const result = await lix.execute(
		`SELECT lix_row_ref('${relation}', $1, $2) = $3 AS same`,
		[fileId, id, target],
	);
	return result.rows[0]?.same === true;
}

/** Slow path: find the row by comparing its reference with the target. */
async function scanForTarget(
	lix: Lix,
	target: string,
): Promise<ConversationTarget | null> {
	const attempts: readonly [
		string,
		(row: Record<string, unknown>) => ConversationTarget,
	][] = [
		[
			"SELECT id FROM lix_commit WHERE lix_row_ref('lix_commit', NULL, id) = $1 LIMIT 1",
			(row) => ({ kind: "checkpoint", commitId: String(row.id) }),
		],
		[
			"SELECT id, lixcol_file_id FROM markdown_node WHERE lix_row_ref('markdown_node', lixcol_file_id, id) = $1 LIMIT 1",
			(row) => ({
				kind: "markdown_block",
				fileId: String(row.lixcol_file_id),
				nodeId: String(row.id),
			}),
		],
		[
			"SELECT id, lixcol_file_id FROM csv_row WHERE lix_row_ref('csv_row', lixcol_file_id, id) = $1 LIMIT 1",
			(row) => ({
				kind: "csv_row",
				fileId: String(row.lixcol_file_id),
				rowId: String(row.id),
			}),
		],
	];
	for (const [query, toTarget] of attempts) {
		try {
			const result = await lix.execute(query, [target]);
			const row = result.rows[0];
			if (row) return toTarget(row as Record<string, unknown>);
		} catch {
			// The relation does not exist here (its plugin is not installed).
		}
	}
	return null;
}

/**
 * What a stored target names. The reference is decoded as a hint and
 * confirmed in SQL; a reference the hint cannot explain is looked up by
 * comparison (checkpoints, Markdown blocks, CSV rows), and anything else is
 * a row of another relation.
 */
export async function resolveConversationTarget(
	lix: Lix,
	target: string | null,
): Promise<ConversationTarget> {
	if (target === null) return { kind: "none" };
	const hint = rowRefHint(target);
	const key = hint?.keys[0];
	if (hint && key) {
		try {
			if (
				hint.relation === "lix_commit" &&
				(await refEquals(lix, target, "lix_commit", null, key))
			)
				return { kind: "checkpoint", commitId: key };
			if (
				(hint.relation === "markdown_node" || hint.relation === "csv_row") &&
				hint.fileId &&
				(await refEquals(lix, target, hint.relation, hint.fileId, key))
			)
				return hint.relation === "markdown_node"
					? { kind: "markdown_block", fileId: hint.fileId, nodeId: key }
					: { kind: "csv_row", fileId: hint.fileId, rowId: key };
		} catch {
			// Fall through to the comparison scan.
		}
	}
	return (
		(await scanForTarget(lix, target)) ?? {
			kind: "row",
			relation: hint?.relation ?? null,
		}
	);
}

/* ── Anchor details, one reader per kind ────────────────────────────── */

export type CheckpointFile = {
	readonly id: string;
	readonly path: string;
	readonly changeKind: "added" | "modified" | "removed";
};

export type CheckpointAnchor = {
	readonly kind: "checkpoint";
	readonly commitId: string;
	/** The first parent: the review's base. Null for the root. */
	readonly parentCommitId: string | null;
	readonly createdAt: string | null;
	readonly files: readonly CheckpointFile[];
};

/** Files under `/.lix/` (plugins, settings) are the repository's machinery. */
function isMachineryPath(path: string): boolean {
	return path.startsWith("/.lix/");
}

/**
 * The checkpoint a commit conversation is on: when it was made, its first
 * parent, and the files it changed (the same history read History's
 * preview uses, anchored at the commit so an off-branch commit works too).
 */
export async function readCheckpointAnchor(
	lix: Lix,
	commitId: string,
): Promise<CheckpointAnchor | null> {
	const commit = await lix.execute(
		"SELECT created_at, parent_commit_ids FROM lix_commit WHERE id = $1",
		[commitId],
	);
	const row = commit.rows[0] as
		| { created_at?: unknown; parent_commit_ids?: unknown }
		| undefined;
	if (!row) return null;
	const parents = Array.isArray(row.parent_commit_ids)
		? row.parent_commit_ids
		: typeof row.parent_commit_ids === "string"
			? (JSON.parse(row.parent_commit_ids) as unknown[])
			: [];
	const files = await lix.execute(
		"SELECT id, diff_type, coalesce(to_path, from_path) AS path FROM lix_history('lix_file', $1) WHERE lixcol_to_commit_id = $1 ORDER BY path",
		[commitId],
	);
	return {
		kind: "checkpoint",
		commitId,
		parentCommitId: typeof parents[0] === "string" ? parents[0] : null,
		createdAt: typeof row.created_at === "string" ? row.created_at : null,
		files: files.rows
			.map((file) => ({
				id: String(file.id),
				path: String(file.path ?? ""),
				changeKind: file.diff_type as CheckpointFile["changeKind"],
			}))
			.filter((file) => file.path && !isMachineryPath(file.path)),
	};
}

export type MarkdownBlockAnchor = {
	readonly kind: "markdown_block";
	readonly fileId: string;
	readonly filePath: string | null;
	readonly nodeId: string;
	readonly blockKind: string;
	/** The block's text, or null for a block that carries none itself. */
	readonly text: string | null;
	/** The nearest heading above the block. */
	readonly heading: string | null;
};

/**
 * A Markdown block as the conversation view shows it: its text and the
 * heading it sits under, from the file's top-level blocks in order (the
 * rows `selectMarkdownBlocks` reads).
 */
export function markdownBlockAnchor(
	blocks: readonly MarkdownBlockRow[],
	fileId: string,
	filePath: string | null,
	nodeId: string,
	/** All of the file's nodes, to read a list's, table's or quote's text. */
	nodes?: readonly MarkdownNodeRow[],
): MarkdownBlockAnchor | null {
	const index = blocks.findIndex((block) => block.id === nodeId);
	if (index < 0) return null;
	const block = blocks[index]!;
	let heading: string | null = null;
	for (let previous = index - 1; previous >= 0; previous--) {
		if (blocks[previous]!.kind === "heading") {
			heading = blockRowText(blocks[previous]!) || null;
			break;
		}
	}
	return {
		kind: "markdown_block",
		fileId,
		filePath,
		nodeId,
		blockKind: block.kind,
		text: blockRowText(block) ?? (nodes ? containerText(nodes, nodeId) : null),
		heading,
	};
}

export type MarkdownNodeRow = MarkdownBlockRow & {
	readonly parent_id: string | null;
	readonly order_key: string | null;
};

/** Every node of a Markdown file: the document, its blocks and their parts. */
export function selectMarkdownNodes(lix: Lix, fileId: string) {
	return qb(lix)
		.selectFrom("markdown_node")
		.select(["id", "parent_id", "kind", "order_key", "payload_json"])
		.where("lixcol_file_id", "=", fileId)
		.$castTo<MarkdownNodeRow>();
}

function byOrder(a: MarkdownNodeRow, b: MarkdownNodeRow): number {
	const left = a.order_key ?? "";
	const right = b.order_key ?? "";
	if (left !== right) return left < right ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The document's top-level blocks in order, from all of its nodes. */
export function topLevelBlocks(
	nodes: readonly MarkdownNodeRow[],
): MarkdownNodeRow[] {
	const root = nodes.find((node) => node.kind === "document");
	if (!root) return [];
	return nodes.filter((node) => node.parent_id === root.id).sort(byOrder);
}

/**
 * The text of a block that carries none itself (a list, a table, a quote):
 * one line per child — an item, a row — with a table row's cells joined by
 * " · ". Null when there is no text under it.
 */
export function containerText(
	nodes: readonly MarkdownNodeRow[],
	nodeId: string,
): string | null {
	const children = new Map<string, MarkdownNodeRow[]>();
	for (const node of nodes) {
		if (!node.parent_id) continue;
		const list = children.get(node.parent_id) ?? [];
		list.push(node);
		children.set(node.parent_id, list);
	}
	for (const list of children.values()) list.sort(byOrder);
	const flatten = (node: MarkdownNodeRow, depth: number): string => {
		const own = blockRowText(node);
		if (own !== null || depth > 12) return own ?? "";
		return (children.get(node.id) ?? [])
			.map((child) => flatten(child, depth + 1))
			.filter(Boolean)
			.join(/row/.test(node.kind) ? " · " : " ");
	};
	const lines = (children.get(nodeId) ?? [])
		.map((child) => flatten(child, 0))
		.filter(Boolean);
	return lines.length > 0 ? lines.join("\n") : null;
}

export type CsvRowAnchor = {
	readonly kind: "csv_row";
	readonly fileId: string;
	readonly filePath: string | null;
	readonly rowId: string;
	/** 1-based among the data rows; 0 is the header record. */
	readonly rowNumber: number;
	readonly header: readonly string[];
	readonly cells: readonly string[];
};

export type CsvRecordRow = {
	readonly id: string;
	readonly cells: unknown;
};

/** The file's records in file order (`order_key`, then id). */
export function selectCsvRecords(lix: Lix, fileId: string) {
	return qb(lix)
		.selectFrom("csv_row")
		.select(["id", "cells"])
		.where("lixcol_file_id", "=", fileId)
		.orderBy("order_key", "asc")
		.orderBy("id", "asc")
		.$castTo<CsvRecordRow>();
}

function csvCells(value: unknown): string[] {
	let cells = value;
	if (typeof cells === "string") {
		try {
			cells = JSON.parse(cells);
		} catch {
			return [];
		}
	}
	return Array.isArray(cells) ? cells.map((cell) => String(cell ?? "")) : [];
}

/**
 * A CSV row with the file's first record as its header. Row numbers count
 * data rows from 1, as the CSV view numbers them.
 */
export function csvRowAnchor(
	records: readonly CsvRecordRow[],
	fileId: string,
	filePath: string | null,
	rowId: string,
): CsvRowAnchor | null {
	const index = records.findIndex((record) => record.id === rowId);
	if (index < 0) return null;
	return {
		kind: "csv_row",
		fileId,
		filePath,
		rowId,
		rowNumber: index,
		header: records[0] ? csvCells(records[0].cells) : [],
		cells: csvCells(records[index]!.cells),
	};
}

export function selectFilePath(lix: Lix, fileId: string) {
	return qb(lix)
		.selectFrom("lix_file")
		.select(["id", "path"])
		.where("id", "=", fileId)
		.limit(1)
		.$castTo<{ id: string; path: string }>();
}

/* ── A conversation whose anchor was removed ────────────────────────── */

/**
 * Deleting a conversation's target deletes the conversation and its
 * comments with it (Lix cascades). What was said is still in history: the
 * last state before the removal, and the commit that removed it.
 */
export type RemovedConversation = {
	readonly conversation: ConversationRow;
	readonly target: ConversationTarget;
	/** The state just before the removal. */
	readonly beforeCommitId: string;
	/** The commit that removed it. */
	readonly removedInCommitId: string;
	readonly removedAt: string | null;
	/** Whether that commit is a checkpoint on the active branch. */
	readonly removedInCheckpoint: boolean;
	/** The removing commit's first parent, for opening its review. */
	readonly removedInParentCommitId: string | null;
	readonly comments: readonly ConversationCommentRow[];
	readonly anchor: MarkdownBlockAnchor | CsvRowAnchor | null;
};

/**
 * The removed conversation, when it went with its anchor. A conversation
 * deleted on its own (its anchor still here, or it had none) is not
 * "removed with its anchor": it is gone, and the view says only that.
 */
export async function readRemovedConversation(
	lix: Lix,
	conversationId: string,
): Promise<RemovedConversation | null> {
	const history = await lix.execute(
		"SELECT from_target, lixcol_from_commit_id, lixcol_to_commit_id, lixcol_commit_created_at FROM lix_history('lix_conversation') WHERE id = $1 AND diff_type = 'removed' ORDER BY lixcol_position ASC LIMIT 1",
		[conversationId],
	);
	const removal = history.rows[0] as
		| {
				from_target?: unknown;
				lixcol_from_commit_id?: unknown;
				lixcol_to_commit_id?: unknown;
				lixcol_commit_created_at?: unknown;
		  }
		| undefined;
	if (
		!removal ||
		typeof removal.from_target !== "string" ||
		typeof removal.lixcol_from_commit_id !== "string" ||
		typeof removal.lixcol_to_commit_id !== "string"
	)
		return null;
	const before = removal.lixcol_from_commit_id;
	const removedIn = removal.lixcol_to_commit_id;
	const target = await resolveTargetAt(lix, removal.from_target, before);
	if (target.kind !== "markdown_block" && target.kind !== "csv_row")
		return null;
	// Only the cascade of the anchor's removal: the anchor was there when
	// the conversation was last visible and went in the very commit that
	// took the conversation. A conversation deleted on purpose stays deleted
	// when its anchor goes later, and one whose anchor is still here was
	// deleted on its own. (Two deletions compacted into one checkpoint
	// cannot be told apart; the anchor's goes first either way.)
	if (!(await targetExists(lix, target, before))) return null;
	if (await targetExists(lix, target, removedIn)) return null;
	if (await targetExists(lix, target)) return null;
	const conversationRows = await lix.execute(
		"SELECT id, target, title, lixcol_global, lixcol_created_at FROM lix_as_of('lix_conversation', $1) WHERE id = $2",
		[before, conversationId],
	);
	const conversation = conversationRows.rows[0] as ConversationRow | undefined;
	if (!conversation) return null;
	const comments = await lix.execute(
		"SELECT id, body, lixcol_created_at, lixcol_change_id AS change_id FROM lix_as_of('lix_comment', $1) WHERE conversation_id = $2 ORDER BY lixcol_created_at, id",
		[before, conversationId],
	);
	const log = await lix.execute(
		"SELECT is_checkpoint, parent_commit_id FROM lix_log() WHERE commit_id = $1",
		[removedIn],
	);
	const logRow = log.rows[0] as
		| { is_checkpoint?: unknown; parent_commit_id?: unknown }
		| undefined;
	return {
		conversation: {
			id: conversation.id,
			target: conversation.target,
			title: conversation.title ?? null,
			lixcol_global: conversation.lixcol_global === true,
			lixcol_created_at: conversation.lixcol_created_at ?? null,
		},
		target,
		beforeCommitId: before,
		removedInCommitId: removedIn,
		removedAt:
			typeof removal.lixcol_commit_created_at === "string"
				? removal.lixcol_commit_created_at
				: null,
		removedInCheckpoint: logRow?.is_checkpoint === true,
		removedInParentCommitId:
			typeof logRow?.parent_commit_id === "string"
				? logRow.parent_commit_id
				: before,
		comments: comments.rows as unknown as ConversationCommentRow[],
		anchor: await readAnchorAt(lix, target, before),
	};
}

async function resolveTargetAt(
	lix: Lix,
	target: string,
	commitId: string,
): Promise<ConversationTarget> {
	const hint = rowRefHint(target);
	const key = hint?.keys[0];
	if (
		hint &&
		key &&
		hint.fileId &&
		(hint.relation === "markdown_node" || hint.relation === "csv_row")
	) {
		try {
			if (await refEquals(lix, target, hint.relation, hint.fileId, key))
				return hint.relation === "markdown_node"
					? { kind: "markdown_block", fileId: hint.fileId, nodeId: key }
					: { kind: "csv_row", fileId: hint.fileId, rowId: key };
		} catch {
			// Unknown relation here.
		}
	}
	for (const relation of ["markdown_node", "csv_row"] as const) {
		try {
			const result = await lix.execute(
				`SELECT id, lixcol_file_id FROM lix_as_of('${relation}', $1) WHERE lix_row_ref('${relation}', lixcol_file_id, id) = $2 LIMIT 1`,
				[commitId, target],
			);
			const row = result.rows[0];
			if (!row) continue;
			return relation === "markdown_node"
				? {
						kind: "markdown_block",
						fileId: String(row.lixcol_file_id),
						nodeId: String(row.id),
					}
				: {
						kind: "csv_row",
						fileId: String(row.lixcol_file_id),
						rowId: String(row.id),
					};
		} catch {
			// The plugin is not installed.
		}
	}
	return { kind: "row", relation: hint?.relation ?? null };
}

/** Whether the anchor row exists now, or at `commitId` when given. */
async function targetExists(
	lix: Lix,
	target: ConversationTarget,
	commitId?: string,
): Promise<boolean> {
	const relation =
		target.kind === "markdown_block"
			? "markdown_node"
			: target.kind === "csv_row"
				? "csv_row"
				: null;
	if (!relation || !("fileId" in target)) return false;
	const id = target.kind === "markdown_block" ? target.nodeId : target.rowId;
	try {
		const result = commitId
			? await lix.execute(
					`SELECT id FROM lix_as_of('${relation}', $1) WHERE lixcol_file_id = $2 AND id = $3`,
					[commitId, target.fileId, id],
				)
			: await lix.execute(
					`SELECT id FROM ${relation} WHERE lixcol_file_id = $1 AND id = $2`,
					[target.fileId, id],
				);
		return result.rows.length > 0;
	} catch {
		return false;
	}
}

async function filePathAt(
	lix: Lix,
	fileId: string,
	commitId: string,
): Promise<string | null> {
	const live = await lix.execute("SELECT path FROM lix_file WHERE id = $1", [
		fileId,
	]);
	if (typeof live.rows[0]?.path === "string") return live.rows[0].path;
	const then = await lix.execute(
		"SELECT path FROM lix_as_of('lix_file', $1) WHERE id = $2",
		[commitId, fileId],
	);
	return typeof then.rows[0]?.path === "string" ? then.rows[0].path : null;
}

async function readAnchorAt(
	lix: Lix,
	target: ConversationTarget,
	commitId: string,
): Promise<MarkdownBlockAnchor | CsvRowAnchor | null> {
	try {
		if (target.kind === "markdown_block") {
			const result = await lix.execute(
				"SELECT id, parent_id, kind, order_key, payload_json FROM lix_as_of('markdown_node', $1) WHERE lixcol_file_id = $2",
				[commitId, target.fileId],
			);
			const nodes = result.rows as unknown as MarkdownNodeRow[];
			return markdownBlockAnchor(
				topLevelBlocks(nodes),
				target.fileId,
				await filePathAt(lix, target.fileId, commitId),
				target.nodeId,
				nodes,
			);
		}
		if (target.kind === "csv_row") {
			const records = await lix.execute(
				"SELECT id, cells FROM lix_as_of('csv_row', $1) WHERE lixcol_file_id = $2 ORDER BY order_key, id",
				[commitId, target.fileId],
			);
			return csvRowAnchor(
				records.rows as unknown as CsvRecordRow[],
				target.fileId,
				await filePathAt(lix, target.fileId, commitId),
				target.rowId,
			);
		}
	} catch {
		return null;
	}
	return null;
}

/* ── Labels and the host summary ────────────────────────────────────── */

function fileName(path: string | null): string | null {
	if (!path) return null;
	return path.split("/").filter(Boolean).at(-1) ?? null;
}

const BLOCK_KIND_LABEL: Record<string, string> = {
	paragraph: "paragraph",
	heading: "heading",
	list: "list",
	table: "table",
	block_quote: "quote",
	code_block: "code block",
};

export function blockKindLabel(kind: string): string {
	return BLOCK_KIND_LABEL[kind] ?? "block";
}

/**
 * What the conversation is attached to, in the words its context line
 * uses without the time: "Checkpoint", "README.md › Releases",
 * "posts.csv › row 14". Null for a standalone conversation.
 */
export function anchorLabel(
	anchor:
		| CheckpointAnchor
		| MarkdownBlockAnchor
		| CsvRowAnchor
		| { readonly kind: "row"; readonly relation: string | null }
		| { readonly kind: "none" }
		| null,
): string | null {
	if (!anchor) return null;
	switch (anchor.kind) {
		case "none":
			return null;
		case "checkpoint":
			return "Checkpoint";
		case "markdown_block": {
			const name = fileName(anchor.filePath) ?? "Document";
			return `${name} › ${anchor.heading ?? blockKindLabel(anchor.blockKind)}`;
		}
		case "csv_row": {
			const name = fileName(anchor.filePath) ?? "Table";
			return `${name} › ${anchor.rowNumber === 0 ? "header" : `row ${anchor.rowNumber}`}`;
		}
		case "row":
			return "Row";
	}
}

export type ConversationAnchorKind =
	| "checkpoint"
	| "markdown_block"
	| "csv_row"
	| "row"
	| "none";

/** What a host needs to name a conversation, e.g. in a URL slug. */
export type ConversationSummary = {
	readonly id: string;
	/** The conversation's own title; null when it has none. */
	readonly title: string | null;
	readonly anchorKind: ConversationAnchorKind;
	/** "Checkpoint", "README.md › Releases", "posts.csv › row 14"; null when standalone. */
	readonly anchorLabel: string | null;
	/** Its anchor was deleted, and the conversation with it; read from history. */
	readonly removed: boolean;
};

/**
 * A conversation's display name for a host: its title, and what it is
 * attached to. Null when the id names no conversation the reader can see
 * (never created, deleted on its own, or not in this repository), so a host
 * shows the same "not available" for all three.
 *
 * `title ?? anchorLabel ?? "Conversation"` is the tab label and the text a
 * URL slug is made from.
 */
export async function selectConversationSummary(
	lix: Lix,
	conversationId: string,
): Promise<ConversationSummary | null> {
	const id = normalizeConversationId(conversationId);
	if (!id) return null;
	return summarize(lix, id);
}

async function summarize(
	lix: Lix,
	conversationId: string,
): Promise<ConversationSummary | null> {
	const rows = await selectConversation(lix, conversationId).execute();
	const conversation = rows[0];
	if (!conversation) {
		const removed = await readRemovedConversation(lix, conversationId).catch(
			() => null,
		);
		if (!removed) return null;
		return {
			id: conversationId,
			title: removed.conversation.title?.trim() || null,
			anchorKind: removed.target.kind,
			anchorLabel: anchorLabel(removed.anchor),
			removed: true,
		};
	}
	const target = await resolveConversationTarget(lix, conversation.target);
	const anchor = await readAnchor(lix, target);
	return {
		id: conversation.id,
		title: conversation.title?.trim() || null,
		anchorKind: target.kind,
		anchorLabel: anchorLabel(
			anchor ??
				(target.kind === "row" || target.kind === "none" ? target : null),
		),
		removed: false,
	};
}

/** The current anchor details for a resolved target (one-shot). */
export async function readAnchor(
	lix: Lix,
	target: ConversationTarget,
): Promise<CheckpointAnchor | MarkdownBlockAnchor | CsvRowAnchor | null> {
	switch (target.kind) {
		case "checkpoint":
			return readCheckpointAnchor(lix, target.commitId);
		case "markdown_block": {
			const nodes = await selectMarkdownNodes(lix, target.fileId).execute();
			const path = await selectFilePath(lix, target.fileId).execute();
			return markdownBlockAnchor(
				topLevelBlocks(nodes),
				target.fileId,
				path[0]?.path ?? null,
				target.nodeId,
				nodes,
			);
		}
		case "csv_row": {
			const records = await selectCsvRecords(lix, target.fileId).execute();
			const path = await selectFilePath(lix, target.fileId).execute();
			return csvRowAnchor(
				records,
				target.fileId,
				path[0]?.path ?? null,
				target.rowId,
			);
		}
		default:
			return null;
	}
}

/* ── Writes ─────────────────────────────────────────────────────────── */

/** Renames a conversation in its own scope. An empty title clears it. */
export async function setConversationTitle(
	lix: Lix,
	conversation: Pick<ConversationRow, "id" | "lixcol_global">,
	title: string,
): Promise<void> {
	const result = await lix.execute(
		"UPDATE lix_conversation SET title = $1 WHERE id = $2 AND lixcol_global = $3 RETURNING id",
		[title.trim() || null, conversation.id, conversation.lixcol_global],
	);
	if (result.rows.length === 0)
		throw new Error("This conversation no longer exists.");
}

/** A reply takes its conversation's scope rather than guessing it. */
export async function replyInConversation(
	lix: Lix,
	conversation: Pick<ConversationRow, "id" | "lixcol_global">,
	body: Document,
): Promise<void> {
	assertDocument(body);
	if (!toPlainText(body).trim()) throw new Error("Comment cannot be empty.");
	const result = await lix.execute(
		"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) SELECT $1, id, $2::jsonb, lixcol_global FROM lix_conversation WHERE id = $3 AND lixcol_global = $4 RETURNING id",
		[
			crypto.randomUUID(),
			JSON.stringify(body),
			conversation.id,
			conversation.lixcol_global,
		],
	);
	if (result.rows.length === 0)
		throw new Error("This conversation no longer exists.");
}
