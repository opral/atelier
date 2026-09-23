import {
	useEffect,
	useRef,
	useState,
	type Dispatch,
	type KeyboardEvent,
	type SetStateAction,
} from "react";
import { MessageSquare, Send } from "lucide-react";
import { useLix, useQueryResult } from "@/lib/lix-react";
import { formatCheckpointRelativeTime } from "@/lib/checkpoint-format";
import {
	commentParagraphs,
	createCommitConversation,
	replyToConversation,
	selectConversationComments,
	type CommitConversation,
	type ConversationComment,
} from "./commit-conversations";

export type ConversationDrafts = {
	title: string;
	text: string;
	replies: Record<string, string>;
};

export function hasConversationDraft(drafts: ConversationDrafts): boolean {
	return Boolean(
		drafts.title.trim() ||
		drafts.text.trim() ||
		Object.values(drafts.replies).some((text) => text.trim()),
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
	value: string;
	onChange: (text: string) => void;
	placeholder: string;
	onSubmit: (text: string) => Promise<void>;
	focusRequest?: number;
	onFocusHandled?: () => void;
	onEscape?: () => void;
}) {
	const fieldRef = useRef<HTMLTextAreaElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [active, setActive] = useState(Boolean(value));
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (focusRequest === 0) return;
		setActive(true);
		fieldRef.current?.focus();
		onFocusHandled?.();
	}, [focusRequest, onFocusHandled]);

	async function send() {
		if (!value.trim() || sending) return;
		setSending(true);
		setError(null);
		try {
			await onSubmit(value);
			onChange("");
			fieldRef.current?.blur();
			setActive(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setSending(false);
		}
	}
	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			void send();
		}
		if (event.key === "Escape") {
			event.currentTarget.blur();
			setActive(false);
			onEscape?.();
		}
	}
	return (
		<div ref={containerRef} className="mt-2">
			<div
				className="flex items-end gap-2 rounded-control border border-history-input-border px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring"
				style={REPLY_FIELD_BACKGROUND}
			>
				<textarea
					ref={fieldRef}
					aria-label={label}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					onFocus={() => setActive(true)}
					onBlur={(event) => {
						if (
							!value.trim() &&
							!containerRef.current?.contains(event.relatedTarget)
						)
							setActive(false);
					}}
					onKeyDown={onKeyDown}
					placeholder={placeholder}
					rows={active ? 2 : 1}
					className={`min-w-0 flex-1 bg-transparent text-[12.5px] leading-5 text-fg outline-none placeholder:text-history-selected-secondary ${active ? "min-h-10 resize-y" : "min-h-5 resize-none"}`}
				/>
				{active || value ? (
					<button
						type="button"
						onClick={() => void send()}
						disabled={!value.trim() || sending}
						aria-label={sending ? "Sending comment" : "Send comment"}
						className="rounded-control p-1.5 text-accent hover:bg-accent-subtle disabled:opacity-40"
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
}: {
	conversation: CommitConversation;
	readOnly: boolean;
	draft: string;
	onDraftChange: (text: string) => void;
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
		<article className="border-t border-accent-border pt-3 first:border-t-0 first:pt-0">
			<div className="flex items-center justify-between gap-2">
				<h4 className="min-w-0 truncate text-[12px] font-semibold text-fg">
					{conversation.title || "Conversation"}
				</h4>
				{result.status === "success" ? (
					<span className="shrink-0 text-[11px] text-history-selected-secondary">
						{comments.length} {comments.length === 1 ? "comment" : "comments"}
					</span>
				) : null}
			</div>
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
			<div className="mt-3 space-y-3.5">
				{visible.map((index) => {
					const comment = comments[index];
					if (!comment) return null;
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
									{commentParagraphs(comment.body).map(
										(paragraph, paragraphIndex) => (
											<p
												key={paragraphIndex}
												className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-fg-muted"
											>
												{paragraph}
											</p>
										),
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>
			{!readOnly && result.status === "success" ? (
				<Composer
					label={`Reply to ${conversation.title || "conversation"}`}
					placeholder="Reply…"
					value={draft}
					onChange={onDraftChange}
					onSubmit={async (text) => {
						await replyToConversation(lix, conversation.id, text);
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
	showNew,
	setShowNew,
	focusNewRequest,
	onNewComposerFocused,
	requestFocusNew,
	open,
}: {
	commitId: string;
	conversations: readonly CommitConversation[];
	status: "pending" | "success" | "error";
	onRefresh: () => void;
	readOnly: boolean;
	drafts: ConversationDrafts;
	setDrafts: Dispatch<SetStateAction<ConversationDrafts>>;
	showNew: boolean;
	setShowNew: (show: boolean) => void;
	focusNewRequest: number;
	onNewComposerFocused: () => void;
	requestFocusNew: () => void;
	open: boolean;
}) {
	const lix = useLix();
	const rootRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open && rootRef.current?.contains(document.activeElement))
			(document.activeElement as HTMLElement).blur();
	}, [open]);
	async function create(text: string) {
		await createCommitConversation(lix, commitId, drafts.title, text);
		onRefresh();
		setDrafts((current) => ({ ...current, title: "", text: "" }));
		setShowNew(false);
	}
	return (
		<div
			ref={rootRef}
			className="mx-1.5 mb-2 border-t border-accent-border px-3 pb-2 pt-3"
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
					{conversations.map((conversation) => (
						<Thread
							key={conversation.id}
							conversation={conversation}
							readOnly={readOnly}
							draft={drafts.replies[conversation.id] ?? ""}
							onDraftChange={(text) =>
								setDrafts((current) => ({
									...current,
									replies: { ...current.replies, [conversation.id]: text },
								}))
							}
						/>
					))}
				</div>
			) : null}
			{!readOnly && status === "success" ? (
				<div
					className={
						conversations.length
							? "mt-4 border-t border-accent-border pt-2"
							: ""
					}
				>
					{showNew ? (
						<>
							<input
								aria-label="Conversation title"
								value={drafts.title}
								onChange={(event) =>
									setDrafts((current) => ({
										...current,
										title: event.target.value,
									}))
								}
								placeholder="Title (optional)"
								className="w-full rounded-control border border-history-input-border px-2 py-1.5 text-[12px] text-fg outline-none focus:ring-2 focus:ring-ring placeholder:text-history-selected-secondary"
								style={REPLY_FIELD_BACKGROUND}
							/>
							<Composer
								label="New comment"
								placeholder="Comment on this checkpoint…"
								value={drafts.text}
								onChange={(text) =>
									setDrafts((current) => ({ ...current, text }))
								}
								onSubmit={create}
								focusRequest={focusNewRequest}
								onFocusHandled={onNewComposerFocused}
								onEscape={() => setShowNew(false)}
							/>
							<button
								type="button"
								onClick={() => setShowNew(false)}
								className="mt-1 text-[11px] text-history-selected-secondary hover:underline"
							>
								{hasConversationDraft(drafts) ? "Keep draft" : "Cancel"}
							</button>
						</>
					) : conversations.length ? (
						<button
							type="button"
							onClick={requestFocusNew}
							className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-accent hover:underline"
						>
							<MessageSquare aria-hidden="true" className="size-3.5" />{" "}
							{drafts.title || drafts.text
								? "Continue draft"
								: "New conversation"}
						</button>
					) : (
						<button
							type="button"
							onClick={requestFocusNew}
							className="w-full rounded-control border border-history-input-border px-2 py-1.5 text-left text-[12.5px] text-history-selected-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							style={REPLY_FIELD_BACKGROUND}
						>
							{drafts.title || drafts.text
								? "Continue draft…"
								: "Comment on this checkpoint…"}
						</button>
					)}
				</div>
			) : null}
		</div>
	);
}
