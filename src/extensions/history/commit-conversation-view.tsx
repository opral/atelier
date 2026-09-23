import { useState, type KeyboardEvent } from "react";
import { MessageSquare, Send } from "lucide-react";
import { useLix, useQueryResult } from "@/lib/lix-react";
import { formatCheckpointRelativeTime } from "@/lib/checkpoint-format";
import {
	commentParagraphs,
	createCommitConversation,
	replyToConversation,
	selectConversationComments,
	type CommitConversation,
} from "./commit-conversations";

function Composer({
	label,
	onSubmit,
	placeholder,
}: {
	label: string;
	placeholder: string;
	onSubmit: (text: string) => Promise<void>;
}) {
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	async function send() {
		if (!text.trim() || sending) return;
		setSending(true);
		setError(null);
		try {
			await onSubmit(text);
			setText("");
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
		if (event.key === "Escape") event.currentTarget.blur();
	}
	return (
		<div className="mt-2">
			<div className="flex items-end gap-2 rounded-panel border border-history-input-border bg-panel px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
				<textarea
					aria-label={label}
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={placeholder}
					rows={2}
					className="min-h-12 min-w-0 flex-1 resize-y bg-transparent text-[12px] leading-5 text-fg outline-none placeholder:text-history-selected-secondary"
				/>
				<button
					type="button"
					onClick={() => void send()}
					disabled={!text.trim() || sending}
					aria-label={sending ? "Sending comment" : "Send comment"}
					className="rounded-panel p-1.5 text-accent hover:bg-accent-subtle disabled:opacity-40"
				>
					<Send aria-hidden="true" className="size-3.5" />
				</button>
			</div>
			{error ? (
				<p role="alert" className="mt-1 text-[11px] text-danger">
					{error}
				</p>
			) : null}
			<p className="mt-1 text-[10px] text-history-selected-secondary">
				⌘↵ send · Esc leave field
			</p>
		</div>
	);
}

function Thread({
	conversation,
	readOnly,
}: {
	conversation: CommitConversation;
	readOnly: boolean;
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
	const visible = folded ? [comments[0], ...comments.slice(-2)] : comments;
	return (
		<article className="border-t border-border-subtle pt-3 first:border-t-0 first:pt-0">
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
				<p role="status" className="mt-2 text-[11px] text-fg-muted">
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
			<div className="mt-2 space-y-2.5">
				{visible.map((comment, index) =>
					comment ? (
						<div key={comment.id}>
							{folded && index === 1 ? (
								<button
									type="button"
									onClick={() => setExpanded(true)}
									className="mb-2 text-[11px] font-medium text-accent hover:underline"
								>
									{comments.length - 3} more comments
								</button>
							) : null}
							<div className="flex gap-2">
								<span
									aria-hidden="true"
									className="flex size-5 shrink-0 items-center justify-center rounded-full bg-bg-active text-[10px] font-semibold text-fg-muted"
								>
									{(comment.author_name || "?").slice(0, 1).toUpperCase()}
								</span>
								<div className="min-w-0 flex-1">
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
									{commentParagraphs(comment.body).map(
										(paragraph, paragraphIndex) => (
											<p
												key={paragraphIndex}
												className="whitespace-pre-wrap text-[11.5px] leading-[1.55] text-fg-muted"
											>
												{paragraph}
											</p>
										),
									)}
								</div>
							</div>
						</div>
					) : null,
				)}
			</div>
			{!readOnly && result.status === "success" ? (
				<Composer
					label={`Reply to ${conversation.title || "conversation"}`}
					placeholder="Reply…"
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
}: {
	commitId: string;
	conversations: readonly CommitConversation[];
	status: "pending" | "success" | "error";
	onRefresh: () => void;
	readOnly: boolean;
}) {
	const lix = useLix();
	const [title, setTitle] = useState("");
	const [showNew, setShowNew] = useState(false);
	async function create(text: string) {
		await createCommitConversation(lix, commitId, title, text);
		onRefresh();
		setTitle("");
		setShowNew(false);
	}
	return (
		<div
			className="mx-1.5 mb-2 rounded-panel border border-accent-border bg-accent-subtle px-3 py-3"
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
				<p role="status" className="mb-2 text-[11px] text-fg-muted">
					Loading conversations…
				</p>
			) : null}
			{conversations.length > 0 ? (
				<div className="space-y-3">
					{conversations.map((conversation) => (
						<Thread
							key={conversation.id}
							conversation={conversation}
							readOnly={readOnly}
						/>
					))}
				</div>
			) : status === "success" ? (
				<p className="text-[11.5px] text-fg-muted">
					No comments on this checkpoint yet.
				</p>
			) : null}
			{!readOnly && status === "success" ? (
				<div
					className={
						conversations.length
							? "mt-3 border-t border-accent-border pt-2"
							: "mt-2"
					}
				>
					{!showNew ? (
						<button
							type="button"
							onClick={() => setShowNew(true)}
							className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-accent hover:underline"
						>
							<MessageSquare aria-hidden="true" className="size-3.5" /> Start a
							conversation
						</button>
					) : (
						<>
							<input
								aria-label="Conversation title"
								value={title}
								onChange={(event) => setTitle(event.target.value)}
								placeholder="Title (optional)"
								className="w-full rounded-panel border border-history-input-border bg-panel px-2 py-1.5 text-[12px] text-fg outline-none focus:ring-2 focus:ring-ring placeholder:text-history-selected-secondary"
							/>
							<Composer
								label="New comment"
								placeholder="Comment on this checkpoint…"
								onSubmit={create}
							/>
							<button
								type="button"
								onClick={() => setShowNew(false)}
								className="mt-1 text-[11px] text-history-selected-secondary hover:underline"
							>
								Cancel
							</button>
						</>
					)}
				</div>
			) : null}
		</div>
	);
}
