import {
	createContext,
	memo,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import {
	OpenConversationButton,
	openConversation,
	useConversationViews,
} from "../../conversation/open-conversation";
import type { Editor } from "@tiptap/core";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { CommentBubble } from "./comment-icons";
import { toPlainText } from "@opral/zettel-lexical";
import type { Document } from "@opral/zettel-ast";
import { useLix, useQueryResult } from "@/lib/lix-react";
import { qb, sql } from "@/lib/lix-kysely";
import {
	Composer,
	emptyCommentDocument,
	hasCommentText,
} from "@/components/comments/comment-composer";
import {
	CommentThread,
	authorName,
	formatCommentTime,
	parseCommentBody,
} from "@/components/comments/comment-thread";
import { CommentAvatar } from "@/components/comments/comment-avatar";
import { useEditorCtx } from "../editor/editor-context";
import {
	joinMarkdownEditorSaves,
	markdownEditorLastAcknowledgedMarkdown,
} from "../editor/create-editor";
import type { LixBatchStatement, LixTransaction, SqlParam } from "@lix-js/sdk";
import { buildNormalizedMarkdownIncrementally } from "../editor/incremental-markdown-save";
import {
	blockCommentPluginKey,
	blockNodeId,
	createBlockCommentPlugin,
	setBlockCommentMarks,
	type BlockCommentState,
} from "../editor/extensions/block-comment-decoration";
import {
	MARGIN_CARD_WIDTH,
	MARGIN_GAP,
	blockAlignment,
	blockCommentLayout,
	createBlockConversation,
	replyToBlockConversation,
	selectBlockComments,
	selectCommentAuthors,
	selectMarkdownBlocks,
	stackMarginCards,
	withAuthors,
	type BlockAlignment,
	type BlockCommentLayout,
	type BlockComment,
	type BlockThread,
	type MarkdownBlockRow,
} from "../block-conversations";
import {
	BlockCommentsContext,
	isBlockCommentShortcut,
	selectedTopLevelBlock,
	type BlockCommentsApi,
} from "./block-comments-context";

/** A commented block the editor can place: its thread and where it is. */
type PlacedThread = {
	/**
	 * The card's identity: its first conversation's id. (Not the row: two
	 * cards can briefly share a row while a save moves their conversations.)
	 */
	readonly key: string;
	/** The block's first conversation. */
	readonly thread: BlockThread;
	/**
	 * Every conversation on the block, each its own thread (two meet on one
	 * block when a merge joins their blocks), oldest first.
	 */
	readonly conversations: readonly BlockThread[];
	/** Top-level index in the editor document. */
	readonly index: number;
};

/** A comment being written on a block that has none yet (design N2). */
type PendingComment = {
	/** The block's stable editor id; its index when it has none. */
	readonly blockId: string | null;
	readonly index: number;
	readonly focus: number;
};

type ActiveConversation = {
	readonly nodeId: string;
	/** Increment to put the caret in its reply field. */
	readonly focus: number;
};

/**
 * What the pointer is on: a commented block, or its card or count. Each
 * tints the other (design N4), never itself.
 */
type Hover = {
	readonly nodeId: string;
	readonly from: "block" | "margin";
};

function sameHover(a: Hover | null, b: Hover | null): boolean {
	return a?.nodeId === b?.nodeId && a?.from === b?.from;
}

type BlockConversationsState = {
	readonly editor: Editor;
	readonly layout: BlockCommentLayout;
	readonly setLayout: (layout: BlockCommentLayout) => void;
	readonly placed: readonly PlacedThread[];
	readonly pending: PendingComment | null;
	readonly pendingIndex: number;
	readonly pendingDraft: Document;
	readonly setPendingDraft: (draft: Document) => void;
	readonly submitPending: (body: Document) => Promise<void>;
	readonly cancelPending: (refocus: boolean) => void;
	readonly active: ActiveConversation | null;
	readonly activate: (nodeId: string | null, focus?: boolean) => void;
	/** Closes the open conversation and puts the caret back in the document. */
	readonly returnToEditor: () => void;
	readonly hovered: Hover | null;
	readonly setHovered: (hover: Hover | null) => void;
	readonly replyDraft: (nodeId: string) => Document;
	readonly setReplyDraft: (nodeId: string, draft: Document) => void;
	readonly submitReply: (
		nodeId: string,
		conversationId: string,
		body: Document,
	) => Promise<void>;
	readonly authorName: string;
	/** Said when comments could not be kept on their blocks by a save. */
	readonly notice: string | null;
	/**
	 * Conversations deleted with their block by someone else's write while
	 * the document was open (Lix deletes the conversations on a deleted row).
	 */
	readonly removed: readonly string[];
	readonly dismissRemoved: () => void;
};

const BlockConversationsStateContext =
	createContext<BlockConversationsState | null>(null);

const EMPTY_ROWS: readonly never[] = [];

function selectActiveAccountName(lix: Parameters<typeof qb>[0]) {
	return qb(lix)
		.selectFrom("lix_account")
		.select("name")
		.where("id", "=", sql<string>`lix_active_account_id()`)
		.$castTo<{ name: string | null }>();
}

/**
 * The top-level blocks of a document, by kind and editor id, to know when
 * blocks moved or were replaced (an external write gives every block a new
 * id while the kinds stay the same).
 */
function structureOf(editor: Editor): string {
	return structureOfDoc(editor.state.doc);
}

function structureOfDoc(doc: ProseMirrorNode): string {
	const blocks: string[] = [];
	doc.forEach((node) =>
		blocks.push(`${node.type.name}:${blockNodeId(node) ?? ""}`),
	);
	return blocks.join(",");
}

function topLevelIndexOfId(editor: Editor, blockId: string): number {
	let found = -1;
	editor.state.doc.forEach((node, _offset, index) => {
		if (found < 0 && blockNodeId(node) === blockId) found = index;
	});
	return found;
}

function topLevelOffset(editor: Editor, index: number): number | null {
	const { doc } = editor.state;
	if (index < 0 || index >= doc.childCount) return null;
	let offset = 0;
	for (let child = 0; child < index; child++)
		offset += doc.child(child).nodeSize;
	return offset;
}

function blockElement(editor: Editor, index: number): HTMLElement | null {
	const offset = topLevelOffset(editor, index);
	if (offset === null) return null;
	const dom = editor.view.nodeDOM(offset);
	return dom instanceof HTMLElement ? dom : null;
}

/** Whether the editor's view is mounted: reading `view.dom` throws before. */
function hasView(editor: Editor): boolean {
	if (editor.isDestroyed) return false;
	try {
		return Boolean(editor.view.dom);
	} catch {
		return false;
	}
}

function useEditorViewReady(editor: Editor): boolean {
	const [ready, setReady] = useState(() => hasView(editor));
	useEffect(() => {
		const update = () => setReady(hasView(editor));
		update();
		editor.on("mount", update);
		editor.on("unmount", update);
		editor.on("destroy", update);
		return () => {
			editor.off("mount", update);
			editor.off("unmount", update);
			editor.off("destroy", update);
		};
	}, [editor]);
	return ready;
}

/**
 * Where a conversation is in the editor: its block's editor id, and while
 * that block is gone (or emptied, its text moved), the blocks that took it
 * in, in the order they did. Undo brings the earlier ones back, and the
 * earliest one present carries the conversation, so an undo puts it back
 * exactly where it came from.
 */
type Carrier = {
	readonly blockId: string;
	readonly trail: readonly string[];
	/** Where to look when none of those blocks is left. */
	readonly standInIndex: number;
	/** What the gone block held, to know it again when it is pasted back. */
	readonly lost?: string;
};

type BlockPositions = ReadonlyMap<
	string,
	{ readonly index: number; readonly empty: boolean }
>;

/** The id of the block carrying a conversation in a document, if any. */
function carrierBlock(blocks: BlockPositions, carrier: Carrier): string | null {
	const own = blocks.get(carrier.blockId);
	// Its own block, unless it was emptied and its text went on elsewhere.
	if (own && (!own.empty || carrier.trail.length === 0)) return carrier.blockId;
	for (const id of carrier.trail) if (blocks.has(id)) return id;
	return own ? carrier.blockId : null;
}

function carrierPosition(
	blocks: BlockPositions,
	carrier: Carrier,
): number | null {
	const id = carrierBlock(blocks, carrier);
	return id === null ? null : blocks.get(id)!.index;
}

function blocksById(doc: ProseMirrorNode): BlockPositions {
	const blocks = new Map<string, { index: number; empty: boolean }>();
	doc.forEach((node, _offset, index) => {
		const id = blockNodeId(node);
		if (id) blocks.set(id, { index, empty: node.content.size === 0 });
	});
	return blocks;
}

/** A block's kind and text, the only way to know a pasted block again. */
function blockSignature(node: ProseMirrorNode): string | null {
	const text = node.textContent.trim();
	return text ? `${node.type.name}:${text}` : null;
}

function carrierIndex(doc: ProseMirrorNode, carrier: Carrier): number {
	return (
		carrierPosition(blocksById(doc), carrier) ??
		Math.min(carrier.standInIndex, doc.childCount - 1)
	);
}

/** One thread per conversation, oldest conversation first. */
function groupConversationThreads(
	comments: readonly BlockComment[],
): ReadonlyMap<string, BlockThread> {
	const threads = new Map<string, BlockThread>();
	for (const comment of comments) {
		const thread = threads.get(comment.conversation_id);
		if (thread) (thread.comments as BlockComment[]).push(comment);
		else
			threads.set(comment.conversation_id, {
				nodeId: comment.node_id,
				conversationId: comment.conversation_id,
				comments: [comment],
			});
	}
	return threads;
}

function commentCount(entry: PlacedThread): number {
	return entry.conversations.reduce(
		(count, conversation) => count + conversation.comments.length,
		0,
	);
}

/** The row of the block at `index`, or of the nearest block that has one. */
function nearestRow(
	rowOfBlock: readonly (string | null)[],
	index: number,
): string | null {
	for (let distance = 0; distance < rowOfBlock.length; distance++) {
		const before = rowOfBlock[index - distance];
		if (before) return before;
		const after = rowOfBlock[index + distance];
		if (after) return after;
	}
	return null;
}

function draftKey(pending: {
	readonly blockId: string | null;
	readonly index: number;
}): string {
	return pending.blockId ?? `#${pending.index}`;
}

const wait = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Block conversations for the live document: the selection toolbar's
 * Comment row and ⌘⌥M, the marks on commented blocks, and the state the
 * margin and popovers render from (`BlockConversationsLayer`). Without
 * `enabled` (a review, a read-only host) there is nothing to comment on.
 */
export function BlockConversations({
	fileId,
	enabled,
	children,
}: {
	readonly fileId: string;
	readonly enabled: boolean;
	readonly children: ReactNode;
}) {
	const { editor } = useEditorCtx();
	const live = enabled && editor !== null && !editor.isDestroyed;
	// The controller is headless and publishes up, so the document under
	// these providers keeps its place in the tree whether or not it is on.
	const [published, setPublished] = useState<{
		readonly api: BlockCommentsApi;
		readonly state: BlockConversationsState;
	} | null>(null);
	return (
		<BlockCommentsContext.Provider value={published?.api ?? null}>
			<BlockConversationsStateContext.Provider value={published?.state ?? null}>
				{live && editor ? (
					<BlockConversationsController
						key={`${fileId}:${editor.instanceId}`}
						fileId={fileId}
						editor={editor}
						onPublish={setPublished}
					/>
				) : null}
				{children}
			</BlockConversationsStateContext.Provider>
		</BlockCommentsContext.Provider>
	);
}

const BlockConversationsController = memo(
	function BlockConversationsController({
		fileId,
		editor,
		onPublish,
	}: {
		readonly fileId: string;
		readonly editor: Editor;
		readonly onPublish: (
			value: {
				readonly api: BlockCommentsApi;
				readonly state: BlockConversationsState;
			} | null,
		) => void;
	}) {
		const lix = useLix();
		const viewReady = useEditorViewReady(editor);
		const blocksResult = useQueryResult<MarkdownBlockRow>((session) =>
			selectMarkdownBlocks(session, fileId),
		);
		const commentsResult = useQueryResult((session) =>
			selectBlockComments(session, fileId),
		);
		const accountResult = useQueryResult(selectActiveAccountName);
		const rows = blocksResult.rows.length ? blocksResult.rows : EMPTY_ROWS;
		const commentRows = commentsResult.rows.length
			? commentsResult.rows
			: EMPTY_ROWS;
		// Authors are read once per set of comments, not observed.
		const changeIds = useMemo(
			() =>
				[
					...new Set(
						commentRows
							.map((comment) => comment.change_id)
							.filter((id): id is string => Boolean(id)),
					),
				].sort(),
			[commentRows],
		);
		const authorsResult = useQueryResult(
			(session) => selectCommentAuthors(session, changeIds),
			{ subscribe: false, enabled: changeIds.length > 0 },
		);
		// A pending read hands out a fresh empty array on every render.
		const authors =
			authorsResult.status === "success" ? authorsResult.rows : EMPTY_ROWS;
		const comments = useMemo(
			() => withAuthors(commentRows, authors),
			[authors, commentRows],
		);
		const threads = useMemo(
			() => groupConversationThreads(comments),
			[comments],
		);

		// The pairing of editor blocks with rows changes only when blocks move.
		const [structure, setStructure] = useState(() => structureOf(editor));
		useEffect(() => {
			// Every document change, including one loaded from the file without
			// an "update" (an external write).
			const onTransaction = ({ transaction }: { transaction: Transaction }) => {
				if (transaction.docChanged) setStructure(structureOf(editor));
			};
			editor.on("transaction", onTransaction);
			return () => {
				editor.off("transaction", onTransaction);
			};
		}, [editor]);
		const alignment = useMemo<BlockAlignment>(
			() => blockAlignment(editor.state.doc, rows),
			// `structure` stands for the document's block order.
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[editor, rows, structure],
		);
		// Which block carries each conversation, followed through edits in the
		// editor rather than read back from rows that lag the edit by a save.
		const carriers = useRef(new Map<string, Carrier>());
		// Conversations let go of their rows by a save that found no row for
		// them (the document emptied) or could not finish: kept here, and put
		// back on their blocks by the next save that changes the blocks.
		const detachedIds = useRef(new Set<string>());
		const [carrierVersion, setCarrierVersion] = useState(0);
		const placed = useMemo<PlacedThread[]>(() => {
			const { doc } = editor.state;
			// A conversation first seen is found by its row, which is only
			// right once the document on screen is saved: until then rows lag.
			let rowsCurrent: boolean | null = null;
			for (const thread of threads.values()) {
				if (carriers.current.has(thread.conversationId)) continue;
				rowsCurrent ??=
					markdownEditorLastAcknowledgedMarkdown(editor) ===
					buildNormalizedMarkdownIncrementally(doc);
				if (!rowsCurrent) continue;
				const index = alignment.blockOfRow.get(thread.nodeId);
				const blockId =
					index !== undefined && index < doc.childCount
						? blockNodeId(doc.child(index))
						: null;
				if (blockId)
					carriers.current.set(thread.conversationId, {
						blockId,
						trail: [],
						standInIndex: index!,
					});
			}
			const blocks = blocksById(doc);
			const byIndex = new Map<number, BlockThread[]>();
			for (const thread of threads.values()) {
				const carrier = carriers.current.get(thread.conversationId);
				const index = carrier
					? (carrierPosition(blocks, carrier) ??
						Math.min(carrier.standInIndex, doc.childCount - 1))
					: alignment.blockOfRow.get(thread.nodeId);
				if (index === undefined || index < 0) continue;
				const onBlock = byIndex.get(index);
				if (onBlock) onBlock.push(thread);
				else byIndex.set(index, [thread]);
			}
			return [...byIndex]
				.map(([index, conversations]) => ({
					key: conversations[0]!.conversationId,
					thread: conversations[0]!,
					conversations,
					index,
				}))
				.sort((a, b) => a.index - b.index);
			// `structure` and `carrierVersion` stand for the document's blocks
			// and where the conversations are among them.
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [alignment, threads, structure, carrierVersion]);

		const [layout, setLayout] = useState<BlockCommentLayout>("narrow");
		const [pending, setPending] = useState<PendingComment | null>(null);
		// Drafts are kept per block, like History's per checkpoint: Esc or
		// commenting on another block puts a draft away, it does not drop it.
		const [pendingDrafts, setPendingDrafts] = useState<
			ReadonlyMap<string, Document>
		>(() => new Map());
		const [active, setActive] = useState<ActiveConversation | null>(null);
		const [hovered, setHoveredState] = useState<Hover | null>(null);
		// The same hover again is no change (every pointer event reports it).
		const setHovered = useCallback((next: Hover | null) => {
			setHoveredState((current) => (sameHover(current, next) ? current : next));
		}, []);
		const [replyDrafts, setReplyDrafts] = useState<
			ReadonlyMap<string, Document>
		>(() => new Map());

		// A conversation whose block went away closes with it.
		useEffect(() => {
			if (active && !placed.some((entry) => entry.key === active.nodeId))
				setActive(null);
		}, [active, placed]);

		const pendingIndex = pending
			? pending.blockId
				? topLevelIndexOfId(editor, pending.blockId)
				: pending.index
			: -1;
		const pendingKey = pending ? draftKey(pending) : null;
		const pendingDraft =
			(pendingKey && pendingDrafts.get(pendingKey)) || EMPTY_DRAFT;
		const setPendingDraft = useCallback(
			(draft: Document) => {
				if (!pendingKey) return;
				setPendingDrafts((drafts) => new Map(drafts).set(pendingKey, draft));
			},
			[pendingKey],
		);

		// A file the plugin does not project (it matches `*.md` by case, so
		// `NOTES.MD` has no rows) has no block to attach to.
		const available =
			blocksResult.status === "success" && blocksResult.rows.length > 0;
		// The thread each editor block shows, by its index.
		const threadAtBlock = useMemo(
			() => new Map(placed.map((entry) => [entry.index, entry.key])),
			[placed],
		);
		const latest = useRef({
			threads,
			layout,
			available,
			threadAtBlock,
			placed,
		});
		latest.current = { threads, layout, available, threadAtBlock, placed };

		const activate = useCallback((nodeId: string | null, focus = false) => {
			setActive((current) => {
				if (nodeId === null) return null;
				const focusCount = (current?.focus ?? 0) + (focus ? 1 : 0);
				return { nodeId, focus: focusCount };
			});
			if (nodeId !== null) setPending(null);
		}, []);

		const activeRef = useRef(active);
		activeRef.current = active;
		// Esc from a conversation: the editor takes focus back, with the caret
		// in the commented block unless it already is (a click into the block
		// opened it). From a card or a count the focus was never there.
		const returnToEditor = useCallback(() => {
			const nodeId = activeRef.current?.nodeId;
			setActive(null);
			if (!nodeId || !hasView(editor) || editor.view.hasFocus()) return;
			const entry = latest.current.placed.find(
				(candidate) => candidate.key === nodeId,
			);
			const offset = entry ? topLevelOffset(editor, entry.index) : null;
			editor
				.chain()
				.focus(null, { scrollIntoView: false })
				.command(({ tr }) => {
					if (offset === null) return true;
					const block = tr.doc.child(entry!.index);
					const { from } = tr.selection;
					if (from > offset && from < offset + block.nodeSize) return true;
					tr.setSelection(TextSelection.near(tr.doc.resolve(offset + 1)));
					return true;
				})
				.run();
		}, [editor]);

		const startComment = useCallback(() => {
			if (editor.isDestroyed || !latest.current.available) return;
			const index = selectedTopLevelBlock(editor.state);
			if (index === null) return;
			const nodeId = latest.current.threadAtBlock.get(index);
			// A block has one conversation: commenting again opens it.
			if (nodeId) {
				activate(nodeId, true);
				return;
			}
			const node = editor.state.doc.child(index);
			// The comment is on the block: the selected characters are dropped.
			const { selection } = editor.state;
			if (selection instanceof TextSelection && !selection.empty)
				editor.commands.setTextSelection(selection.to);
			setActive(null);
			setPending((current) => ({
				blockId: blockNodeId(node),
				index,
				focus: (current?.focus ?? 0) + 1,
			}));
		}, [activate, editor]);

		const cancelPending = useCallback(
			(refocus: boolean) => {
				setPending(null);
				if (refocus && !editor.isDestroyed)
					editor.chain().focus(null, { scrollIntoView: false }).run();
			},
			[editor],
		);

		const submitPending = useCallback(
			async (body: Document) => {
				if (!pending) return;
				// The block's row, read once the document on screen is saved: a
				// block typed just now has no row until then.
				let nodeId: string | null = null;
				let blockIndex = -1;
				for (let attempt = 0; attempt < 20 && !nodeId; attempt++) {
					if (attempt > 0) await wait(150);
					if (editor.isDestroyed) throw new Error("The document was closed.");
					blockIndex = pending.blockId
						? topLevelIndexOfId(editor, pending.blockId)
						: pending.index;
					if (blockIndex < 0) throw new Error("This block was removed.");
					const doc = editor.state.doc;
					if (
						markdownEditorLastAcknowledgedMarkdown(editor) !==
						buildNormalizedMarkdownIncrementally(doc)
					)
						continue;
					const currentRows = (await selectMarkdownBlocks(
						lix,
						fileId,
					).execute()) as MarkdownBlockRow[];
					nodeId =
						blockAlignment(doc, currentRows).rowOfBlock[blockIndex] ?? null;
				}
				if (!nodeId)
					throw new Error(
						"This block is not saved yet. Try again in a moment.",
					);
				const conversationId = await createBlockConversation(
					lix,
					fileId,
					nodeId,
					body,
				);
				const blockId = blockNodeId(editor.state.doc.child(blockIndex));
				if (blockId)
					carriers.current.set(conversationId, {
						blockId,
						trail: [],
						standInIndex: blockIndex,
					});
				setPending(null);
				setPendingDrafts((drafts) => {
					const next = new Map(drafts);
					next.delete(draftKey(pending));
					return next;
				});
				if (!editor.isDestroyed)
					editor.chain().focus(null, { scrollIntoView: false }).run();
			},
			[editor, fileId, lix, pending],
		);

		const submitReply = useCallback(
			async (nodeId: string, conversationId: string, body: Document) => {
				await replyToBlockConversation(lix, conversationId, body);
				setReplyDrafts((drafts) => {
					const next = new Map(drafts);
					next.delete(nodeId);
					return next;
				});
			},
			[lix],
		);

		const replyDraft = useCallback(
			(nodeId: string) => replyDrafts.get(nodeId) ?? EMPTY_DRAFT,
			[replyDrafts],
		);
		const setReplyDraft = useCallback((nodeId: string, draft: Document) => {
			setReplyDrafts((drafts) => new Map(drafts).set(nodeId, draft));
		}, []);

		// The marks: which blocks carry a wash, and how deep.
		useEffect(() => {
			if (!viewReady) return;
			if (!blockCommentPluginKey.getState(editor.state))
				editor.registerPlugin(createBlockCommentPlugin());
			return () => {
				if (hasView(editor)) editor.unregisterPlugin(blockCommentPluginKey);
			};
		}, [editor, viewReady]);
		useEffect(() => {
			if (!viewReady) return;
			const marks = new Map<string, BlockCommentState>();
			const { doc } = editor.state;
			for (const { key, index } of placed) {
				if (index >= doc.childCount) continue;
				const id = blockNodeId(doc.child(index));
				if (!id) continue;
				marks.set(
					id,
					active?.nodeId === key
						? "active"
						: hovered?.from === "margin" && hovered.nodeId === key
							? "hover"
							: "rest",
				);
			}
			if (pendingIndex >= 0 && pendingIndex < doc.childCount) {
				const id = blockNodeId(doc.child(pendingIndex));
				if (id) marks.set(id, "active");
			}
			setBlockCommentMarks(editor, marks);
		}, [active, editor, hovered, pendingIndex, placed, structure, viewReady]);

		// A conversation belongs to the block the writer sees. Lix keeps it on
		// a row, and a save re-derives the rows: a block merged away, cut or
		// deleted takes its row with it, and Lix deletes the conversations on a
		// deleted row. So the editor follows each conversation's block through
		// edits (a merge hands it to the block merged into, a split keeps it on
		// the first half, a deletion hands it to the block that takes the
		// deleted one's place, undo gives it back), and every save that changes
		// the blocks moves the conversations in its own transaction: let go of
		// their rows before the write, put on their blocks' new rows after it.
		// What the last save left: the blocks and the conversations' places.
		// Empty until a save has placed them.
		const lastSavedStructure = useRef("");
		const [notice, setNotice] = useState<string | null>(null);

		// A conversation that leaves the comments without this editor letting
		// it go of its row: deleted. When its block's row went too, it went
		// with the block (someone else's write removed the block), and the
		// writer is told, with the way to the conversation's removed page.
		const [removed, setRemoved] = useState<readonly string[]>([]);
		const dismissRemoved = useCallback(() => setRemoved([]), []);
		const seenThreads = useRef(new Map<string, BlockThread>());
		useEffect(() => {
			if (commentsResult.status !== "success") return;
			const left = [...seenThreads.current.values()].filter(
				(thread) =>
					!threads.has(thread.conversationId) &&
					!detachedIds.current.has(thread.conversationId),
			);
			seenThreads.current = new Map(threads);
			if (left.length === 0) return;
			let cancelled = false;
			void (async () => {
				const ids = left.map((thread) => thread.conversationId);
				const list = (values: readonly string[]) =>
					values.map((_, index) => `$${index + 1}`).join(", ");
				const existing = await lix.execute(
					`SELECT id FROM lix_conversation WHERE id IN (${list(ids)})`,
					ids,
				);
				const exists = new Set(
					existing.rows.map((row) => String((row as { id: unknown }).id)),
				);
				const deleted = left.filter(
					(thread) => !exists.has(thread.conversationId),
				);
				if (deleted.length === 0) return;
				const nodeIds = deleted.map((thread) => thread.nodeId);
				const blockRows = await lix.execute(
					`SELECT id FROM markdown_node WHERE lixcol_file_id = $${nodeIds.length + 1} AND id IN (${list(nodeIds)})`,
					[...nodeIds, fileId],
				);
				const stillThere = new Set(
					blockRows.rows.map((row) => String((row as { id: unknown }).id)),
				);
				for (const thread of deleted)
					carriers.current.delete(thread.conversationId);
				const withBlock = deleted
					.filter((thread) => !stillThere.has(thread.nodeId))
					.map((thread) => thread.conversationId);
				if (!cancelled && withBlock.length > 0)
					setRemoved((current) => [...current, ...withBlock]);
			})().catch((error: unknown) => console.error(error));
			return () => {
				cancelled = true;
			};
		}, [commentsResult.status, fileId, lix, threads]);
		useEffect(() => {
			const onTransaction = ({ transaction }: { transaction: Transaction }) => {
				if (!transaction.docChanged || carriers.current.size === 0) return;
				const after = editor.state.doc;
				// A document loaded from the file (an external write) has new block
				// ids. The rows are the truth after it: a conversation on a row is
				// found again from its row once they are read; one let go of its
				// row is known again by its text, or waits where it was.
				if (transaction.getMeta("preventUpdate")) {
					// A block the outside write left alone keeps its conversation,
					// with the way back an undo of the writer's own edits takes.
					const survivors = blocksById(after);
					const beforeBlocks = blocksById(transaction.before);
					const bySignature = new Map<string, string>();
					after.forEach((node) => {
						const id = blockNodeId(node);
						const signature = blockSignature(node);
						if (id && signature && !bySignature.has(signature))
							bySignature.set(signature, id);
					});
					const texts = new Map<string, string | null>();
					transaction.before.forEach((node) => {
						const id = blockNodeId(node);
						if (id) texts.set(id, blockSignature(node));
					});
					for (const [conversationId, carrier] of carriers.current) {
						const carrying = carrierBlock(beforeBlocks, carrier);
						if (carrying !== null && survivors.has(carrying)) continue;
						// Its block was rewritten by the outside write: the rows say
						// where the conversation is now, and it is found from them.
						if (!detachedIds.current.has(conversationId)) {
							carriers.current.delete(conversationId);
							continue;
						}
						const signature =
							carrier.lost ?? texts.get(carrier.blockId) ?? null;
						const found = signature ? bySignature.get(signature) : undefined;
						if (found)
							carriers.current.set(conversationId, {
								blockId: found,
								trail: [],
								standInIndex: carrier.standInIndex,
							});
					}
					setCarrierVersion((version) => version + 1);
					return;
				}
				const present = blocksById(after);
				const before = new Map<
					string,
					{ readonly offset: number; readonly node: ProseMirrorNode }
				>();
				transaction.before.forEach((node, offset) => {
					const id = blockNodeId(node);
					if (id) before.set(id, { offset, node });
				});
				// Blocks this edit brought in (a paste, the text Enter pushed
				// down), by what they hold. Read only for the few new blocks.
				let arrivedCache: Map<string, string> | null = null;
				const arrived = (): Map<string, string> => {
					if (arrivedCache) return arrivedCache;
					const found = new Map<string, string>();
					after.forEach((node) => {
						const id = blockNodeId(node);
						if (!id || before.has(id)) return;
						const signature = blockSignature(node);
						if (signature && !found.has(signature)) found.set(signature, id);
					});
					arrivedCache = found;
					return found;
				};
				// The block that took in a block's text when the block was emptied
				// in this step: a new one (Enter at its start), or one that gained
				// the text (a drag).
				const tookText = (text: string, from: string): string | undefined => {
					let found: string | undefined;
					after.forEach((node) => {
						if (found) return;
						const id = blockNodeId(node);
						if (!id || id === from) return;
						if (!node.textContent.includes(text)) return;
						const was = before.get(id)?.node.textContent;
						if (was === undefined || !was.includes(text)) found = id;
					});
					return found;
				};
				let changed = false;
				const move = (conversationId: string, next: Carrier) => {
					carriers.current.set(conversationId, next);
					changed = true;
				};
				for (const [conversationId, carrier] of carriers.current) {
					const own = present.get(carrier.blockId);
					if (own) {
						const previous = before.get(carrier.blockId)?.node;
						const text = previous?.textContent.trim() ?? "";
						if (own.empty && text) {
							// Emptied, its text gone on: a new block holding all of it
							// (Enter at the start) becomes its block; a block that took
							// it in (a drag) carries it until an undo refills its own.
							const pushedDown = arrived().get(blockSignature(previous!)!);
							if (pushedDown) {
								move(conversationId, {
									blockId: pushedDown,
									trail: [],
									standInIndex: present.get(pushedDown)!.index,
								});
								continue;
							}
							const moved = tookText(text, carrier.blockId);
							if (moved) {
								move(conversationId, {
									...carrier,
									trail: [...carrier.trail, moved],
									standInIndex: present.get(moved)!.index,
								});
								continue;
							}
						}
						// Its own block, back and whole (an undo): the trail is spent.
						if (!own.empty && carrier.trail.length > 0)
							move(conversationId, { ...carrier, trail: [] });
						continue;
					}
					// The block pasted back after a cut: the conversation goes with it.
					const pasted = carrier.lost ? arrived().get(carrier.lost) : undefined;
					if (pasted) {
						move(conversationId, {
							blockId: pasted,
							trail: [],
							standInIndex: present.get(pasted)!.index,
						});
						continue;
					}
					if (carrier.trail.some((id) => present.has(id))) continue;
					// The block that carried it went in this step: it goes where
					// that block's first character went, into the block before on
					// a merge, onto the block after when it was deleted. The move
					// is added to the trail, so an undo walks it back.
					const from = carrierBlock(blocksById(transaction.before), carrier);
					const gone = from ? before.get(from) : undefined;
					if (!gone) continue;
					const mapped = transaction.mapping.map(gone.offset + 1, -1);
					const at = after.resolve(Math.min(mapped, after.content.size));
					const index = Math.min(at.index(0), after.childCount - 1);
					const standIn = index >= 0 ? blockNodeId(after.child(index)) : null;
					const ownNode = before.get(carrier.blockId)?.node;
					move(conversationId, {
						...carrier,
						trail: standIn ? [...carrier.trail, standIn] : carrier.trail,
						standInIndex: Math.max(0, index),
						lost:
							carrier.lost ??
							(ownNode ? blockSignature(ownNode) : null) ??
							undefined,
					});
				}
				if (changed) setCarrierVersion((version) => version + 1);
			};
			editor.on("transaction", onTransaction);

			/**
			 * What moves the conversations with a save of `doc`: one statement
			 * that lets them go of their rows, and the work that puts each on
			 * its block's new row once the file is re-projected.
			 */
			const plan = (doc: ProseMirrorNode) => {
				const conversationIds = [...carriers.current.keys()];
				if (conversationIds.length === 0) return null;
				const targets = conversationIds.map(
					(id) => [id, carrierIndex(doc, carriers.current.get(id)!)] as const,
				);
				// The blocks, and which block each conversation is on: a move that
				// keeps every block (a drag emptying one) is a move all the same.
				const savedStructure = `${structureOfDoc(doc)}|${targets
					.map(([id, index]) => `${id}:${index}`)
					.join(",")}`;
				let unplacedIds: string[] = [];
				let goneIds: string[] = [];
				// Let go of their rows before this save (by an earlier one).
				const wereDetached = new Set(detachedIds.current);
				const list = (ids: readonly string[]) =>
					ids.map((_, index) => `$${index + 1}`).join(", ");
				const releaseOf = (ids: readonly string[]): LixBatchStatement => ({
					sql: `UPDATE lix_conversation SET target = NULL WHERE lixcol_global = false AND id IN (${list(ids)})`,
					params: [...ids],
				});
				const existingIn = async (transaction: LixTransaction) => {
					const existing = await transaction.execute(
						`SELECT id FROM lix_conversation WHERE id IN (${list(conversationIds)})`,
						conversationIds,
					);
					return new Set(
						existing.rows.map((row) => String((row as { id: unknown }).id)),
					);
				};
				// Learned by the save's rehearsal: the conversations whose rows the
				// write deletes. Only these are let go of before it; every other
				// conversation is left alone unless its block's row changes.
				let atRisk: string[] = [];
				const rehearse = async (transaction: LixTransaction) => {
					const survived = await existingIn(transaction);
					const before = await lix.execute(
						`SELECT id FROM lix_conversation WHERE id IN (${list(conversationIds)})`,
						conversationIds,
					);
					atRisk = before.rows
						.map((row) => String((row as { id: unknown }).id))
						.filter((id) => !survived.has(id));
				};
				const attach = async (transaction: LixTransaction) => {
					const query = selectMarkdownBlocks(lix, fileId).compile();
					const saved = await transaction.execute(
						query.sql,
						query.parameters as SqlParam[],
					);
					const { rowOfBlock } = blockAlignment(
						doc,
						saved.rows as unknown as MarkdownBlockRow[],
					);
					// Conversations deleted meanwhile (by hand, or with their block
					// by someone else's write) are let go of for good.
					const exists = await existingIn(transaction);
					goneIds = conversationIds.filter((id) => !exists.has(id));
					unplacedIds = [];
					for (const [conversationId, index] of targets) {
						if (!exists.has(conversationId)) continue;
						const nodeId = nearestRow(rowOfBlock, index);
						if (!nodeId) {
							unplacedIds.push(conversationId);
							continue;
						}
						// A conversation already on its block's row is not written:
						// a re-hook that changes nothing leaves no change behind.
						// (One statement each: Lix SQL has no CASE in an UPDATE's
						// SET, opral/lix#1901.)
						const current = await transaction.execute(
							"SELECT target = lix_row_ref('markdown_node', $2, $3) AS same FROM lix_conversation WHERE id = $1",
							[conversationId, fileId, nodeId],
						);
						if (
							(current.rows[0] as { same?: unknown } | undefined)?.same === true
						)
							continue;
						await transaction.execute(
							"UPDATE lix_conversation SET target = lix_row_ref('markdown_node', $2, $3) WHERE id = $1",
							[conversationId, fileId, nodeId],
						);
					}
				};
				const committed = () => {
					lastSavedStructure.current = savedStructure;
					for (const id of goneIds) {
						carriers.current.delete(id);
						detachedIds.current.delete(id);
					}
					// Without a row to be put on (the document was emptied), the ones
					// let go of stay let go of, and kept, until a save gives their
					// blocks rows; every other one is on its row.
					for (const id of conversationIds) {
						const letGo =
							unplacedIds.includes(id) &&
							(atRisk.includes(id) || wereDetached.has(id));
						if (letGo) detachedIds.current.add(id);
						else detachedIds.current.delete(id);
					}
					setNotice(null);
				};
				return {
					structure: savedStructure,
					rehearse,
					before: (): readonly LixBatchStatement[] =>
						atRisk.length > 0 ? [releaseOf(atRisk)] : [],
					lastResort: releaseOf(conversationIds),
					attach,
					committed,
				};
			};

			// Puts conversations back on their rows outside a save, after a save
			// had to go out without them.
			let reattaching: ReturnType<typeof setTimeout> | null = null;
			const reattachSoon = (attempt = 0) => {
				if (reattaching) clearTimeout(reattaching);
				reattaching = setTimeout(async () => {
					reattaching = null;
					if (editor.isDestroyed) return;
					const doc = editor.state.doc;
					// Only against the rows of the document on screen.
					if (
						markdownEditorLastAcknowledgedMarkdown(editor) !==
						buildNormalizedMarkdownIncrementally(doc)
					) {
						if (attempt < 40) reattachSoon(attempt + 1);
						return;
					}
					const work = plan(doc);
					if (!work) return;
					const transaction = await lix.beginTransaction();
					try {
						await work.attach(transaction);
						await transaction.commit();
						work.committed();
					} catch (error) {
						await transaction.rollback().catch(() => {});
						if (attempt < 40) reattachSoon(attempt + 1);
						else console.error(error);
					}
				}, 250);
			};

			const leave = joinMarkdownEditorSaves(editor, {
				prepare: (doc) => {
					const work = plan(doc);
					if (!work) return null;
					// Typing inside blocks keeps every row.
					if (
						work.structure === lastSavedStructure.current &&
						detachedIds.current.size === 0
					)
						return null;
					// Let go of from the moment the save starts: the conversations
					// can drop out of the comments query before the commit's result
					// arrives, and must not be forgotten in between.
					for (const id of carriers.current.keys()) detachedIds.current.add(id);
					return {
						rehearse: work.rehearse,
						before: work.before,
						lastResort: [work.lastResort],
						after: work.attach,
						committed: work.committed,
						degraded: (cause) => {
							console.error(cause);
							for (const id of carriers.current.keys())
								detachedIds.current.add(id);
							setNotice(
								"Saved. The comments on changed blocks are being put back on them.",
							);
							reattachSoon();
						},
					};
				},
			});
			return () => {
				if (reattaching) clearTimeout(reattaching);
				editor.off("transaction", onTransaction);
				leave();
			};
		}, [editor, fileId, lix]);

		// ⌘⌥M, and clicking into a commented block.
		useEffect(() => {
			if (!viewReady) return;
			const dom = editor.view.dom;
			const nodeIdAt = (target: EventTarget | null): string | null => {
				if (!(target instanceof Node) || !dom.contains(target)) return null;
				let element: Node | null = target;
				while (element && element.parentNode !== dom)
					element = element.parentNode;
				if (!element) return null;
				let position: number;
				try {
					position = editor.view.posAtDOM(element, 0);
				} catch {
					return null;
				}
				const index = editor.state.doc.resolve(position).index(0);
				return latest.current.threadAtBlock.get(index) ?? null;
			};
			const onKeyDown = (event: KeyboardEvent) => {
				if (isBlockCommentShortcut(event)) {
					event.preventDefault();
					startComment();
				}
			};
			// The block under the click, not the state's selection: ProseMirror
			// may not have read the click's caret yet.
			const onClick = (event: MouseEvent) => {
				if (latest.current.layout !== "margin") return;
				const nodeId =
					nodeIdAt(event.target) ?? nodeIdAtPoint(event.clientX, event.clientY);
				if (nodeId) activate(nodeId);
				else setActive(null);
			};
			const nodeIdAtPoint = (left: number, top: number): string | null => {
				const hit = editor.view.posAtCoords({ left, top });
				if (!hit) return null;
				const index = editor.state.doc.resolve(hit.pos).index(0);
				return latest.current.threadAtBlock.get(index) ?? null;
			};
			const onMouseOver = (event: MouseEvent) => {
				const nodeId = nodeIdAt(event.target);
				setHovered(nodeId ? { nodeId, from: "block" } : null);
			};
			// Pointer events, like the cards' and counts': a mouse event from the
			// document arrives after the pointer events of what it moved onto.
			const onMouseLeave = () => setHovered(null);
			dom.addEventListener("keydown", onKeyDown);
			dom.addEventListener("click", onClick);
			dom.addEventListener("pointerover", onMouseOver);
			dom.addEventListener("pointerleave", onMouseLeave);
			return () => {
				dom.removeEventListener("keydown", onKeyDown);
				dom.removeEventListener("click", onClick);
				dom.removeEventListener("pointerover", onMouseOver);
				dom.removeEventListener("pointerleave", onMouseLeave);
			};
		}, [activate, editor, setHovered, startComment, viewReady]);

		// Esc closes the open conversation wherever the focus is in this
		// document: the editor, the card or popover, the page (a click on a
		// card leaves it there), or a reply field that has let go of its text
		// (the composer takes the first Esc). Esc another handler took, or
		// pressed elsewhere in the workspace, is not ours. (ProseMirror
		// prevents every Esc in the editor, so there that says nothing.)
		const isOpen = active !== null;
		useEffect(() => {
			if (!isOpen || !viewReady) return;
			const onKeyDown = (event: KeyboardEvent) => {
				if (event.key !== "Escape" || event.isComposing) return;
				const target = event.target;
				const root = editor.view.dom;
				const inEditor = target instanceof Node && root.contains(target);
				if (event.defaultPrevented && !inEditor) return;
				const surface = root.closest(".tiptap-container") ?? root;
				const ours =
					inEditor ||
					target === document.body ||
					target === document.documentElement ||
					(target instanceof Node && surface.contains(target));
				if (!ours) return;
				event.preventDefault();
				returnToEditor();
			};
			document.addEventListener("keydown", onKeyDown);
			return () => document.removeEventListener("keydown", onKeyDown);
		}, [editor, isOpen, returnToEditor, viewReady]);

		const api = useMemo<BlockCommentsApi>(
			() => ({ startComment }),
			[startComment],
		);
		const name = accountResult.rows[0]?.name?.trim() || "You";
		const state = useMemo<BlockConversationsState>(
			() => ({
				editor,
				layout,
				setLayout,
				placed,
				pending,
				pendingIndex,
				pendingDraft,
				setPendingDraft,
				submitPending,
				cancelPending,
				active,
				activate,
				returnToEditor,
				hovered,
				setHovered,
				replyDraft,
				setReplyDraft,
				submitReply,
				authorName: name,
				notice,
				removed,
				dismissRemoved,
			}),
			[
				active,
				activate,
				cancelPending,
				editor,
				hovered,
				layout,
				name,
				notice,
				pending,
				removed,
				dismissRemoved,
				pendingDraft,
				pendingIndex,
				placed,
				replyDraft,
				returnToEditor,
				setHovered,
				setPendingDraft,
				setReplyDraft,
				submitPending,
				submitReply,
			],
		);

		// Without the Markdown plugin's rows (a host that has not installed it)
		// there is no block to attach a conversation to: no Comment row, no marks.
		useLayoutEffect(() => {
			onPublish(available && viewReady ? { api, state } : null);
		}, [api, available, onPublish, state, viewReady]);
		useLayoutEffect(() => () => onPublish(null), [onPublish]);
		return null;
	},
);

const EMPTY_DRAFT = emptyCommentDocument();

/** A block's box in the scrolling surface's coordinates. */
type BlockBox = {
	readonly top: number;
	readonly bottom: number;
	readonly left: number;
	readonly right: number;
	/** The block's first line, to level a count with it. */
	readonly lineHeight: number;
};

type Geometry = {
	readonly width: number;
	/** The document column's right edge (its text, not its gutter). */
	readonly columnRight: number;
	readonly boxes: ReadonlyMap<number, BlockBox>;
};

function sameGeometry(a: Geometry | null, b: Geometry): boolean {
	if (!a || a.width !== b.width || a.columnRight !== b.columnRight)
		return false;
	if (a.boxes.size !== b.boxes.size) return false;
	for (const [index, box] of b.boxes) {
		const other = a.boxes.get(index);
		if (
			!other ||
			other.top !== box.top ||
			other.bottom !== box.bottom ||
			other.left !== box.left ||
			other.right !== box.right
		)
			return false;
	}
	return true;
}

/**
 * The margin, the counts and the popovers, laid out inside the editor's
 * scrolling surface so they scroll with the document. Rendered through
 * `TipTapEditor`'s `surfaceOverlay`.
 */
export function BlockConversationsLayer() {
	const state = useContext(BlockConversationsStateContext);
	if (!state) return null;
	return <BlockConversationsSurface state={state} />;
}

function BlockConversationsSurface({
	state,
}: {
	readonly state: BlockConversationsState;
}) {
	const { editor, layout, setLayout, placed, pendingIndex, active } = state;
	// A branch switch unmounts the view under a surface that is still up.
	const viewReady = useEditorViewReady(editor);
	const layerRef = useRef<HTMLDivElement>(null);
	const [geometry, setGeometry] = useState<Geometry | null>(null);
	const [tick, setTick] = useState(0);
	const hasThreads = placed.length > 0;

	const indexes = useMemo(() => {
		const list = placed.map((entry) => entry.index);
		if (pendingIndex >= 0) list.push(pendingIndex);
		return list;
	}, [pendingIndex, placed]);

	// Re-measure whenever the surface or the document changes size; an edit
	// moves nothing to measure while no block is commented.
	const measuring = useRef(false);
	measuring.current = indexes.length > 0;
	useLayoutEffect(() => {
		const surface = layerRef.current?.parentElement;
		if (!surface || !viewReady || !hasView(editor)) return;
		const bump = () => setTick((value) => value + 1);
		const bumpOnEdit = () => {
			if (measuring.current) bump();
		};
		const observer = new ResizeObserver(bump);
		observer.observe(surface);
		observer.observe(editor.view.dom);
		editor.on("update", bumpOnEdit);
		return () => {
			observer.disconnect();
			editor.off("update", bumpOnEdit);
		};
	}, [editor, viewReady]);

	useLayoutEffect(() => {
		const surface = layerRef.current?.parentElement;
		if (!surface || !viewReady || !hasView(editor)) return;
		const width = surface.clientWidth;
		setLayout(blockCommentLayout(width));
		const surfaceRect = surface.getBoundingClientRect();
		const toSurface = (rect: DOMRect) => ({
			top: rect.top - surfaceRect.top + surface.scrollTop,
			bottom: rect.bottom - surfaceRect.top + surface.scrollTop,
			left: rect.left - surfaceRect.left + surface.scrollLeft,
			right: rect.right - surfaceRect.left + surface.scrollLeft,
		});
		const root = editor.view.dom;
		const rootStyle = getComputedStyle(root);
		const rootBox = toSurface(root.getBoundingClientRect());
		const columnRight =
			rootBox.right -
			(Number.parseFloat(rootStyle.paddingRight) || 0) -
			(Number.parseFloat(rootStyle.borderRightWidth) || 0);
		const boxes = new Map<number, BlockBox>();
		for (const index of indexes) {
			const element = blockElement(editor, index);
			if (!element) continue;
			const box = toSurface(element.getBoundingClientRect());
			const lineHeight =
				Number.parseFloat(getComputedStyle(element).lineHeight) || 24;
			boxes.set(index, { ...box, lineHeight });
		}
		const next: Geometry = { width, columnRight, boxes };
		setGeometry((current) => (sameGeometry(current, next) ? current : next));
	}, [editor, indexes, layout, setLayout, tick, viewReady]);

	return (
		<div
			ref={layerRef}
			className="markdown-block-comments"
			data-layout={layout}
			data-has-threads={hasThreads ? "" : undefined}
		>
			{state.notice ? (
				<p className="markdown-comment-notice" role="status">
					{state.notice}
				</p>
			) : state.removed.length > 0 ? (
				<RemovedNotice state={state} />
			) : null}
			{geometry && layout === "margin" && hasThreads ? (
				<MarginCards state={state} geometry={geometry} />
			) : null}
			{geometry && layout === "narrow"
				? placed.map((entry) => {
						const box = geometry.boxes.get(entry.index);
						if (!box) return null;
						return (
							<CountBadge
								key={entry.key}
								state={state}
								entry={entry}
								box={box}
								columnRight={geometry.columnRight}
							/>
						);
					})
				: null}
			{geometry && layout === "narrow" && active
				? (() => {
						const entry = placed.find(
							(candidate) => candidate.key === active.nodeId,
						);
						const box = entry && geometry.boxes.get(entry.index);
						if (!entry || !box) return null;
						return (
							<ConversationPopover
								key={entry.key}
								state={state}
								entry={entry}
								box={box}
								surfaceWidth={geometry.width}
							/>
						);
					})()
				: null}
			{geometry && pendingIndex >= 0 && geometry.boxes.get(pendingIndex) ? (
				<PendingComposer
					state={state}
					box={geometry.boxes.get(pendingIndex)!}
					surfaceWidth={geometry.width}
				/>
			) : null}
		</div>
	);
}

/** Threads deleted with their block by someone else's write. */
function RemovedNotice({ state }: { readonly state: BlockConversationsState }) {
	const views = useConversationViews();
	const count = state.removed.length;
	const last = state.removed.at(-1)!;
	return (
		<p className="markdown-comment-notice" role="status">
			{count === 1
				? "A comment thread was removed with its block."
				: `${count} comment threads were removed with their blocks.`}{" "}
			{views ? (
				<button
					type="button"
					className="markdown-comment-notice-action"
					onClick={() => void openConversation({ views }, last)}
				>
					View
				</button>
			) : null}
			<button
				type="button"
				className="markdown-comment-notice-action"
				aria-label="Dismiss"
				onClick={state.dismissRemoved}
			>
				Dismiss
			</button>
		</p>
	);
}

const POPOVER_WIDTH = 360;
/**
 * How far under its block's last line each popover opens, as the design
 * draws them: the composer (N2) clears the block by more than the
 * conversation opened from a count (N5).
 */
const COMPOSER_DROP = 29.75;
const CONVERSATION_DROP = 19;

function popoverLeft(box: BlockBox, surfaceWidth: number): number {
	return Math.max(0, Math.min(box.left, surfaceWidth - POPOVER_WIDTH - 8));
}

/**
 * Pointing at a card or a count tints its block. Native listeners: React's
 * synthesized mouseenter does not reach elements laid over the editor
 * surface from real pointer moves.
 */
function usePointerHover(
	element: HTMLElement | null,
	nodeId: string,
	setHovered: (hover: Hover | null) => void,
) {
	useEffect(() => {
		if (!element) return;
		const enter = () => setHovered({ nodeId, from: "margin" });
		const leave = () => setHovered(null);
		element.addEventListener("pointerenter", enter);
		element.addEventListener("pointerleave", leave);
		return () => {
			element.removeEventListener("pointerenter", enter);
			element.removeEventListener("pointerleave", leave);
		};
	}, [element, nodeId, setHovered]);
}

/** Closes something when a press lands outside it. */
function useOutsidePress(
	ref: React.RefObject<HTMLElement | null>,
	onOutside: (target: Node) => void,
) {
	const handler = useRef(onOutside);
	handler.current = onOutside;
	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (ref.current?.contains(target)) return;
			handler.current(target);
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () =>
			document.removeEventListener("pointerdown", onPointerDown, true);
	}, [ref]);
}

/** N2: a new comment, under the block it is on. */
function PendingComposer({
	state,
	box,
	surfaceWidth,
}: {
	readonly state: BlockConversationsState;
	readonly box: BlockBox;
	readonly surfaceWidth: number;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const { pending, pendingDraft, cancelPending } = state;
	useOutsidePress(ref, () => {
		// Clicking away keeps what was written; an empty box goes.
		if (!hasCommentText(pendingDraft)) cancelPending(false);
	});
	return (
		<div
			ref={ref}
			className="markdown-comment-popover"
			data-attr="markdown-comment-composer"
			style={{
				top: box.bottom + COMPOSER_DROP,
				left: popoverLeft(box, surfaceWidth),
			}}
		>
			<div className="flex items-start gap-2">
				<CommentAvatar name={state.authorName} size="xl" />
				<Composer
					label="Comment on this block"
					placeholder="Comment"
					value={pendingDraft}
					onChange={state.setPendingDraft}
					onSubmit={state.submitPending}
					onCancel={() => cancelPending(true)}
					submitHint="comment"
					focusRequest={pending?.focus ?? 0}
					tone="neutral"
					size="document"
					className="min-w-0 flex-1"
				/>
			</div>
		</div>
	);
}

/** N5: the conversation under its block, opened from the count. */
function ConversationPopover({
	state,
	entry,
	box,
	surfaceWidth,
}: {
	readonly state: BlockConversationsState;
	readonly entry: PlacedThread;
	readonly box: BlockBox;
	readonly surfaceWidth: number;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useOutsidePress(ref, (target) => {
		if (
			target instanceof Element &&
			target.closest(`[data-comment-badge="${entry.key}"]`)
		)
			return;
		state.activate(null);
	});
	return (
		<div
			ref={ref}
			className="markdown-comment-popover"
			data-attr="markdown-comment-popover"
			style={{
				top: box.bottom + CONVERSATION_DROP,
				left: popoverLeft(box, surfaceWidth),
			}}
		>
			<ConversationBody state={state} entry={entry} />
		</div>
	);
}

function ConversationBody({
	state,
	entry,
}: {
	readonly state: BlockConversationsState;
	readonly entry: PlacedThread;
}) {
	const nodeId = entry.key;
	const views = useConversationViews();
	// The reply field sits under the last thread, so a reply goes to it.
	const replyTo = entry.conversations.at(-1)!.conversationId;
	return (
		<>
			{views ? (
				<OpenConversationButton
					atelier={{ views }}
					conversationId={replyTo}
					className="markdown-comment-open"
				/>
			) : null}
			{entry.conversations.map((conversation, index) => (
				<CommentThread
					key={conversation.conversationId}
					comments={conversation.comments}
					label={
						entry.conversations.length > 1
							? `Comments on this block, thread ${index + 1}`
							: "Comments on this block"
					}
					tone="neutral"
					size="document"
					className={index > 0 ? "markdown-comment-thread-next" : ""}
				/>
			))}
			<Composer
				label="Reply"
				placeholder="Reply"
				value={state.replyDraft(nodeId)}
				onChange={(draft) => state.setReplyDraft(nodeId, draft)}
				onSubmit={(body) => state.submitReply(nodeId, replyTo, body)}
				// Esc with a reply written lets go of the field and keeps the
				// draft; the next Esc (or the first, on an empty field) closes.
				onCancel={(draft) => {
					if (!hasCommentText(draft)) state.returnToEditor();
				}}
				submitHint="reply"
				sendLabel="Send reply"
				focusRequest={state.active?.nodeId === nodeId ? state.active.focus : 0}
				tone="neutral"
				size="document"
			/>
		</>
	);
}

/** N5: the count just outside a commented block's right edge. */
function CountBadge({
	state,
	entry,
	box,
	columnRight,
}: {
	readonly state: BlockConversationsState;
	readonly entry: PlacedThread;
	readonly box: BlockBox;
	readonly columnRight: number;
}) {
	const nodeId = entry.key;
	const open = state.active?.nodeId === nodeId;
	const hovered =
		state.hovered?.from === "block" && state.hovered.nodeId === nodeId;
	const count = commentCount(entry);
	const [element, setElement] = useState<HTMLButtonElement | null>(null);
	usePointerHover(element, nodeId, state.setHovered);
	return (
		<button
			ref={setElement}
			type="button"
			className="markdown-comment-badge"
			data-comment-badge={nodeId}
			data-state={open ? "open" : hovered ? "hover" : undefined}
			aria-expanded={open}
			aria-label={`${count} ${count === 1 ? "comment" : "comments"}`}
			style={{
				top: box.top + Math.max(0, (box.lineHeight - 22) / 2),
				left: Math.max(box.right, columnRight) + 16,
			}}
			// A caret in the document keeps its focus; from anywhere else the
			// count takes it, so Esc in the conversation is the document's.
			onMouseDown={(event) => {
				if (hasView(state.editor) && state.editor.view.hasFocus())
					event.preventDefault();
			}}
			// From the keyboard (no pointer, `detail` 0) the caret goes on into
			// the reply field.
			onClick={(event) =>
				state.activate(open ? null : nodeId, !open && event.detail === 0)
			}
		>
			<CommentBubble aria-hidden />
			{count}
		</button>
	);
}

function previewText(body: unknown): string {
	try {
		return toPlainText(parseCommentBody(body)).trim();
	} catch {
		return "";
	}
}

/**
 * A card's top edge sits this far below the top of its block's first line,
 * which puts the author's name 18.5px below it (design N3, N4).
 */
const CARD_DROP = 8.5;

/** N3/N4: one card per commented block, level with its block. */
function MarginCards({
	state,
	geometry,
}: {
	readonly state: BlockConversationsState;
	readonly geometry: Geometry;
}) {
	const { placed, active, hovered } = state;
	const cardRefs = useRef(new Map<string, HTMLDivElement>());
	const left = geometry.columnRight + MARGIN_GAP;
	const entries = placed.filter((entry) => geometry.boxes.has(entry.index));
	const activeIndex = entries.findIndex(
		(entry) => entry.key === active?.nodeId,
	);

	const stack = useCallback(() => {
		const cards = entries.map((entry) => ({
			top: geometry.boxes.get(entry.index)!.top + CARD_DROP,
			height: cardRefs.current.get(entry.key)?.offsetHeight ?? 0,
		}));
		const tops = stackMarginCards(cards, activeIndex);
		entries.forEach((entry, index) => {
			const card = cardRefs.current.get(entry.key);
			if (card) card.style.top = `${tops[index]}px`;
		});
	}, [activeIndex, entries, geometry]);

	useLayoutEffect(stack);
	useLayoutEffect(() => {
		const observer = new ResizeObserver(() => stack());
		for (const card of cardRefs.current.values()) observer.observe(card);
		return () => observer.disconnect();
	}, [stack]);

	// Pointing at a card tints its block.
	const setHovered = state.setHovered;
	useEffect(() => {
		const cleanups: (() => void)[] = [];
		for (const [nodeId, card] of cardRefs.current) {
			const enter = () => setHovered({ nodeId, from: "margin" });
			const leave = () => setHovered(null);
			card.addEventListener("pointerenter", enter);
			card.addEventListener("pointerleave", leave);
			cleanups.push(() => {
				card.removeEventListener("pointerenter", enter);
				card.removeEventListener("pointerleave", leave);
			});
		}
		return () => {
			for (const cleanup of cleanups) cleanup();
		};
	});

	const activeRef = useRef<HTMLDivElement | null>(null);
	activeRef.current = (active && cardRefs.current.get(active.nodeId)) ?? null;
	useOutsidePress(activeRef, (target) => {
		// Clicks in the document decide for themselves (a click into another
		// commented block opens that one).
		if (hasView(state.editor) && state.editor.view.dom.contains(target)) return;
		if (target instanceof Element && target.closest(".markdown-comment-card"))
			return;
		if (active) state.activate(null);
	});

	return (
		<>
			{entries.map((entry) => {
				const nodeId = entry.key;
				const { comments } = entry.thread;
				const isActive = active?.nodeId === nodeId;
				const first = comments[0]!;
				const replies = comments.length - 1;
				const otherThreads = entry.conversations.length - 1;
				const shared = {
					ref: (element: HTMLDivElement | null) => {
						if (element) cardRefs.current.set(nodeId, element);
						else cardRefs.current.delete(nodeId);
					},
					className: "markdown-comment-card",
					"data-attr": "markdown-comment-card",
					// Pointing at the block tints its card; pointing at the card
					// tints the block, not the card.
					"data-state": isActive
						? "active"
						: hovered?.from === "block" && hovered.nodeId === nodeId
							? "hover"
							: "rest",
					style: {
						left,
						width: MARGIN_CARD_WIDTH,
						top: geometry.boxes.get(entry.index)!.top + CARD_DROP,
					},
				};
				if (isActive) {
					return (
						<div
							key={nodeId}
							{...shared}
							role="group"
							aria-label="Conversation on this block"
						>
							<ConversationBody state={state} entry={entry} />
						</div>
					);
				}
				// At rest the card is the way into its conversation.
				return (
					<div
						key={nodeId}
						{...shared}
						role="button"
						tabIndex={0}
						aria-label={`Show ${commentCount(entry)} ${
							commentCount(entry) === 1 ? "comment" : "comments"
						}`}
						// The label names the action; the preview stays readable.
						aria-describedby={`markdown-comment-preview-${nodeId}`}
						onMouseDown={() => state.activate(nodeId)}
						onKeyDown={(event) => {
							if (event.key !== "Enter" && event.key !== " ") return;
							event.preventDefault();
							state.activate(nodeId, true);
						}}
					>
						<div className="flex gap-2">
							<CommentAvatar name={authorName(first)} size="lg" />
							<div className="min-w-0 flex-1">
								<div className="flex items-baseline gap-1.5 leading-[18px]">
									<span className="truncate text-[12.5px] font-semibold text-fg">
										{authorName(first)}
									</span>
									{first.lixcol_created_at ? (
										<time
											dateTime={first.lixcol_created_at}
											className="shrink-0 text-[11.5px] text-history-secondary"
										>
											{formatCommentTime(first.lixcol_created_at)}
										</time>
									) : null}
								</div>
								<p
									id={`markdown-comment-preview-${nodeId}`}
									className="markdown-comment-card-preview"
								>
									{previewText(first.body)}
								</p>
							</div>
						</div>
						{replies > 0 || otherThreads > 0 ? (
							<div className="pl-7 text-[12px] leading-[normal] font-semibold text-history-secondary">
								{[
									replies > 0
										? `${replies} ${replies === 1 ? "reply" : "replies"}`
										: null,
									otherThreads > 0
										? `${otherThreads} more ${otherThreads === 1 ? "thread" : "threads"}`
										: null,
								]
									.filter(Boolean)
									.join(" · ")}
							</div>
						) : null}
					</div>
				);
			})}
		</>
	);
}
