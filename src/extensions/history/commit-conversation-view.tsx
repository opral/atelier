import {
	useEffect,
	useRef,
	useState,
	type Dispatch,
	type KeyboardEvent,
	type SetStateAction,
} from "react";
import {
	createZettelEditor,
	exportDocument,
	loadDocument,
	registerZettelLexicalPlugin,
	toPlainText,
	type Document,
} from "@opral/zettel-lexical";
import { toHtml } from "@opral/zettel-html";
import "@opral/zettel-html/style.css";
import "./comment-zettel.css";
import { Send } from "lucide-react";
import { useLix, useQueryResult } from "@/lib/lix-react";
import { formatCheckpointRelativeTime } from "@/lib/checkpoint-format";
import {
	createCommitConversation,
	emptyCommentBody,
	parseCommentBody,
	replyToConversation,
	selectConversationComments,
	type CommitConversation,
	type ConversationComment,
} from "./commit-conversations";

export type ConversationDrafts = {
	text: Document;
	replies: Record<string, Document>;
};

export function hasConversationDraft(drafts: ConversationDrafts): boolean {
	return Boolean(
		toPlainText(drafts.text).trim() ||
		Object.values(drafts.replies).some((document) =>
			toPlainText(document).trim(),
		),
	);
}

const REPLY_FIELD_BACKGROUND = {
	backgroundColor: "color-mix(in srgb, var(--atelier-panel) 72%, transparent)",
};

function Composer({
	label,
	value,
	onChange,
	onSubmit,
	placeholder,
	focusRequest = 0,
	onFocusHandled,
	onEscape,
}: {
	label: string;
	value: Document;
	onChange: (document: Document) => void;
	placeholder: string;
	onSubmit: (document: Document) => Promise<void>;
	focusRequest?: number;
	onFocusHandled?: () => void;
	onEscape?: () => void;
}) {
	const fieldRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<ReturnType<typeof createZettelEditor> | null>(null);
	if (!editorRef.current) {
		editorRef.current = createZettelEditor({
			namespace: "atelier-checkpoint-comment",
			onError: (cause) => {
				throw cause;
			},
		});
	}
	const editor = editorRef.current;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const initialValueRef = useRef(value);
	const serializedRef = useRef(JSON.stringify(value));
	const [active, setActive] = useState(Boolean(toPlainText(value).trim()));
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const hasText = Boolean(toPlainText(value).trim());
	useEffect(() => {
		editor.setRootElement(fieldRef.current);
		const unregisterPlugin = registerZettelLexicalPlugin(editor);
		loadDocument(editor, initialValueRef.current);
		const unregisterChanges = editor.registerUpdateListener(() => {
			const document = exportDocument(editor);
			const serialized = JSON.stringify(document);
			if (serialized === serializedRef.current) return;
			serializedRef.current = serialized;
			onChangeRef.current(document);
		});
		return () => {
			unregisterChanges();
			unregisterPlugin();
			editor.setRootElement(null);
		};
	}, [editor]);
	useEffect(() => {
		const serialized = JSON.stringify(value);
		if (serialized === serializedRef.current) return;
		serializedRef.current = serialized;
		loadDocument(editor, value);
	}, [editor, value]);
	useEffect(() => {
		if (focusRequest === 0) return;
		setActive(true);
		fieldRef.current?.focus();
		onFocusHandled?.();
	}, [focusRequest, onFocusHandled]);

	async function send() {
		const document = exportDocument(editor);
		if (!toPlainText(document).trim() || sending) return;
		setSending(true);
		setError(null);
		try {
			await onSubmit(document);
			const empty = emptyCommentBody();
			serializedRef.current = JSON.stringify(empty);
			loadDocument(editor, empty);
			onChange(empty);
			fieldRef.current?.blur();
			setActive(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSending(false);
		}
	}
	function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			event.stopPropagation();
			void send();
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			fieldRef.current?.blur();
			setActive(false);
			onEscape?.();
		}
	}
	return (
		<div
			ref={containerRef}
			data-review-shortcut-ignore=""
			className="mt-2"
			onKeyDownCapture={onKeyDown}
		>
			<div
				className="flex items-end gap-2 rounded-control border border-accent-border px-2 py-1.5 focus-within:border-history-input-border"
				style={REPLY_FIELD_BACKGROUND}
			>
				<div className="relative min-w-0 flex-1">
					{!hasText ? (
						<span
							aria-hidden="true"
							className="pointer-events-none absolute left-0 top-0 text-[12.5px] leading-5 text-history-selected-secondary"
						>
							{placeholder}
						</span>
					) : null}
					<div
						ref={fieldRef}
						aria-label={label}
						role="textbox"
						aria-multiline="true"
						contentEditable
						suppressContentEditableWarning
						onFocus={() => setActive(true)}
						onBlur={(event) => {
							if (
								!toPlainText(exportDocument(editor)).trim() &&
								!containerRef.current?.contains(event.relatedTarget)
							)
								setActive(false);
						}}
						className={`history-comment-editor min-w-0 bg-transparent text-[12.5px] leading-5 text-fg outline-none ${active ? "min-h-10" : "min-h-5"}`}
					/>
				</div>
				{active || hasText ? (
					<button
						type="button"
						onClick={() => void send()}
						disabled={!hasText || sending}
						aria-label={sending ? "Sending comment" : "Send comment"}
						className="cursor-pointer rounded-control p-1.5 text-accent hover:bg-accent-subtle disabled:cursor-default disabled:opacity-40"
					>
						<Send aria-hidden="true" className="size-3.5" />
					</button>
				) : null}
			</div>
			{error ? (
				<p role="alert" className="mt-1 text-[11px] text-danger">
					{error}
				</p>
			) : null}
			{active ? (
				<p className="mt-1 text-[10px] text-history-selected-secondary">
					⌘↵ send · Esc leave field
				</p>
			) : null}
		</div>
	);
}

function renderedComment(body: unknown): string | null {
	try {
		return toHtml(parseCommentBody(body));
	} catch {
		return null;
	}
}

/** A short, uninterrupted run by one author reads as one reply in the mockup. */
export function sharesCommentHeader(
	previous: ConversationComment | undefined,
	comment: ConversationComment,
): boolean {
	if (!previous?.author_name || previous.author_name !== comment.author_name)
		return false;
	if (!previous.lixcol_created_at || !comment.lixcol_created_at) return false;
	const elapsed =
		Date.parse(comment.lixcol_created_at) -
		Date.parse(previous.lixcol_created_at);
	return elapsed >= 0 && elapsed <= 5 * 60_000;
}

function Thread({
	conversation,
	readOnly,
	draft,
	onDraftChange,
	focusRequest,
	onFocusHandled,
}: {
	conversation: CommitConversation;
	readOnly: boolean;
	draft: Document;
	onDraftChange: (document: Document) => void;
	focusRequest: number;
	onFocusHandled: () => void;
}) {
	const lix = useLix();
	const [expanded, setExpanded] = useState(false);
	const [retryKey, setRetryKey] = useState(0);
	const result = useQueryResult(
		(session) => selectConversationComments(session, conversation.id),
		{ retryKey },
	);
	const comments = result.rows;
	const folded = comments.length > 4 && !expanded;
	const visible = folded
		? [0, comments.length - 2, comments.length - 1]
		: comments.map((_, index) => index);
	const hidden = folded ? comments.slice(1, -2) : [];
	const hiddenAuthors = [
		...new Set(hidden.map((comment) => comment.author_name || "Contributor")),
	];
	return (
		<article
			className={comments.length ? "border-t border-accent-border pt-3" : ""}
		>
			{result.status === "pending" ? (
				<p
					role="status"
					className="mt-2 text-[11px] text-history-selected-secondary"
				>
					Loading comments…
				</p>
			) : null}
			{result.status === "error" ? (
				<p role="alert" className="mt-2 text-[11px] text-danger">
					Could not load comments.{" "}
					<button
						type="button"
						onClick={() => setRetryKey((key) => key + 1)}
						className="underline"
					>
						Retry
					</button>
				</p>
			) : null}
			<div className={comments.length ? "space-y-3.5" : ""}>
				{visible.map((index) => {
					const comment = comments[index];
					if (!comment) return null;
					const html = renderedComment(comment.body);
					const grouped =
						!(folded && index === comments.length - 2) &&
						sharesCommentHeader(comments[index - 1], comment);
					return (
						<div key={comment.id}>
							{folded && index === comments.length - 2 ? (
								<button
									type="button"
									onClick={() => setExpanded(true)}
									className="mb-3 flex w-full items-center gap-2 rounded-control px-1 py-1 text-left text-[11px] font-medium text-accent hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									aria-label={`Show ${hidden.length} more comments from ${hiddenAuthors.join(", ")}`}
								>
									<span className="flex -space-x-1.5" aria-hidden="true">
										{hiddenAuthors.slice(0, 3).map((name) => (
											<span
												key={name}
												className="flex size-4 items-center justify-center rounded-full border border-accent-border bg-accent-subtle text-[8px] text-accent"
											>
												{name.slice(0, 1).toUpperCase()}
											</span>
										))}
									</span>
									{hidden.length} more comments
								</button>
							) : null}
							<div className="flex gap-2">
								{grouped ? (
									<span aria-hidden="true" className="size-5 shrink-0" />
								) : (
									<span
										aria-hidden="true"
										className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-border text-[10px] font-semibold text-accent"
									>
										{(comment.author_name || "?").slice(0, 1).toUpperCase()}
									</span>
								)}
								<div className="min-w-0 flex-1">
									{!grouped ? (
										<div className="flex items-baseline gap-2">
											<span className="text-[11.5px] font-semibold text-fg">
												{comment.author_name || "Contributor"}
											</span>
											{comment.lixcol_created_at ? (
												<time
													dateTime={comment.lixcol_created_at}
													className="text-[10.5px] text-history-selected-secondary"
												>
													{formatCheckpointRelativeTime(
														comment.lixcol_created_at,
													)}
												</time>
											) : null}
										</div>
									) : null}
									{html === null ? (
										<p className="text-[12.5px] text-danger">
											Unsupported comment document.
										</p>
									) : (
										<div
											className="history-comment-content"
											dangerouslySetInnerHTML={{
												__html: html,
											}}
										/>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>
			{!readOnly && result.status === "success" ? (
				<Composer
					label={
						comments.length
							? `Reply to ${conversation.title || "checkpoint"}`
							: "New comment"
					}
					placeholder={comments.length ? "Reply…" : "Comment"}
					value={draft}
					onChange={onDraftChange}
					focusRequest={focusRequest}
					onFocusHandled={onFocusHandled}
					onSubmit={async (document) => {
						await replyToConversation(lix, conversation.id, document);
						setRetryKey((key) => key + 1);
					}}
				/>
			) : null}
		</article>
	);
}

export function CommitConversationView({
	commitId,
	conversations,
	status,
	onRefresh,
	readOnly,
	drafts,
	setDrafts,
	focusNewRequest,
	onNewComposerFocused,
	open,
}: {
	commitId: string;
	conversations: readonly CommitConversation[];
	status: "pending" | "success" | "error";
	onRefresh: () => void;
	readOnly: boolean;
	drafts: ConversationDrafts;
	setDrafts: Dispatch<SetStateAction<ConversationDrafts>>;
	focusNewRequest: number;
	onNewComposerFocused: () => void;
	open: boolean;
}) {
	const lix = useLix();
	const [emptyDraft] = useState(emptyCommentBody);
	const rootRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open && rootRef.current?.contains(document.activeElement))
			(document.activeElement as HTMLElement).blur();
	}, [open]);
	async function create(document: Document) {
		await createCommitConversation(lix, commitId, document);
		onRefresh();
		setDrafts((current) => ({ ...current, text: emptyCommentBody() }));
	}
	return (
		<div
			ref={rootRef}
			className="mx-1.5 mb-2 px-3 pb-2 pt-2"
			aria-label="Commit conversations"
		>
			{status === "error" ? (
				<p role="alert" className="mb-2 text-[11px] text-danger">
					Could not load conversations.{" "}
					<button type="button" onClick={onRefresh} className="underline">
						Retry
					</button>
				</p>
			) : null}
			{status === "pending" ? (
				<p
					role="status"
					className="mb-2 text-[11px] text-history-selected-secondary"
				>
					Loading conversations…
				</p>
			) : null}
			{conversations.length > 0 ? (
				<div className="space-y-4">
					{conversations.map((conversation, index) => (
						<Thread
							key={conversation.id}
							conversation={conversation}
							readOnly={readOnly}
							draft={drafts.replies[conversation.id] ?? emptyDraft}
							onDraftChange={(document) =>
								setDrafts((current) => ({
									...current,
									replies: { ...current.replies, [conversation.id]: document },
								}))
							}
							focusRequest={index === 0 ? focusNewRequest : 0}
							onFocusHandled={onNewComposerFocused}
						/>
					))}
				</div>
			) : null}
			{!readOnly && status === "success" && conversations.length === 0 ? (
				<Composer
					label="New comment"
					placeholder="Comment on this checkpoint…"
					value={drafts.text}
					onChange={(document) =>
						setDrafts((current) => ({ ...current, text: document }))
					}
					onSubmit={create}
					focusRequest={focusNewRequest}
					onFocusHandled={onNewComposerFocused}
				/>
			) : null}
		</div>
	);
}
