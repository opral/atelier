import {
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
} from "react";
import { toHtml } from "@opral/zettel-html";
import { assertDocument, type Document } from "@opral/zettel-ast";
import { formatCheckpointRelativeTime } from "@/lib/checkpoint-format";
import { CommentAvatar } from "./comment-avatar";
import { withoutImages } from "./comment-document";
import "./comments.css";

export type ThreadComment = {
	readonly id: string;
	readonly body: unknown;
	readonly lixcol_created_at: string | null;
	readonly author_name: string | null;
};

/** Threads longer than this fold their middle (design 4a, "Long, folded"). */
export const COMMENT_FOLD_THRESHOLD = 4;

/** Same author within this window reads as one comment with one header. */
const GROUP_WINDOW_MS = 5 * 60_000;

export function authorName(comment: ThreadComment): string {
	return comment.author_name?.trim() || "Contributor";
}

/** A short, uninterrupted run by one author shares the first header. */
export function sharesCommentHeader(
	previous: ThreadComment | undefined,
	comment: ThreadComment,
): boolean {
	if (!previous || authorName(previous) !== authorName(comment)) return false;
	if (!previous.author_name) return false;
	if (!previous.lixcol_created_at || !comment.lixcol_created_at) return false;
	const elapsed =
		Date.parse(comment.lixcol_created_at) -
		Date.parse(previous.lixcol_created_at);
	return elapsed >= 0 && elapsed <= GROUP_WINDOW_MS;
}

/**
 * Which comments stay on screen: all of them up to the threshold; past it
 * the first (it sets the context) and the latest two, with the middle
 * folded into one row. Never the latest hidden (GitHub's complaint).
 */
export function foldComments<T>(
	comments: readonly T[],
	expanded: boolean,
): {
	readonly head: readonly T[];
	readonly hidden: readonly T[];
	readonly tail: readonly T[];
} {
	if (expanded || comments.length <= COMMENT_FOLD_THRESHOLD) {
		return { head: comments, hidden: [], tail: [] };
	}
	return {
		head: comments.slice(0, 1),
		hidden: comments.slice(1, -2),
		tail: comments.slice(-2),
	};
}

/** The compact form the design uses inside a thread: 5m, 2h, 3d. */
export function formatCommentTime(createdAt: string, now = Date.now()): string {
	const time = Date.parse(createdAt);
	if (Number.isNaN(time)) return createdAt;
	const seconds = Math.max(0, Math.floor((now - time) / 1000));
	if (seconds < 60) return "now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
	}).format(new Date(time));
}

export function parseCommentBody(body: unknown): Document {
	const value = typeof body === "string" ? JSON.parse(body) : body;
	assertDocument(value);
	return value;
}

export function renderCommentHtml(body: unknown): string | null {
	try {
		// A comment stored with an image (pasted before the field refused
		// them) shows its alt text, not a remote picture.
		return toHtml(withoutImages(parseCommentBody(body)));
	} catch {
		return null;
	}
}

/**
 * Where a link in a comment may go: the web and mail. A relative or `#`
 * link would navigate the app itself, and anything else is not a place a
 * comment should send a reader. `null` when the link is not followed.
 */
export function commentLinkUrl(anchor: HTMLAnchorElement): string | null {
	const href = anchor.getAttribute("href")?.trim();
	if (!href) return null;
	const protocol = href.match(/^([a-z][a-z\d+.-]*):/i)?.[1]?.toLowerCase();
	return protocol === "http" || protocol === "https" || protocol === "mailto"
		? anchor.href
		: null;
}

function CommentBody({ body }: { readonly body: unknown }) {
	const ref = useRef<HTMLDivElement>(null);
	const html = useMemo(() => renderCommentHtml(body), [body]);
	// A link opens in a new tab, like one in a document, so reading a
	// comment never navigates the app away; a link that may not be followed
	// stays text.
	useLayoutEffect(() => {
		for (const anchor of ref.current?.querySelectorAll("a") ?? []) {
			if (commentLinkUrl(anchor)) {
				anchor.target = "_blank";
				anchor.rel = "noopener noreferrer";
			} else anchor.removeAttribute("href");
		}
	}, [html]);
	if (html === null) {
		return (
			<p className="comment-body-text text-danger">
				This comment could not be displayed.
			</p>
		);
	}
	return (
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Only guards the links inside, which are focusable and activate with Enter as links do.
		<div
			ref={ref}
			className="comment-body"
			onClick={guardLinkClick}
			onAuxClick={guardLinkClick}
			// toHtml escapes text and sanitizes links and raw HTML.
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
}

/** The same rule as the attributes above, for a link the rule missed. */
function guardLinkClick(event: ReactMouseEvent<HTMLDivElement>) {
	const anchor =
		event.target instanceof Element ? event.target.closest("a") : null;
	if (anchor instanceof HTMLAnchorElement && !commentLinkUrl(anchor))
		event.preventDefault();
}

/**
 * "compact": History's checkpoint rows, inset under the checkpoint's glyph.
 * "document": a document's margin card (Turn 7), flush with the card's
 * padding, with 20px avatars and a step larger header.
 * "view": the conversation view's reading column: 24px avatars, 14px body,
 * 20px between comments and the long relative time ("52 minutes ago").
 */
export type CommentThreadSize = "compact" | "document" | "view";

function CommentRow({
	comment,
	grouped,
	size,
}: {
	readonly comment: ThreadComment;
	readonly grouped: boolean;
	readonly size: CommentThreadSize;
}) {
	const name = authorName(comment);
	if (size === "view")
		return <ViewCommentRow comment={comment} grouped={grouped} />;
	const inDocument = size === "document";
	if (grouped) {
		return (
			<li
				data-comment-id={comment.id}
				data-comment-grouped=""
				className={inDocument ? "-mt-1.5 pl-7" : "-mt-2 pl-[48px] pr-2"}
			>
				<CommentBody body={comment.body} />
			</li>
		);
	}
	return (
		<li
			data-comment-id={comment.id}
			className={inDocument ? "flex gap-2" : "flex gap-[7px] pl-[23px] pr-2"}
		>
			<CommentAvatar name={name} size={inDocument ? "lg" : "md"} />
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-1.5 leading-[18px]">
					<span
						className={`truncate font-semibold text-fg ${
							inDocument ? "text-[12.5px]" : "text-[12px]"
						}`}
					>
						{name}
					</span>
					{comment.lixcol_created_at ? (
						<time
							dateTime={comment.lixcol_created_at}
							title={new Date(comment.lixcol_created_at).toLocaleString()}
							className={`comment-secondary shrink-0 ${
								inDocument ? "text-[11.5px]" : "text-[11px]"
							}`}
						>
							{formatCommentTime(comment.lixcol_created_at)}
						</time>
					) : null}
				</div>
				<CommentBody body={comment.body} />
			</div>
		</li>
	);
}

/** The conversation view's row (design "1a"): flat, no box. */
function ViewCommentRow({
	comment,
	grouped,
}: {
	readonly comment: ThreadComment;
	readonly grouped: boolean;
}) {
	if (grouped) {
		return (
			<li
				data-comment-id={comment.id}
				data-comment-grouped=""
				className="-mt-3.5 pl-[34px]"
			>
				<CommentBody body={comment.body} />
			</li>
		);
	}
	const name = authorName(comment);
	return (
		<li data-comment-id={comment.id} className="flex gap-2.5">
			<CommentAvatar name={name} size="2xl" />
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-2 leading-4">
					<span className="truncate text-[13px] font-semibold text-fg">
						{name}
					</span>
					{comment.lixcol_created_at ? (
						<time
							dateTime={comment.lixcol_created_at}
							title={new Date(comment.lixcol_created_at).toLocaleString()}
							className="comment-secondary shrink-0 text-[12px]"
						>
							{formatCheckpointRelativeTime(comment.lixcol_created_at)}
						</time>
					) : null}
				</div>
				<CommentBody body={comment.body} />
			</div>
		</li>
	);
}

/**
 * The conversation view's fold row: a chevron in the avatar column, the
 * hidden authors, and "5 more comments"; once unfolded (when the thread is
 * collapsible) the same row reads "Hide 5 comments" with the chevron turned.
 */
function ViewFoldRow({
	hidden,
	expanded,
	onToggle,
}: {
	readonly hidden: readonly ThreadComment[];
	readonly expanded: boolean;
	readonly onToggle: () => void;
}) {
	const authors = [...new Set(hidden.map(authorName))];
	const noun = hidden.length === 1 ? "comment" : "comments";
	const label = expanded
		? `Hide ${hidden.length} ${noun}`
		: `${hidden.length} more ${noun}`;
	return (
		<li className="-mx-2.5">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={expanded}
				aria-label={
					expanded ? label : `Show ${label} from ${authors.join(", ")}`
				}
				className="comment-fold-view flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-control px-2.5 py-0 text-left text-[13px] font-semibold text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span
					aria-hidden="true"
					className="comment-secondary flex w-6 justify-center"
				>
					<svg
						viewBox="0 0 24 24"
						className={`size-[11px] ${expanded ? "rotate-90" : ""}`}
						fill="none"
						stroke="currentColor"
						strokeWidth={2.4}
					>
						<path d="m9 6 6 6-6 6" />
					</svg>
				</span>
				<span aria-hidden="true" className="flex">
					{authors.slice(0, 3).map((name, index) => (
						<span
							key={name}
							className={`comment-fold-avatar comment-fold-avatar-view flex rounded-full ${index > 0 ? "-ml-1.5" : ""}`}
						>
							<CommentAvatar name={name} size="md" />
						</span>
					))}
				</span>
				{label}
			</button>
		</li>
	);
}

function FoldRow({
	hidden,
	onExpand,
	size,
}: {
	readonly hidden: readonly ThreadComment[];
	readonly onExpand: () => void;
	readonly size: CommentThreadSize;
}) {
	const authors = [...new Set(hidden.map(authorName))];
	const label = `${hidden.length} more ${hidden.length === 1 ? "comment" : "comments"}`;
	return (
		<li className={size === "document" ? undefined : "mr-2 ml-[23px]"}>
			<button
				type="button"
				onClick={onExpand}
				aria-label={`Show ${label} from ${authors.join(", ")}`}
				className="comment-fold flex h-6.5 w-full cursor-pointer items-center gap-2 rounded-[6px] px-[7px] text-left text-[11.5px] font-semibold text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span aria-hidden="true" className="flex">
					{authors.slice(0, 3).map((name, index) => (
						<span
							key={name}
							className={`comment-fold-avatar flex rounded-full ${index > 0 ? "-ml-[5px]" : ""}`}
						>
							<CommentAvatar name={name} size="sm" />
						</span>
					))}
				</span>
				{label}
			</button>
		</li>
	);
}

/**
 * One conversation's comments: one avatar column, every comment aligned to
 * it, 14px between comments, same-author runs under one header. Past four
 * comments the middle folds; unfolding is one click and stays open.
 */
export function CommentThread({
	comments,
	label = "Comments",
	tone = "accent",
	size = "compact",
	className = "",
	expanded: controlledExpanded,
	onExpandedChange,
	collapsible = false,
	foldWithin,
}: {
	readonly comments: readonly ThreadComment[];
	/**
	 * Fold only among the first this-many comments; later ones always show
	 * after the fold. History passes the count when the checkpoint opened,
	 * so what is posted while it is open never folds the thread shut under
	 * the field.
	 */
	readonly foldWithin?: number;
	readonly label?: string;
	/**
	 * Whether a long thread is unfolded. Pass it when the thread can remount
	 * (History rows do) and the reader's unfolding should survive that.
	 */
	readonly expanded?: boolean;
	readonly onExpandedChange?: (expanded: boolean) => void;
	/**
	 * Unfolding leaves a "Hide N comments" row where the fold was, so the
	 * thread folds again (the conversation view, `size="view"` only). By
	 * default unfolding is one-way, as in History.
	 */
	readonly collapsible?: boolean;
	/** Same surfaces as the composer's `tone`. */
	readonly tone?: "accent" | "neutral";
	/** Same densities as the composer's `size`. */
	readonly size?: CommentThreadSize;
	readonly className?: string;
}) {
	const [localExpanded, setLocalExpanded] = useState(false);
	const expanded = controlledExpanded ?? localExpanded;
	const setExpanded = (value: boolean) => {
		setLocalExpanded(value);
		onExpandedChange?.(value);
	};
	const foldable =
		foldWithin === undefined ? comments : comments.slice(0, foldWithin);
	const later = comments.slice(foldable.length);
	const folded = foldComments(foldable, false);
	// Unfolded but collapsible: the first comment, the fold row turned into
	// "Hide N comments", then everything after it.
	const hideRow =
		collapsible && size === "view" && expanded && folded.hidden.length > 0;
	const shown = foldComments(foldable, expanded);
	const { head, hidden, tail } = hideRow
		? {
				head: comments.slice(0, 1),
				hidden: folded.hidden,
				tail: comments.slice(1),
			}
		: shown.hidden.length > 0
			? { ...shown, tail: [...shown.tail, ...later] }
			: { head: comments, hidden: [], tail: [] };
	const rows = (list: readonly ThreadComment[], offset: number) =>
		list.map((comment, index) => (
			<CommentRow
				key={comment.id}
				comment={comment}
				size={size}
				grouped={
					// The first comment after the fold row starts a new header.
					!(offset > 0 && index === 0 && hidden.length > 0) &&
					sharesCommentHeader(comments[offset + index - 1], comment)
				}
			/>
		));
	if (comments.length === 0) return null;
	return (
		<ol
			aria-label={label}
			data-tone={tone}
			data-size={size}
			className={`comment-surface flex flex-col ${
				size === "view"
					? "gap-5"
					: size === "document"
						? "gap-2.5"
						: "gap-3.5 pt-0.5"
			} ${className}`}
		>
			{rows(head, 0)}
			{hidden.length > 0 && size === "view" ? (
				<ViewFoldRow
					hidden={hidden}
					expanded={hideRow}
					onToggle={() => setExpanded(!hideRow)}
				/>
			) : hidden.length > 0 ? (
				<FoldRow
					hidden={hidden}
					size={size}
					onExpand={() => setExpanded(true)}
				/>
			) : null}
			{rows(tail, comments.length - tail.length)}
		</ol>
	);
}
