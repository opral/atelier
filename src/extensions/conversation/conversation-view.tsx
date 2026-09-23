import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Lix } from "@lix-js/sdk";
import type { Document } from "@opral/zettel-ast";
import { useLix, useQueryResult } from "@/lib/lix-react";
import { formatCheckpointRelativeTime } from "@/lib/checkpoint-format";
import { fileIconUrl } from "@/file-icons";
import { DiffGlyph } from "@/components/diff-glyph";
import {
	Composer,
	emptyCommentDocument,
} from "@/components/comments/comment-composer";
import {
	CommentThread,
	type ThreadComment,
} from "@/components/comments/comment-thread";
import {
	selectCommentAuthors,
	selectMarkdownBlocks,
	type MarkdownBlockRow,
} from "@/extensions/markdown/block-conversations";
import type {
	ExtensionRuntime,
	ExtensionView,
} from "@/extension-runtime/types";
import {
	anchorLabel,
	blockKindLabel,
	csvRowAnchor,
	isConversationId,
	markdownBlockAnchor,
	readCheckpointAnchor,
	readRemovedConversation,
	replyInConversation,
	resolveConversationTarget,
	selectConversation,
	selectConversationThread,
	selectCsvRecords,
	selectFilePath,
	setConversationTitle,
	type CheckpointAnchor,
	type ConversationCommentRow,
	type ConversationRow,
	type ConversationTarget,
	type CsvRowAnchor,
	type MarkdownBlockAnchor,
	type RemovedConversation,
} from "./conversation-queries";
import { ATELIER_CONVERSATION_VIEW_ID } from "./conversation-location";
import "./style.css";

type Runtime = Pick<
	ExtensionRuntime,
	"diff" | "documents" | "views" | "readOnly"
>;

/**
 * One conversation, read as a page (design "1a"): one reading column, no
 * view header — the shell has the tab — and always the same order: title,
 * what it is attached to, the anchor itself, the comments, the reply box.
 * The column is the frame; what it holds arrives as it is read.
 */
export function ConversationView({
	atelier,
	view,
}: {
	readonly atelier: Runtime;
	readonly view: Pick<ExtensionView, "state" | "instanceId" | "isActive">;
}) {
	const conversationId = isConversationId(view.state.conversationId)
		? view.state.conversationId
		: null;
	return (
		<div
			data-attr="conversation-view"
			className="conversation-view h-full min-h-0 overflow-y-auto bg-panel"
		>
			{conversationId ? (
				<ConversationReader
					key={conversationId}
					atelier={atelier}
					view={view}
					conversationId={conversationId}
				/>
			) : (
				<NotAvailable />
			)}
		</div>
	);
}

/** The same words for a deleted conversation and one the reader cannot open. */
function NotAvailable() {
	return (
		<div
			role="status"
			className="flex h-full min-h-60 flex-col items-center justify-center gap-2 px-6 text-center"
		>
			<p className="text-[16px] font-semibold text-fg">
				This conversation isn’t available
			</p>
			<p className="max-w-[360px] text-[13.5px] leading-normal text-history-secondary">
				It was deleted, or it lives in a repository you can’t open.
			</p>
		</div>
	);
}

function Column({ children }: { readonly children: ReactNode }) {
	return (
		<div className="mx-auto flex w-full max-w-[680px] flex-col gap-[22px] px-6 pt-12 pb-16">
			{children}
		</div>
	);
}

/** Re-renders once a minute so "12 minutes ago" keeps telling the truth. */
function useMinuteClock(): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000);
		return () => clearInterval(timer);
	}, []);
	return now;
}

type AsyncState<T> =
	| { readonly status: "pending" }
	| { readonly status: "success"; readonly value: T }
	| { readonly status: "error"; readonly error: unknown };

/** A one-shot read keyed by `key`; a new key starts over. */
function useAsyncRead<T>(
	key: string | null,
	read: () => Promise<T>,
): AsyncState<T> {
	const [state, setState] = useState<{
		readonly key: string | null;
		readonly value: AsyncState<T>;
	}>({ key: null, value: { status: "pending" } });
	const readRef = useRef(read);
	readRef.current = read;
	useEffect(() => {
		if (key === null) return;
		let cancelled = false;
		readRef.current().then(
			(value) => {
				if (!cancelled) setState({ key, value: { status: "success", value } });
			},
			(error: unknown) => {
				if (!cancelled) setState({ key, value: { status: "error", error } });
			},
		);
		return () => {
			cancelled = true;
		};
	}, [key]);
	return state.key === key ? state.value : { status: "pending" };
}

const EMPTY_AUTHORS: readonly {
	change_id: string;
	author_name: string | null;
}[] = [];

/** Comments with their authors: the thread is live, authors read once per set. */
function useThreadComments(
	rows: readonly ConversationCommentRow[],
): ThreadComment[] {
	const changeIds = useMemo(
		() =>
			[
				...new Set(
					rows.map((row) => row.change_id).filter((id): id is string => !!id),
				),
			].sort(),
		[rows],
	);
	const authorsResult = useQueryResult(
		(session) => selectCommentAuthors(session, changeIds),
		{ subscribe: false, enabled: changeIds.length > 0 },
	);
	const authors =
		authorsResult.status === "success" ? authorsResult.rows : EMPTY_AUTHORS;
	return useMemo(() => {
		const names = new Map(
			authors.map((author) => [author.change_id, author.author_name]),
		);
		return rows.map((row) => ({
			id: row.id,
			body: row.body,
			lixcol_created_at: row.lixcol_created_at,
			author_name: row.change_id ? (names.get(row.change_id) ?? null) : null,
		}));
	}, [authors, rows]);
}

function ConversationReader({
	atelier,
	view,
	conversationId,
}: {
	readonly atelier: Runtime;
	readonly view: Pick<ExtensionView, "state" | "instanceId" | "isActive">;
	readonly conversationId: string;
}) {
	const lix = useLix();
	const result = useQueryResult((session) =>
		selectConversation(session, conversationId),
	);
	const conversation = result.rows[0] ?? null;
	const missing = result.status === "success" && conversation === null;
	const removed = useAsyncRead(missing ? conversationId : null, () =>
		readRemovedConversation(lix, conversationId),
	);
	if (result.status === "error") return <NotAvailable />;
	if (missing) {
		if (removed.status === "pending") return null;
		if (removed.status === "error" || removed.value === null)
			return <NotAvailable />;
		return (
			<RemovedConversationPage
				atelier={atelier}
				view={view}
				removed={removed.value}
			/>
		);
	}
	if (!conversation) return null;
	return (
		<LiveConversation
			atelier={atelier}
			view={view}
			conversation={conversation}
		/>
	);
}

type Anchor = CheckpointAnchor | MarkdownBlockAnchor | CsvRowAnchor;

function LiveConversation({
	atelier,
	view,
	conversation,
}: {
	readonly atelier: Runtime;
	readonly view: Pick<ExtensionView, "state" | "instanceId" | "isActive">;
	readonly conversation: ConversationRow;
}) {
	const lix = useLix();
	const now = useMinuteClock();
	const target = useAsyncRead(conversation.target ?? "", () =>
		resolveConversationTarget(lix, conversation.target),
	);
	const resolved: ConversationTarget | null =
		target.status === "success" ? target.value : null;
	const anchor = useAnchor(lix, resolved);
	const threadResult = useQueryResult((session) =>
		selectConversationThread(
			session,
			conversation.id,
			conversation.lixcol_global,
		),
	);
	const comments = useThreadComments(threadResult.rows);
	const title = conversation.title?.trim() || null;
	const label =
		title ??
		anchorLabel(
			anchor.value ??
				(resolved?.kind === "row" || resolved?.kind === "none"
					? resolved
					: null),
		) ??
		(anchor.settled ? "Conversation" : null);
	useTabLabel(atelier, view, label, title);

	// Hold the page until what it is attached to has been read, so the
	// context line and the anchor never arrive after the comments below them.
	if (!anchor.settled || threadResult.status === "pending") return null;
	return (
		<Column>
			<div className="flex flex-col gap-2.5">
				<ConversationTitle
					title={title}
					readOnly={atelier.readOnly}
					onSave={(next) => setConversationTitle(lix, conversation, next)}
				/>
				{anchor.value ? (
					<ContextLine
						anchor={anchor.value}
						now={now}
						onOpen={() => openAnchor(atelier, anchor.value!, conversation.id)}
					/>
				) : resolved?.kind === "row" ? (
					<p className="text-[13px] text-history-secondary">
						On a row of {resolved.relation ?? "another table"}
					</p>
				) : null}
			</div>
			{anchor.value ? (
				<>
					<AnchorDetail
						anchor={anchor.value}
						onOpen={(path) =>
							openAnchor(atelier, anchor.value!, conversation.id, path)
						}
					/>
					<Hairline />
				</>
			) : null}
			<Thread comments={comments} />
			{atelier.readOnly ? null : (
				<ReplyBox
					onSubmit={(body) => replyInConversation(lix, conversation, body)}
				/>
			)}
		</Column>
	);
}

/** The anchor's current state, live where the anchor lives in a file. */
function useAnchor(
	lix: Lix,
	target: ConversationTarget | null,
): { readonly value: Anchor | null; readonly settled: boolean } {
	const commitId = target?.kind === "checkpoint" ? target.commitId : null;
	const checkpoint = useAsyncRead(commitId, () =>
		readCheckpointAnchor(lix, commitId!),
	);
	const fileId =
		target?.kind === "markdown_block" || target?.kind === "csv_row"
			? target.fileId
			: null;
	const path = useQueryResult(
		(session) => selectFilePath(session, fileId ?? ""),
		{ enabled: fileId !== null },
	);
	const blocks = useQueryResult<MarkdownBlockRow>(
		(session) => selectMarkdownBlocks(session, fileId ?? ""),
		{ enabled: target?.kind === "markdown_block" },
	);
	const records = useQueryResult(
		(session) => selectCsvRecords(session, fileId ?? ""),
		{ enabled: target?.kind === "csv_row" },
	);
	if (!target) return { value: null, settled: false };
	switch (target.kind) {
		case "checkpoint":
			return checkpoint.status === "pending"
				? { value: null, settled: false }
				: {
						value: checkpoint.status === "success" ? checkpoint.value : null,
						settled: true,
					};
		case "markdown_block":
			if (blocks.status === "pending" || path.status === "pending")
				return { value: null, settled: false };
			return {
				value: markdownBlockAnchor(
					blocks.rows,
					target.fileId,
					path.rows[0]?.path ?? null,
					target.nodeId,
				),
				settled: true,
			};
		case "csv_row":
			if (records.status === "pending" || path.status === "pending")
				return { value: null, settled: false };
			return {
				value: csvRowAnchor(
					records.rows,
					target.fileId,
					path.rows[0]?.path ?? null,
					target.rowId,
				),
				settled: true,
			};
		default:
			return { value: null, settled: true };
	}
}

/**
 * The tab carries the title (else what the conversation is on), and the
 * view state carries both so `main_view_activated` hands a host what it
 * needs for `/conversation/<id>/<title>`.
 */
function useTabLabel(
	atelier: Runtime,
	view: Pick<ExtensionView, "state" | "instanceId" | "isActive">,
	label: string | null,
	title: string | null,
) {
	const state = view.state;
	const currentLabel =
		(state.atelier as { label?: unknown } | undefined)?.label ?? null;
	const currentTitle = state.title ?? null;
	useEffect(() => {
		if (!view.isActive || label === null) return;
		if (currentLabel === label && currentTitle === title) return;
		void atelier.views
			.open(ATELIER_CONVERSATION_VIEW_ID, {
				instanceId: view.instanceId,
				focus: false,
				state: {
					...state,
					title,
					atelier: { ...state.atelier, label },
				},
			})
			.catch(() => {});
	}, [
		atelier.views,
		currentLabel,
		currentTitle,
		label,
		state,
		title,
		view.instanceId,
		view.isActive,
	]);
}

/* ── Title ─────────────────────────────────────────────────────────── */

function ConversationTitle({
	title,
	readOnly,
	onSave,
}: {
	readonly title: string | null;
	readonly readOnly: boolean;
	readonly onSave?: (title: string) => Promise<void>;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const doneRef = useRef(false);
	useEffect(() => {
		if (editing) inputRef.current?.select();
	}, [editing]);
	const heading = "text-[26px] leading-[1.2] tracking-[-0.015em] outline-none";
	if (editing) {
		const finish = async (save: boolean) => {
			if (doneRef.current) return;
			doneRef.current = true;
			if (save && onSave && draft.trim() !== (title ?? "")) {
				try {
					await onSave(draft);
				} catch (cause) {
					setError(cause instanceof Error ? cause.message : String(cause));
				}
			}
			setEditing(false);
		};
		return (
			<input
				ref={inputRef}
				aria-label="Conversation title"
				value={draft}
				placeholder="Add a title"
				onChange={(event) => setDraft(event.target.value)}
				onBlur={() => void finish(true)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						void finish(true);
					} else if (event.key === "Escape") {
						event.preventDefault();
						void finish(false);
					}
				}}
				className={`conversation-title-input w-full bg-transparent p-0 font-bold text-fg ${heading}`}
			/>
		);
	}
	const begin = () => {
		if (readOnly || !onSave) return;
		doneRef.current = false;
		setDraft(title ?? "");
		setError(null);
		setEditing(true);
	};
	return (
		<>
			<h1 className="m-0">
				{title ? (
					<button
						type="button"
						onClick={begin}
						disabled={readOnly || !onSave}
						className={`block w-full cursor-text p-0 text-left font-bold text-fg disabled:cursor-default ${heading}`}
					>
						{title}
					</button>
				) : (
					<button
						type="button"
						onClick={begin}
						disabled={readOnly || !onSave}
						className={`flex cursor-text items-center gap-2.5 p-0 text-left font-semibold text-history-flag disabled:cursor-default ${heading}`}
					>
						Add a title
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							className="size-4"
							fill="none"
							stroke="currentColor"
							strokeWidth={2}
						>
							<path d="M12 20h9" />
							<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
						</svg>
					</button>
				)}
			</h1>
			{error ? (
				<p role="alert" className="text-[12px] text-danger">
					{error}
				</p>
			) : null}
		</>
	);
}

/* ── Context line and anchor detail ─────────────────────────────────── */

function FileIcon({ path }: { readonly path: string | null }) {
	return (
		<img
			src={fileIconUrl(path ?? "file")}
			alt=""
			aria-hidden="true"
			className="size-[13px] shrink-0"
		/>
	);
}

function Flag() {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 16 16"
			className="size-3 shrink-0 text-accent"
		>
			<path
				fill="currentColor"
				d="M3 1.25a.75.75 0 0 1 1.5 0v.5h7.1a.75.75 0 0 1 .62 1.17L10.83 5l1.39 2.08a.75.75 0 0 1-.62 1.17H4.5v6.5a.75.75 0 0 1-1.5 0V1.25Z"
			/>
		</svg>
	);
}

function ContextLink({
	children,
	onClick,
}: {
	readonly children: ReactNode;
	readonly onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="conversation-context-link cursor-pointer p-0 leading-4 font-semibold text-fg-muted"
		>
			{children}
		</button>
	);
}

function Separator() {
	return (
		<span aria-hidden="true" className="text-fg-faint">
			›
		</span>
	);
}

function fileName(path: string | null): string {
	return path?.split("/").filter(Boolean).at(-1) ?? "Untitled file";
}

function ContextLine({
	anchor,
	now,
	onOpen,
	removal,
}: {
	readonly anchor: Anchor;
	readonly now: number;
	readonly onOpen: () => void;
	/** Set when the anchor was deleted: what removed it. */
	readonly removal?: {
		readonly at: string | null;
		readonly inCheckpoint: boolean;
		readonly onOpenCheckpoint: () => void;
	};
}) {
	const line = (children: ReactNode) => (
		<nav
			aria-label="Attached to"
			className="flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] leading-4 text-history-secondary"
		>
			{children}
		</nav>
	);
	if (anchor.kind === "checkpoint") {
		return line(
			<>
				<Flag />
				<ContextLink onClick={onOpen}>
					{anchor.createdAt
						? `Checkpoint, ${formatCheckpointRelativeTime(anchor.createdAt, now)}`
						: "Checkpoint"}
				</ContextLink>
			</>,
		);
	}
	const where =
		anchor.kind === "csv_row"
			? anchor.rowNumber === 0
				? "header"
				: `row ${anchor.rowNumber}`
			: anchor.heading;
	return line(
		<>
			<FileIcon path={anchor.filePath} />
			<ContextLink onClick={onOpen}>{fileName(anchor.filePath)}</ContextLink>
			{removal ? (
				<>
					<Separator />
					<span>
						{anchor.kind === "csv_row"
							? "row removed"
							: `${blockKindLabel(anchor.blockKind)} removed`}
						{removal.inCheckpoint && removal.at ? " in" : ""}
					</span>
					{removal.inCheckpoint && removal.at ? (
						<ContextLink onClick={removal.onOpenCheckpoint}>
							{`Checkpoint, ${formatCheckpointRelativeTime(removal.at, now)}`}
						</ContextLink>
					) : null}
				</>
			) : where ? (
				<>
					<Separator />
					<span>{where}</span>
				</>
			) : null}
		</>,
	);
}

function AnchorDetail({
	anchor,
	onOpen,
	removed = false,
}: {
	readonly anchor: Anchor;
	/** Opens the anchor; a checkpoint's file row passes its path. */
	readonly onOpen: (path?: string) => void;
	readonly removed?: boolean;
}) {
	if (anchor.kind === "checkpoint") {
		if (anchor.files.length === 0) return null;
		return (
			<ul
				aria-label="Files in this checkpoint"
				className="-mx-2 -mt-1 flex flex-col"
			>
				{anchor.files.map((file) => (
					<li key={file.id}>
						<button
							type="button"
							onClick={() => onOpen(file.path)}
							className="conversation-row flex h-[30px] w-full cursor-pointer items-center gap-2 rounded-[6px] px-2 py-0 text-left text-[12.5px] text-fg-muted"
						>
							<FileIcon path={file.path} />
							<span className="min-w-0 truncate">{fileName(file.path)}</span>
							<span className="flex-1" />
							<DiffGlyph kind={file.changeKind} size={11} />
						</button>
					</li>
				))}
			</ul>
		);
	}
	if (anchor.kind === "markdown_block") {
		return (
			<button
				type="button"
				onClick={() => onOpen()}
				aria-label={`Open ${fileName(anchor.filePath)}${removed ? "" : " at this block"}`}
				className={`conversation-well cursor-pointer rounded-panel px-3.5 py-2.5 text-left text-[14.5px] leading-[1.6] ${
					removed ? "text-history-secondary line-through" : "text-fg"
				}`}
			>
				{anchor.text ||
					blockKindLabel(anchor.blockKind).replace(/^./, (c) =>
						c.toUpperCase(),
					)}
			</button>
		);
	}
	return (
		<CsvRowTable anchor={anchor} onOpen={() => onOpen()} removed={removed} />
	);
}

const MAX_CSV_COLUMNS = 6;

function looksLiteral(value: string): boolean {
	return /^[\d\s.:/+-]+$/.test(value) && /\d/.test(value);
}

function CsvRowTable({
	anchor,
	onOpen,
	removed,
}: {
	readonly anchor: CsvRowAnchor;
	readonly onOpen: () => void;
	readonly removed: boolean;
}) {
	const count = Math.min(
		MAX_CSV_COLUMNS,
		Math.max(anchor.header.length, anchor.cells.length),
	);
	const columns = Array.from({ length: count }, (_, index) => index);
	const template = `50px ${columns.map((index) => (index === 0 ? "1.4fr" : "1fr")).join(" ")}`;
	return (
		<button
			type="button"
			onClick={onOpen}
			aria-label={`Open ${fileName(anchor.filePath)}${removed ? "" : ` at row ${anchor.rowNumber}`}`}
			className={`block w-full cursor-pointer overflow-hidden rounded-panel p-0 border border-border text-left text-[12.5px] leading-[1.2] ${
				removed ? "line-through" : ""
			}`}
		>
			<span
				className="grid border-b border-border bg-bg-subtle text-[10.5px] font-bold tracking-[0.04em] text-fg-muted uppercase"
				style={{ gridTemplateColumns: template }}
			>
				<span className="px-2.5 py-2">Row</span>
				{columns.map((index) => (
					<span key={index} className="truncate px-2.5 py-2">
						{anchor.header[index] ?? ""}
					</span>
				))}
			</span>
			<span
				className={`grid ${removed ? "text-history-secondary" : "text-fg"}`}
				style={{ gridTemplateColumns: template }}
			>
				<span className="px-2.5 py-[9px] font-mono text-history-secondary">
					{anchor.rowNumber}
				</span>
				{columns.map((index) => {
					const value = anchor.cells[index] ?? "";
					return (
						<span
							key={index}
							className={`truncate px-2.5 py-[9px] ${
								index === 0 ? "font-semibold" : ""
							} ${looksLiteral(value) ? "font-mono" : ""}`}
						>
							{value}
						</span>
					);
				})}
			</span>
		</button>
	);
}

function Hairline() {
	return <div aria-hidden="true" className="h-px bg-border-subtle" />;
}

/* ── Comments and the reply box ─────────────────────────────────────── */

function Thread({ comments }: { readonly comments: readonly ThreadComment[] }) {
	if (comments.length === 0) {
		return (
			<p className="text-[13.5px] leading-[1.2] text-history-secondary">
				No comments yet.
			</p>
		);
	}
	return (
		<CommentThread comments={comments} tone="neutral" size="view" collapsible />
	);
}

function ReplyBox({
	onSubmit,
}: {
	readonly onSubmit: (body: Document) => Promise<void>;
}) {
	const [draft, setDraft] = useState<Document>(emptyCommentDocument);
	return (
		<Composer
			label="Leave a comment"
			placeholder="Leave a comment…"
			value={draft}
			onChange={setDraft}
			onSubmit={onSubmit}
			tone="neutral"
			size="view"
		/>
	);
}

/* ── Removed with its anchor ────────────────────────────────────────── */

function RemovedConversationPage({
	atelier,
	view,
	removed,
}: {
	readonly atelier: Runtime;
	readonly view: Pick<ExtensionView, "state" | "instanceId" | "isActive">;
	readonly removed: RemovedConversation;
}) {
	const now = useMinuteClock();
	const comments = useThreadComments(removed.comments);
	const title = removed.conversation.title?.trim() || null;
	useTabLabel(
		atelier,
		view,
		title ?? anchorLabel(removed.anchor) ?? "Conversation",
		title,
	);
	const anchor = removed.anchor;
	const openFile = () => {
		if (anchor && "filePath" in anchor && anchor.filePath)
			void atelier.documents.open(anchor.filePath, { newTab: true });
	};
	const openRemoval = () => {
		void openReviewBeside(
			atelier,
			removed.removedInParentCommitId,
			removed.removedInCommitId,
			anchor && "filePath" in anchor ? anchor.filePath : null,
		);
	};
	return (
		<Column>
			<div className="flex flex-col gap-2.5">
				{/* The conversation is gone; its title can no longer change. */}
				<ConversationTitle title={title} readOnly />
				{anchor ? (
					<ContextLine
						anchor={anchor}
						now={now}
						onOpen={openFile}
						removal={{
							at: removed.removedAt,
							inCheckpoint: removed.removedInCheckpoint,
							onOpenCheckpoint: openRemoval,
						}}
					/>
				) : null}
			</div>
			{anchor ? (
				<>
					<AnchorDetail anchor={anchor} onOpen={openFile} removed />
					<Hairline />
				</>
			) : null}
			<Thread comments={comments} />
		</Column>
	);
}

/* ── Where the anchor opens ─────────────────────────────────────────── */

/**
 * Opens a checkpoint's review at a file. The file first gets a tab of its
 * own, so the review steps through it there and the conversation keeps
 * its tab (a review navigates the active tab in place).
 */
async function openReviewBeside(
	atelier: Runtime,
	parentCommitId: string | null,
	commitId: string,
	path: string | null,
) {
	await atelier.diff.open({
		base: parentCommitId ? { commitId: parentCommitId } : null,
		target: { commitId },
	});
	if (!path) return;
	// A file the checkpoint removed has no tab to open; the review shows it.
	await atelier.documents.open(path, { newTab: true }).catch(() => {});
	atelier.diff.openFile(path);
}

/**
 * Opens what a conversation is on. A checkpoint opens its review (at a
 * file, for a file row); a Markdown block or CSV row opens its file in a
 * new tab, with `state.reveal` naming the block or row for the document
 * view to bring into view: `{ conversationId, rowId, rowNumber? }`.
 */
function openAnchor(
	atelier: Runtime,
	anchor: Anchor,
	conversationId: string,
	path?: string,
) {
	if (anchor.kind === "checkpoint") {
		void openReviewBeside(
			atelier,
			anchor.parentCommitId,
			anchor.commitId,
			path ?? anchor.files[0]?.path ?? null,
		);
		return;
	}
	if (!anchor.filePath) return;
	void atelier.documents.open(anchor.filePath, {
		newTab: true,
		state: {
			reveal:
				anchor.kind === "csv_row"
					? { conversationId, rowId: anchor.rowId, rowNumber: anchor.rowNumber }
					: { conversationId, rowId: anchor.nodeId },
		},
	});
}
