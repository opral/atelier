import {
	useEffect,
	useRef,
	useState,
	type Dispatch,
	type SetStateAction,
} from "react";
import type { Document } from "@opral/zettel-ast";
import { useLix, useQueryResult } from "@/lib/lix-react";
import {
	Composer,
	emptyCommentDocument,
	hasCommentText,
} from "@/components/comments/comment-composer";
import { CommentThread } from "@/components/comments/comment-thread";
import {
	createCommitConversation,
	replyToConversation,
	selectConversationComments,
	type CommitConversation,
	type ConversationComment,
} from "./commit-conversations";

/**
 * What the reader has typed on one checkpoint: the first comment (no
 * conversation yet) or the reply. It outlives the checkpoint closing, so the
 * row can say "Draft" and the field comes back with the text.
 */
export type ConversationDraft = Document;

export function hasConversationDraft(draft: ConversationDraft): boolean {
	return hasCommentText(draft);
}

/**
 * The talk under an open checkpoint (design 4a): a hairline under the files
 * once there are comments, the thread, then the resting Reply field. With no
 * conversation yet, only the resting Comment field. Opening never focuses it;
 * pressing it, or the row's Comment chip, does. Several conversations on one
 * commit (another client started one) read as one thread; replies go to the
 * first, whose title the row shows.
 */
export function CommitConversationView({
	commitId,
	conversations,
	status,
	onRefresh,
	readOnly,
	draft,
	setDraft,
	unfolded,
	onUnfoldedChange,
	onCancel,
	focusRequest,
	onFocusHandled,
	open,
}: {
	readonly commitId: string;
	readonly conversations: readonly CommitConversation[];
	readonly status: "pending" | "success" | "error";
	/** Retry after a failed read. Writes need no refresh: reads are live. */
	readonly onRefresh: () => void;
	readonly readOnly: boolean;
	readonly draft: ConversationDraft;
	readonly setDraft: Dispatch<SetStateAction<ConversationDraft>>;
	readonly unfolded: boolean;
	readonly onUnfoldedChange: (unfolded: boolean) => void;
	/** Esc in the field: focus goes back to the checkpoint row. */
	readonly onCancel: () => void;
	readonly focusRequest: number;
	readonly onFocusHandled: () => void;
	readonly open: boolean;
}) {
	const lix = useLix();
	const rootRef = useRef<HTMLDivElement>(null);
	const [retryKey, setRetryKey] = useState(0);
	const conversationIds = conversations.map((conversation) => conversation.id);
	const comments = useQueryResult(
		(session) => selectConversationComments(session, conversationIds),
		{ enabled: conversationIds.length > 0, retryKey },
	);
	// A new conversation id (the reader's first comment, another session's)
	// starts a new read; keep the thread on screen until it answers.
	const lastRowsRef = useRef<readonly ConversationComment[]>([]);
	if (conversationIds.length === 0) lastRowsRef.current = [];
	else if (comments.status === "success") lastRowsRef.current = comments.rows;
	const rows = lastRowsRef.current;
	// Closing a checkpoint takes focus out of a field that is folding away.
	useEffect(() => {
		if (!open && rootRef.current?.contains(document.activeElement))
			(document.activeElement as HTMLElement).blur();
	}, [open]);
	const primary = conversations[0] ?? null;
	const loadFailed = status === "error" || comments.status === "error";
	// Only the first read shows a loading line. After that the field stays
	// mounted: the reader's own first comment creates a conversation, which
	// starts a new read, and must not take the field (and focus) away.
	const settledRef = useRef(false);
	if (
		status === "success" &&
		(conversationIds.length === 0 || comments.status === "success")
	)
		settledRef.current = true;
	const firstLoad = !settledRef.current;

	async function submit(document: Document) {
		if (primary) await replyToConversation(lix, primary.id, document);
		else await createCommitConversation(lix, commitId, document);
		setDraft(emptyCommentDocument());
	}

	return (
		<div
			ref={rootRef}
			aria-label="Checkpoint conversation"
			className="comment-surface flex flex-col gap-2"
		>
			{rows.length > 0 ? (
				<>
					<div
						aria-hidden="true"
						className="mt-0.5 mr-2 mb-0.5 ml-[23px] h-px bg-accent-border"
					/>
					<CommentThread
						comments={rows}
						label="Comments"
						expanded={unfolded}
						onExpandedChange={onUnfoldedChange}
					/>
				</>
			) : null}
			{loadFailed ? (
				<p
					role="alert"
					className="comment-secondary mr-2 ml-[23px] text-[11.5px] leading-4"
				>
					Could not load the conversation.{" "}
					<button
						type="button"
						onClick={() => {
							onRefresh();
							setRetryKey((key) => key + 1);
						}}
						className="cursor-pointer font-semibold text-accent-hover underline"
					>
						Retry
					</button>
				</p>
			) : firstLoad ? (
				<p
					role="status"
					className="comment-secondary mr-2 ml-[23px] text-[11.5px] leading-4"
				>
					Loading conversation…
				</p>
			) : null}
			{!readOnly && !loadFailed && !firstLoad ? (
				<Composer
					label={rows.length > 0 ? "Reply" : "Comment on this checkpoint"}
					placeholder={rows.length > 0 ? "Reply" : "Comment"}
					value={draft}
					onChange={setDraft}
					onSubmit={submit}
					onCancel={onCancel}
					focusRequest={focusRequest}
					onFocusHandled={onFocusHandled}
					className="mr-2 ml-[23px]"
				/>
			) : null}
		</div>
	);
}
