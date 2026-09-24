import type { Lix } from "@lix-js/sdk";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { assertDocument, type Document } from "@opral/zettel-ast";
import { toPlainText } from "@opral/zettel-lexical";
import { qb, sql } from "@/lib/lix-kysely";

/*
 * Block conversations: a comment on a Markdown document belongs to one
 * top-level block, the `markdown_node` row the Markdown plugin projects for
 * it. Nothing about the selected characters is stored and nothing is written
 * into the .md file. Conversations are branch-local: a paragraph's discussion
 * travels with the branch the paragraph is on.
 */

/** A top-level block of the file, as the plugin projects it. */
export type MarkdownBlockRow = {
	readonly id: string;
	readonly kind: string;
	readonly payload_json: unknown;
};

/** One comment of a block conversation, with the block it is on. */
export type BlockCommentRow = {
	readonly id: string;
	readonly body: unknown;
	readonly lixcol_created_at: string | null;
	/** The change that wrote it, whose account is the author. */
	readonly change_id: string | null;
	readonly conversation_id: string;
	readonly node_id: string;
};

export type BlockComment = Omit<BlockCommentRow, "change_id"> & {
	readonly author_name: string | null;
	readonly author_id: string | null;
};

export type CommentAuthor = {
	change_id: string;
	author_name: string | null;
	author_id: string | null;
};

/**
 * The document's top-level blocks in document order: the children of the
 * file's `document` row, ordered the way the plugin renders them.
 */
export function selectMarkdownBlocks(lix: Lix, fileId: string) {
	return qb(lix)
		.selectFrom("markdown_node as block")
		.innerJoin("markdown_node as root", (join) =>
			join
				.onRef("root.id", "=", "block.parent_id")
				.onRef("root.lixcol_file_id", "=", "block.lixcol_file_id"),
		)
		.select([
			"block.id as id",
			"block.kind as kind",
			"block.payload_json as payload_json",
		])
		.where("root.kind", "=", "document")
		.where("block.lixcol_file_id", "=", fileId)
		.orderBy("block.order_key", "asc")
		.orderBy("block.id", "asc")
		.$castTo<MarkdownBlockRow>();
}

/**
 * Every comment on a block of this file, oldest first. One live query for
 * the whole document; it names the change that wrote each comment rather
 * than joining `lix_change`, which a live query must not observe.
 * Resolved conversations are left out: their blocks are not marked and not
 * counted.
 */
export function selectBlockComments(lix: Lix, fileId: string) {
	return qb(lix)
		.selectFrom("lix_comment as comment")
		.innerJoin(
			"lix_conversation as conversation",
			"conversation.id",
			"comment.conversation_id",
		)
		.innerJoin("markdown_node as block", (join) =>
			join.on(
				sql`conversation.target = lix_row_ref('markdown_node', block.lixcol_file_id, block.id)`,
			),
		)
		.select([
			"comment.id as id",
			"comment.body as body",
			"comment.lixcol_created_at as lixcol_created_at",
			"comment.lixcol_change_id as change_id",
			"conversation.id as conversation_id",
			"block.id as node_id",
		])
		.where("block.lixcol_file_id", "=", fileId)
		.where("conversation.lixcol_global", "=", false)
		.where("comment.lixcol_global", "=", false)
		.where("conversation.resolved", "=", false)
		.orderBy("comment.lixcol_created_at", "asc")
		.orderBy("comment.id", "asc")
		.$castTo<BlockCommentRow>();
}

/** Who wrote each change: the account on the change. */
export function selectCommentAuthors(lix: Lix, changeIds: readonly string[]) {
	return qb(lix)
		.selectFrom("lix_change as change")
		.innerJoin("lix_account as author", "author.id", "change.account_id")
		.select([
			"change.id as change_id",
			"author.name as author_name",
			"author.id as author_id",
		])
		.where("change.id", "in", changeIds.length ? [...changeIds] : [""])
		.$castTo<CommentAuthor>();
}

export function withAuthors(
	rows: readonly BlockCommentRow[],
	authors: readonly CommentAuthor[],
): BlockComment[] {
	const byChange = new Map(authors.map((author) => [author.change_id, author]));
	return rows.map(({ change_id, ...comment }) => {
		const author = change_id ? byChange.get(change_id) : undefined;
		return {
			...comment,
			author_name: author?.author_name ?? null,
			author_id: author?.author_id ?? null,
		};
	});
}

export type FileConversationCount = {
	readonly file_id: string;
	readonly conversation_count: number;
};

/**
 * Per file, the block conversations on `markdown_node` rows that changed
 * between two commits (a checkpoint and its base): History's accent count.
 * The diff's `row_ref` is the same file-qualified reference a conversation
 * stores as its `target`, so the join is exact. Conversations are read in
 * the current branch, so one opened after the checkpoint counts too.
 *
 * It counts conversations whose own row changed. A block conversation is on
 * a top-level row, and a paragraph, heading or code block carries its text
 * in that row; a list, table or quotation does not (its items and cells are
 * rows of their own), so an edit inside one is not counted. Lix SQL has no
 * recursive CTE to walk from a changed row up to its top-level block.
 *
 * Fails when the Markdown plugin is not installed (`markdown_node` does not
 * exist); a caller treats that as no conversations.
 */
export function selectChangedBlockConversationCounts(
	lix: Lix,
	beforeCommitId: string,
	afterCommitId: string,
) {
	const fileId = sql<string>`coalesce(changed.to_lixcol_file_id, changed.from_lixcol_file_id)`;
	return qb(lix)
		.selectFrom(
			sql<{
				row_ref: string;
			}>`lix_diff('markdown_node', ${beforeCommitId}, ${afterCommitId})`.as(
				"changed",
			),
		)
		.innerJoin(
			"lix_conversation as conversation",
			"conversation.target",
			"changed.row_ref",
		)
		.select([
			fileId.as("file_id"),
			sql<number>`count(DISTINCT conversation.id)`.as("conversation_count"),
		])
		.where("conversation.lixcol_global", "=", false)
		.groupBy(fileId)
		.$castTo<FileConversationCount>();
}

/** A commented block: its conversations read as one thread, in time order. */
export type BlockThread = {
	readonly nodeId: string;
	/** Where a reply goes: the block's first conversation. */
	readonly conversationId: string;
	readonly comments: readonly BlockComment[];
};

export function groupBlockThreads(
	comments: readonly BlockComment[],
): ReadonlyMap<string, BlockThread> {
	const threads = new Map<string, BlockThread>();
	for (const comment of comments) {
		const thread = threads.get(comment.node_id);
		if (thread) {
			(thread.comments as BlockComment[]).push(comment);
		} else {
			threads.set(comment.node_id, {
				nodeId: comment.node_id,
				conversationId: comment.conversation_id,
				comments: [comment],
			});
		}
	}
	return threads;
}

function assertCommentBody(body: Document): void {
	assertDocument(body);
	if (!toPlainText(body).trim()) throw new Error("Comment cannot be empty.");
}

/**
 * Opens a conversation on a block with its first comment, in one
 * transaction. Branch-local: `lixcol_global` is left at its default.
 */
export async function createBlockConversation(
	lix: Lix,
	fileId: string,
	nodeId: string,
	body: Document,
): Promise<string> {
	assertCommentBody(body);
	const conversationId = crypto.randomUUID();
	const transaction = await lix.beginTransaction();
	try {
		await transaction.execute(
			"INSERT INTO lix_conversation (id, target) VALUES ($1, lix_row_ref('markdown_node', $2, $3))",
			[conversationId, fileId, nodeId],
		);
		await transaction.execute(
			"INSERT INTO lix_comment (id, conversation_id, body) VALUES ($1, $2, $3::jsonb)",
			[crypto.randomUUID(), conversationId, JSON.stringify(body)],
		);
		await transaction.commit();
	} catch (error) {
		await transaction.rollback().catch(() => {});
		throw error;
	}
	return conversationId;
}

/** A reply takes its conversation's scope rather than guessing it. */
export async function replyToBlockConversation(
	lix: Lix,
	conversationId: string,
	body: Document,
): Promise<void> {
	assertCommentBody(body);
	const result = await lix.execute(
		"INSERT INTO lix_comment (id, conversation_id, body, lixcol_global) SELECT $1, id, $2::jsonb, lixcol_global FROM lix_conversation WHERE id = $3 RETURNING id",
		[crypto.randomUUID(), JSON.stringify(body), conversationId],
	);
	if (result.rows.length === 0)
		throw new Error("This conversation no longer exists.");
}

/*
 * Editor blocks and plugin rows. The editor's top-level ProseMirror nodes
 * and the plugin's top-level rows come from the same Markdown, so they line
 * up one to one in the ordinary case. The pairing is by position and kind,
 * with text breaking ties, so a block the two parse differently (an editor
 * placeholder, a construct one side folds) costs only that block its
 * pairing, never shifts the ones after it.
 */

/** The plugin kind an editor top-level node is saved as. */
export function editorBlockKind(node: ProseMirrorNode): string {
	switch (node.type.name) {
		case "paragraph":
		case "imageBlock":
			return "paragraph";
		case "heading":
			return "heading";
		case "blockquote":
			return "block_quote";
		case "codeBlock":
			return "code_block";
		case "horizontalRule":
			return "thematic_break";
		case "table":
			return "table";
		case "markdownFrontmatter":
			return "frontmatter";
		case "footnoteDef":
			return "footnote_definition";
		case "markdownUnsupported":
			return node.attrs?.kind === "yaml" ? "frontmatter" : "html_block";
		default:
			return /list$/i.test(node.type.name) ? "list" : node.type.name;
	}
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function inlineText(value: unknown): string {
	if (Array.isArray(value)) return value.map(inlineText).join("");
	if (!value || typeof value !== "object") return "";
	const node = value as {
		type?: unknown;
		value?: unknown;
		children?: unknown;
		alt?: unknown;
	};
	if (node.type === "soft_break" || node.type === "line_break") return " ";
	if (node.type === "code" || node.type === "text")
		return typeof node.value === "string" ? node.value : "";
	if (node.type === "image") return inlineText(node.alt);
	if (node.children) return inlineText(node.children);
	return typeof node.value === "string" && node.type !== "html"
		? node.value
		: "";
}

/** The text a row can be recognised by, or null for a container. */
export function blockRowText(row: MarkdownBlockRow): string | null {
	let payload = row.payload_json;
	if (typeof payload === "string") {
		try {
			payload = JSON.parse(payload);
		} catch {
			return null;
		}
	}
	if (!payload || typeof payload !== "object") return null;
	const value = payload as { inline?: unknown; value?: unknown };
	if (Array.isArray(value.inline))
		return normalizeText(inlineText(value.inline));
	if (typeof value.value === "string") return normalizeText(value.value);
	return null;
}

export type EditorBlock = {
	readonly kind: string;
	readonly text: string;
};

export function editorBlocks(doc: ProseMirrorNode): EditorBlock[] {
	const blocks: EditorBlock[] = [];
	doc.forEach((node) => {
		blocks.push({
			kind: editorBlockKind(node),
			text: normalizeText(
				node.type.name === "imageBlock"
					? String(node.attrs?.alt ?? "")
					: node.textContent,
			),
		});
	});
	return blocks;
}

const MAX_ALIGNMENT_CELLS = 4_000_000;

/**
 * For each editor block, the index of the plugin row it is saved as, or -1.
 * A longest common subsequence over kinds, preferring pairs whose text also
 * agrees; the common case (same length, same kinds) is a straight walk.
 */
export function alignBlocks(
	editor: readonly EditorBlock[],
	rows: readonly MarkdownBlockRow[],
): number[] {
	const rowKinds = rows.map((row) => row.kind);
	if (
		editor.length === rows.length &&
		editor.every((block, index) => block.kind === rowKinds[index])
	) {
		return editor.map((_, index) => index);
	}
	const rowTexts = rows.map(blockRowText);
	const score = (i: number, j: number) => {
		if (editor[i]!.kind !== rowKinds[j]) return 0;
		const text = rowTexts[j];
		return text !== null && text === editor[i]!.text ? 3 : 2;
	};
	const n = editor.length;
	const m = rows.length;
	if (n * m > MAX_ALIGNMENT_CELLS) {
		// Too large to align exhaustively: walk both, skipping a row whose
		// kind does not match.
		const result = new Array<number>(n).fill(-1);
		let j = 0;
		for (let i = 0; i < n && j < m; i++) {
			let k = j;
			while (k < m && k - j < 4 && rowKinds[k] !== editor[i]!.kind) k++;
			if (k < m && rowKinds[k] === editor[i]!.kind) {
				result[i] = k;
				j = k + 1;
			}
		}
		return result;
	}
	// table[i][j]: best score aligning editor[i..] with rows[j..].
	const table = Array.from({ length: n + 1 }, () =>
		new Array<number>(m + 1).fill(0),
	);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			const pair = score(i, j);
			table[i]![j] = Math.max(
				pair > 0 ? pair + table[i + 1]![j + 1]! : 0,
				table[i + 1]![j]!,
				table[i]![j + 1]!,
			);
		}
	}
	const result = new Array<number>(n).fill(-1);
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		const pair = score(i, j);
		if (pair > 0 && table[i]![j] === pair + table[i + 1]![j + 1]!) {
			result[i] = j;
			i++;
			j++;
		} else if (table[i]![j] === table[i + 1]![j]) {
			i++;
		} else {
			j++;
		}
	}
	return result;
}

/**
 * The editor's top-level block index for each commented row id, and the
 * reverse: which row an editor block is saved as.
 */
export type BlockAlignment = {
	readonly rowOfBlock: readonly (string | null)[];
	readonly blockOfRow: ReadonlyMap<string, number>;
};

export function blockAlignment(
	doc: ProseMirrorNode,
	rows: readonly MarkdownBlockRow[],
): BlockAlignment {
	const pairs = alignBlocks(editorBlocks(doc), rows);
	const blockOfRow = new Map<string, number>();
	const rowOfBlock = pairs.map((rowIndex, blockIndex) => {
		if (rowIndex < 0) return null;
		const id = rows[rowIndex]!.id;
		blockOfRow.set(id, blockIndex);
		return id;
	});
	return { rowOfBlock, blockOfRow };
}

/*
 * Where the conversations sit. On a wide panel a margin beside the document
 * column holds one card per commented block, the column staying centred
 * while the margin fits beside it; when the column and the margin do not
 * both fit, the margin goes away and each commented block shows its count
 * just outside its right edge.
 */

/** The document column, `--markdown-content-width`. */
export const DOCUMENT_COLUMN_WIDTH = 768;
export const MARGIN_CARD_WIDTH = 280;
/** Between the column and the margin. */
export const MARGIN_GAP = 40;
/** The column's left gutter and the margin's right gutter on a wide panel. */
export const MARGIN_GUTTER_LEFT = 64;
export const MARGIN_GUTTER_RIGHT = 32;
/** Between stacked margin cards. */
export const MARGIN_CARD_SPACING = 8;

export type BlockCommentLayout = "margin" | "narrow";

export function blockCommentLayout(panelWidth: number): BlockCommentLayout {
	return panelWidth >=
		MARGIN_GUTTER_LEFT +
			DOCUMENT_COLUMN_WIDTH +
			MARGIN_GAP +
			MARGIN_CARD_WIDTH +
			MARGIN_GUTTER_RIGHT
		? "margin"
		: "narrow";
}

/**
 * Where the column starts, from the panel's left, while the margin shows:
 * centred in the panel, as a document without conversations is, with the
 * margin to its right. When the margin would run into the panel's right
 * gutter the column moves left just enough, never past its left gutter
 * (narrower than that, the layout is narrow).
 */
export function marginColumnLeft(panelWidth: number): number {
	const centred = (panelWidth - DOCUMENT_COLUMN_WIDTH) / 2;
	const marginFits =
		panelWidth -
		DOCUMENT_COLUMN_WIDTH -
		MARGIN_GAP -
		MARGIN_CARD_WIDTH -
		MARGIN_GUTTER_RIGHT;
	return Math.max(MARGIN_GUTTER_LEFT, Math.min(centred, marginFits));
}

/**
 * Tops for margin cards that each want to sit level with their block,
 * without overlapping: cards are pushed down past the one above. An active
 * card keeps its block's level and the cards above it make room.
 */
export function stackMarginCards(
	cards: readonly { readonly top: number; readonly height: number }[],
	activeIndex: number,
	spacing: number = MARGIN_CARD_SPACING,
	minTop = 0,
): number[] {
	const tops = cards.map((card) => Math.max(minTop, card.top));
	const place = (from: number) => {
		for (let index = Math.max(1, from); index < cards.length; index++) {
			const floor = tops[index - 1]! + cards[index - 1]!.height + spacing;
			tops[index] = Math.max(cards[index]!.top, minTop, floor);
		}
	};
	place(1);
	if (activeIndex < 0 || activeIndex >= cards.length) return tops;
	const natural = [...tops];
	tops[activeIndex] = Math.max(minTop, cards[activeIndex]!.top);
	for (let index = activeIndex - 1; index >= 0; index--) {
		const ceiling = tops[index + 1]! - spacing - cards[index]!.height;
		tops[index] = Math.min(tops[index]!, ceiling);
	}
	// Cards above never leave the top of the page: when there is not room
	// for them over the active card, the active card goes down instead.
	if (tops[0]! < minTop) return natural;
	place(activeIndex + 1);
	return tops;
}

export type PopoverSide = "below" | "above";

/**
 * Which side of its block a popover opens on (design N2, N5): under it, `drop`
 * below its last line; above it, the same distance above its first line,
 * when there is not room for it under the block in what is showing of the
 * document and there is more above. Never above the document's top, where
 * it could not be scrolled to. All in the scrolling surface's coordinates;
 * `showingTop` and `showingBottom` are what is on screen of it, less the
 * room its shadow needs.
 */
export function popoverSide({
	blockTop,
	blockBottom,
	drop,
	height,
	showingTop,
	showingBottom,
}: {
	readonly blockTop: number;
	readonly blockBottom: number;
	readonly drop: number;
	readonly height: number;
	readonly showingTop: number;
	readonly showingBottom: number;
}): PopoverSide {
	const roomBelow = showingBottom - (blockBottom + drop);
	const roomAbove = blockTop - drop - showingTop;
	const fitsInDocumentAbove = blockTop - drop - height >= 0;
	return roomBelow < height && roomAbove > roomBelow && fitsInDocumentAbove
		? "above"
		: "below";
}
