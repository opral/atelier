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

/** The top-level kinds of a document, to know when blocks moved. */
function structureOf(editor: Editor): string {
	const kinds: string[] = [];
	editor.state.doc.forEach((node) => kinds.push(node.type.name));
	return kinds.join(",");
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
			const onUpdate = () => setStructure(structureOf(editor));
			editor.on("update", onUpdate);
			return () => {
				editor.off("update", onUpdate);
			};
		}, [editor]);
		const alignment = useMemo<BlockAlignment>(
			() => blockAlignment(editor.state.doc, rows),
			// `structure` stands for the document's block order.
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[editor, rows, structure],
		);
		const placed = useMemo<PlacedThread[]>(() => {
			const list: PlacedThread[] = [];
			for (const thread of threads.values()) {
				const index = alignment.blockOfRow.get(thread.nodeId);
				if (index !== undefined) list.push({ thread, index });
			}
			return list.sort((a, b) => a.index - b.index);
		}, [alignment, threads]);

		const [layout, setLayout] = useState<BlockCommentLayout>("narrow");
		const [pending, setPending] = useState<PendingComment | null>(null);
		const [pendingDraft, setPendingDraft] =
			useState<Document>(emptyCommentDocument);
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

		const available = blocksResult.status === "success";
		const latest = useRef({ alignment, threads, placed, layout, available });
		latest.current = { alignment, threads, placed, layout, available };

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
			const { alignment: currentAlignment, threads: currentThreads } =
				latest.current;
			const nodeId = currentAlignment.rowOfBlock[index];
			// A block has one conversation: commenting again opens it.
			if (nodeId && currentThreads.has(nodeId)) {
				activate(nodeId, true);
				return;
			}
			const node = editor.state.doc.child(index);
			// The comment is on the block: the selected characters are dropped.
			editor.commands.setTextSelection(editor.state.selection.to);
			setActive(null);
			setPendingDraft(emptyCommentDocument());
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
				// The block's row: the editor saves within a moment of an edit, and
				// a block typed just now has no row until then.
				let nodeId: string | null = null;
				for (let attempt = 0; attempt < 12 && !nodeId; attempt++) {
					if (attempt > 0) await wait(150);
					if (editor.isDestroyed) throw new Error("The document was closed.");
					const index = pending.blockId
						? topLevelIndexOfId(editor, pending.blockId)
						: pending.index;
					if (index < 0) throw new Error("This block was removed.");
					const currentRows = (await selectMarkdownBlocks(
						lix,
						fileId,
					).execute()) as MarkdownBlockRow[];
					nodeId =
						blockAlignment(editor.state.doc, currentRows).rowOfBlock[index] ??
						null;
				}
				if (!nodeId)
					throw new Error(
						"This block is not saved yet. Try again in a moment.",
					);
				await createBlockConversation(lix, fileId, nodeId, body);
				setPending(null);
				setPendingDraft(emptyCommentDocument());
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
				const nodeId = latest.current.alignment.rowOfBlock[index] ?? null;
				return nodeId && latest.current.threads.has(nodeId) ? nodeId : null;
			};
			const onKeyDown = (event: KeyboardEvent) => {
				if (isBlockCommentShortcut(event)) {
					event.preventDefault();
					startComment();
					return;
				}
				if (event.key === "Escape") setActive(null);
			};
			const onClick = () => {
				if (latest.current.layout !== "margin") return;
				const index = editor.state.selection.$head.index(0);
				const nodeId = latest.current.alignment.rowOfBlock[index] ?? null;
				if (nodeId && latest.current.threads.has(nodeId)) activate(nodeId);
				else setActive(null);
			};
			const onMouseOver = (event: MouseEvent) => {
				const nodeId = nodeIdAt(event.target);
				setHovered((current) => (current === nodeId ? current : nodeId));
			};
			const onMouseLeave = () => setHovered(null);
			dom.addEventListener("keydown", onKeyDown);
			dom.addEventListener("click", onClick);
			dom.addEventListener("mouseover", onMouseOver);
			dom.addEventListener("mouseleave", onMouseLeave);
			return () => {
				dom.removeEventListener("keydown", onKeyDown);
				dom.removeEventListener("click", onClick);
				dom.removeEventListener("mouseover", onMouseOver);
				dom.removeEventListener("mouseleave", onMouseLeave);
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
		if (!surface) return;
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
	}, [editor]);

	useLayoutEffect(() => {
		const surface = layerRef.current?.parentElement;
		if (!surface || editor.isDestroyed) return;
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
	}, [editor, indexes, layout, setLayout, tick]);

	return (
		<div
			ref={layerRef}
			className="markdown-block-comments"
			data-layout={layout}
			data-has-threads={hasThreads ? "" : undefined}
			aria-label="Comments"
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
	return (
		<button
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
			onClick={() => state.activate(open ? null : nodeId)}
			onMouseEnter={() => state.setHovered(nodeId)}
			onMouseLeave={() => state.setHovered(null)}
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
			top: geometry.boxes.get(entry.index)!.top,
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

	const activeRef = useRef<HTMLDivElement | null>(null);
	activeRef.current = (active && cardRefs.current.get(active.nodeId)) ?? null;
	useOutsidePress(activeRef, (target) => {
		// Clicks in the document decide for themselves (a click into another
		// commented block opens that one).
		if (state.editor.view.dom.contains(target)) return;
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
						top: geometry.boxes.get(entry.index)!.top,
					},
					onMouseEnter: () => state.setHovered(nodeId),
					onMouseLeave: () => state.setHovered(null),
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
						aria-label={`Open conversation: ${comments.length} ${
							comments.length === 1 ? "comment" : "comments"
						}`}
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
								<p className="markdown-comment-card-preview">
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
