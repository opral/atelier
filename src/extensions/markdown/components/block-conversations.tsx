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
	useConversationViews,
} from "../../conversation/open-conversation";
import type { Editor } from "@tiptap/core";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { MessageSquare } from "lucide-react";
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
import type { SqlParam } from "@lix-js/sdk";
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
	groupBlockThreads,
	replyToBlockConversation,
	selectBlockComments,
	selectCommentAuthors,
	selectMarkdownBlocks,
	stackMarginCards,
	withAuthors,
	type BlockAlignment,
	type BlockCommentLayout,
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
	readonly thread: BlockThread;
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
	readonly hovered: string | null;
	readonly setHovered: (nodeId: string | null) => void;
	readonly replyDraft: (nodeId: string) => Document;
	readonly setReplyDraft: (nodeId: string, draft: Document) => void;
	readonly submitReply: (nodeId: string, body: Document) => Promise<void>;
	readonly authorName: string;
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
 * that block is gone, the block standing in for it.
 */
type Carrier = {
	readonly blockId: string;
	readonly standIn: string | null;
	readonly standInIndex: number;
	/** What the gone block held, to know it again when it is pasted back. */
	readonly lost?: string;
};

/** A block's kind and text, the only way to know a pasted block again. */
function blockSignature(node: ProseMirrorNode): string | null {
	const text = node.textContent.trim();
	return text ? `${node.type.name}:${text}` : null;
}

function indexOfBlock(doc: ProseMirrorNode, blockId: string): number {
	let found = -1;
	doc.forEach((node, _offset, index) => {
		if (found < 0 && blockNodeId(node) === blockId) found = index;
	});
	return found;
}

function carrierIndex(doc: ProseMirrorNode, carrier: Carrier): number {
	const own = indexOfBlock(doc, carrier.blockId);
	if (own >= 0) return own;
	const standIn = carrier.standIn ? indexOfBlock(doc, carrier.standIn) : -1;
	if (standIn >= 0) return standIn;
	return Math.min(carrier.standInIndex, doc.childCount - 1);
}

function conversationIdsOf(thread: BlockThread): string[] {
	return [
		...new Set(thread.comments.map((comment) => comment.conversation_id)),
	];
}

function mergeThreads(first: BlockThread, second: BlockThread): BlockThread {
	const comments = [...first.comments, ...second.comments].sort(
		(a, b) =>
			(a.lixcol_created_at ?? "").localeCompare(b.lixcol_created_at ?? "") ||
			a.id.localeCompare(b.id),
	);
	return { ...first, comments };
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
		const threads = useMemo(() => groupBlockThreads(comments), [comments]);

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
		const [carrierVersion, setCarrierVersion] = useState(0);
		const commentsLoaded = commentsResult.status === "success";
		const placed = useMemo<PlacedThread[]>(() => {
			const { doc } = editor.state;
			const live = new Set<string>();
			for (const thread of threads.values()) {
				for (const conversationId of conversationIdsOf(thread)) {
					live.add(conversationId);
					if (carriers.current.has(conversationId)) continue;
					// A conversation first seen: its row tells which block it is on.
					const index = alignment.blockOfRow.get(thread.nodeId);
					const blockId =
						index !== undefined && index < doc.childCount
							? blockNodeId(doc.child(index))
							: null;
					if (blockId)
						carriers.current.set(conversationId, {
							blockId,
							standIn: null,
							standInIndex: index!,
						});
				}
			}
			if (commentsLoaded)
				for (const conversationId of carriers.current.keys())
					if (!live.has(conversationId))
						carriers.current.delete(conversationId);
			// Two threads whose blocks became one (a merge) read as one thread.
			const byIndex = new Map<number, BlockThread>();
			for (const thread of threads.values()) {
				const carrier = carriers.current.get(thread.conversationId);
				const index = carrier
					? carrierIndex(doc, carrier)
					: alignment.blockOfRow.get(thread.nodeId);
				if (index === undefined || index < 0) continue;
				const other = byIndex.get(index);
				byIndex.set(index, other ? mergeThreads(other, thread) : thread);
			}
			return [...byIndex]
				.map(([index, thread]) => ({ thread, index }))
				.sort((a, b) => a.index - b.index);
			// `structure` and `carrierVersion` stand for the document's blocks
			// and where the conversations are among them.
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [alignment, threads, structure, carrierVersion, commentsLoaded]);

		const [layout, setLayout] = useState<BlockCommentLayout>("narrow");
		const [pending, setPending] = useState<PendingComment | null>(null);
		// Drafts are kept per block, like History's per checkpoint: Esc or
		// commenting on another block puts a draft away, it does not drop it.
		const [pendingDrafts, setPendingDrafts] = useState<
			ReadonlyMap<string, Document>
		>(() => new Map());
		const [active, setActive] = useState<ActiveConversation | null>(null);
		const [hovered, setHovered] = useState<string | null>(null);
		const [replyDrafts, setReplyDrafts] = useState<
			ReadonlyMap<string, Document>
		>(() => new Map());

		// A conversation whose block went away closes with it.
		useEffect(() => {
			if (
				active &&
				!placed.some((entry) => entry.thread.nodeId === active.nodeId)
			)
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
			() => new Map(placed.map((entry) => [entry.index, entry.thread.nodeId])),
			[placed],
		);
		const latest = useRef({ threads, layout, available, threadAtBlock });
		latest.current = { threads, layout, available, threadAtBlock };

		const activate = useCallback((nodeId: string | null, focus = false) => {
			setActive((current) => {
				if (nodeId === null) return null;
				const focusCount = (current?.focus ?? 0) + (focus ? 1 : 0);
				return { nodeId, focus: focusCount };
			});
			if (nodeId !== null) setPending(null);
		}, []);

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
						standIn: null,
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
			async (nodeId: string, body: Document) => {
				const thread = latest.current.threads.get(nodeId);
				if (!thread) throw new Error("This conversation no longer exists.");
				await replyToBlockConversation(lix, thread.conversationId, body);
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
			for (const { thread, index } of placed) {
				if (index >= doc.childCount) continue;
				const id = blockNodeId(doc.child(index));
				if (!id) continue;
				marks.set(
					id,
					active?.nodeId === thread.nodeId
						? "active"
						: hovered === thread.nodeId
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
		const lastSavedStructure = useRef(structureOf(editor));
		useEffect(() => {
			const onTransaction = ({ transaction }: { transaction: Transaction }) => {
				if (!transaction.docChanged) return;
				const after = editor.state.doc;
				// A document loaded from the file (an external write) has new
				// block ids; its conversations are found again from the rows.
				if (transaction.getMeta("preventUpdate")) {
					carriers.current.clear();
					lastSavedStructure.current = structureOf(editor);
					setCarrierVersion((version) => version + 1);
					return;
				}
				const present = new Map<string, number>();
				after.forEach((node, _offset, index) => {
					const id = blockNodeId(node);
					if (id) present.set(id, index);
				});
				const offsets = new Map<string, number>();
				const signatures = new Map<string, string | null>();
				transaction.before.forEach((node, offset) => {
					const id = blockNodeId(node);
					if (!id) return;
					offsets.set(id, offset);
					signatures.set(id, blockSignature(node));
				});
				// Blocks this edit brought in (a paste), by what they hold.
				const arrived = new Map<string, string>();
				after.forEach((node) => {
					const id = blockNodeId(node);
					const signature = blockSignature(node);
					if (id && signature && !offsets.has(id) && !arrived.has(signature))
						arrived.set(signature, id);
				});
				let changed = false;
				for (const [conversationId, carrier] of carriers.current) {
					if (present.has(carrier.blockId)) {
						// Its own block is back (undo, a paste of the cut block).
						if (carrier.standIn !== null) {
							carriers.current.set(conversationId, {
								...carrier,
								standIn: null,
							});
							changed = true;
						}
						continue;
					}
					// The block pasted back after a cut: the conversation goes with it.
					const pasted = carrier.lost ? arrived.get(carrier.lost) : undefined;
					if (pasted) {
						carriers.current.set(conversationId, {
							blockId: pasted,
							standIn: null,
							standInIndex: present.get(pasted) ?? 0,
						});
						changed = true;
						continue;
					}
					if (carrier.standIn !== null && present.has(carrier.standIn))
						continue;
					const offset =
						offsets.get(carrier.standIn ?? carrier.blockId) ??
						offsets.get(carrier.blockId);
					if (offset === undefined) continue;
					// Where the block's first character went: into the block before
					// it on a merge, onto the block after it when it was deleted.
					const mapped = transaction.mapping.map(offset + 1, -1);
					const at = after.resolve(Math.min(mapped, after.content.size));
					const index = Math.min(at.index(0), after.childCount - 1);
					const standIn = index >= 0 ? blockNodeId(after.child(index)) : null;
					carriers.current.set(conversationId, {
						...carrier,
						standIn,
						standInIndex: Math.max(0, index),
						lost: carrier.lost ?? signatures.get(carrier.blockId) ?? undefined,
					});
					changed = true;
				}
				if (changed) setCarrierVersion((version) => version + 1);
			};
			editor.on("transaction", onTransaction);
			const leave = joinMarkdownEditorSaves(editor, {
				prepare: (doc) => {
					const conversationIds = [...carriers.current.keys()];
					if (conversationIds.length === 0) return null;
					const savedStructure = structureOfDoc(doc);
					// Typing inside blocks keeps every row.
					if (savedStructure === lastSavedStructure.current) return null;
					const targets = conversationIds.map(
						(id) => [id, carrierIndex(doc, carriers.current.get(id)!)] as const,
					);
					return {
						before: async (transaction) => {
							await transaction.execute(
								`UPDATE lix_conversation SET target = NULL WHERE lixcol_global = false AND id IN (${conversationIds
									.map((_, index) => `$${index + 1}`)
									.join(", ")})`,
								conversationIds,
							);
						},
						after: async (transaction) => {
							const query = selectMarkdownBlocks(lix, fileId).compile();
							const saved = await transaction.execute(
								query.sql,
								query.parameters as SqlParam[],
							);
							const { rowOfBlock } = blockAlignment(
								doc,
								saved.rows as unknown as MarkdownBlockRow[],
							);
							for (const [conversationId, index] of targets) {
								const nodeId = nearestRow(rowOfBlock, index);
								if (!nodeId) continue;
								await transaction.execute(
									"UPDATE lix_conversation SET target = lix_row_ref('markdown_node', $2, $3) WHERE id = $1",
									[conversationId, fileId, nodeId],
								);
							}
							lastSavedStructure.current = savedStructure;
						},
					};
				},
			});
			return () => {
				editor.off("transaction", onTransaction);
				leave();
			};
		}, [editor, fileId, lix]);

		// ⌘⌥M, Esc, and clicking into a commented block.
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
					return;
				}
				if (event.key === "Escape") setActive(null);
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
				setHovered((current) => (current === nodeId ? current : nodeId));
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
		}, [activate, editor, startComment, viewReady]);

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
				hovered,
				setHovered,
				replyDraft,
				setReplyDraft,
				submitReply,
				authorName: name,
			}),
			[
				active,
				activate,
				cancelPending,
				editor,
				hovered,
				layout,
				name,
				pending,
				pendingDraft,
				pendingIndex,
				placed,
				replyDraft,
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
			{geometry && layout === "margin" && hasThreads ? (
				<MarginCards state={state} geometry={geometry} />
			) : null}
			{geometry && layout === "narrow"
				? placed.map((entry) => {
						const box = geometry.boxes.get(entry.index);
						if (!box) return null;
						return (
							<CountBadge
								key={entry.thread.nodeId}
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
							(candidate) => candidate.thread.nodeId === active.nodeId,
						);
						const box = entry && geometry.boxes.get(entry.index);
						if (!entry || !box) return null;
						return (
							<ConversationPopover
								key={entry.thread.nodeId}
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

const POPOVER_WIDTH = 360;
const POPOVER_OFFSET = 8;

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
	setHovered: (nodeId: string | null) => void,
) {
	useEffect(() => {
		if (!element) return;
		const enter = () => setHovered(nodeId);
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
				top: box.bottom + POPOVER_OFFSET,
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
			target.closest(`[data-comment-badge="${entry.thread.nodeId}"]`)
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
				top: box.bottom + POPOVER_OFFSET,
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
	const { nodeId, conversationId } = entry.thread;
	const views = useConversationViews();
	return (
		<>
			{views ? (
				<OpenConversationButton
					atelier={{ views }}
					conversationId={conversationId}
					className="markdown-comment-open"
				/>
			) : null}
			<CommentThread
				comments={entry.thread.comments}
				label="Comments on this block"
				tone="neutral"
				size="document"
			/>
			<Composer
				label="Reply"
				placeholder="Reply"
				value={state.replyDraft(nodeId)}
				onChange={(draft) => state.setReplyDraft(nodeId, draft)}
				onSubmit={(body) => state.submitReply(nodeId, body)}
				onCancel={() => {
					state.activate(null);
					if (!state.editor.isDestroyed)
						state.editor.chain().focus(null, { scrollIntoView: false }).run();
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
	const { nodeId, comments } = entry.thread;
	const open = state.active?.nodeId === nodeId;
	const count = comments.length;
	const [element, setElement] = useState<HTMLButtonElement | null>(null);
	usePointerHover(element, nodeId, state.setHovered);
	return (
		<button
			ref={setElement}
			type="button"
			className="markdown-comment-badge"
			data-comment-badge={nodeId}
			data-state={open ? "open" : undefined}
			aria-expanded={open}
			aria-label={`${count} ${count === 1 ? "comment" : "comments"}`}
			style={{
				top: box.top + Math.max(0, (box.lineHeight - 22) / 2),
				left: Math.max(box.right, columnRight) + 16,
			}}
			onMouseDown={(event) => event.preventDefault()}
			// From the keyboard (no pointer, `detail` 0) the caret goes on into
			// the reply field.
			onClick={(event) =>
				state.activate(open ? null : nodeId, !open && event.detail === 0)
			}
			onKeyDown={(event) => {
				if (event.key === "Escape" && open) {
					event.preventDefault();
					state.activate(null);
				}
			}}
		>
			<MessageSquare aria-hidden />
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
 * A card is level with its block's box, which reaches 4px above the text
 * (design: the block wrapper's padding), not with the first line.
 */
const CARD_RISE = 4;

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
		(entry) => entry.thread.nodeId === active?.nodeId,
	);

	const stack = useCallback(() => {
		const cards = entries.map((entry) => ({
			top: geometry.boxes.get(entry.index)!.top - CARD_RISE,
			height: cardRefs.current.get(entry.thread.nodeId)?.offsetHeight ?? 0,
		}));
		const tops = stackMarginCards(cards, activeIndex);
		entries.forEach((entry, index) => {
			const card = cardRefs.current.get(entry.thread.nodeId);
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
			const enter = () => setHovered(nodeId);
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
				const { nodeId, comments } = entry.thread;
				const isActive = active?.nodeId === nodeId;
				const first = comments[0]!;
				const replies = comments.length - 1;
				const shared = {
					ref: (element: HTMLDivElement | null) => {
						if (element) cardRefs.current.set(nodeId, element);
						else cardRefs.current.delete(nodeId);
					},
					className: "markdown-comment-card",
					"data-attr": "markdown-comment-card",
					"data-state": isActive
						? "active"
						: hovered === nodeId
							? "hover"
							: "rest",
					style: {
						left,
						width: MARGIN_CARD_WIDTH,
						top: geometry.boxes.get(entry.index)!.top - CARD_RISE,
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
						aria-label={`Show ${comments.length} ${
							comments.length === 1 ? "comment" : "comments"
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
						{replies > 0 ? (
							<div className="pl-7 text-[12px] font-semibold text-history-secondary">
								{replies} {replies === 1 ? "reply" : "replies"}
							</div>
						) : null}
					</div>
				);
			})}
		</>
	);
}
