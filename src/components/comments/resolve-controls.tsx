import { useEffect, useState } from "react";
import { useLix } from "@/lib/lix-react";
import { conversationsResolvable } from "@/lib/conversation-writes";

/*
 * Resolve and Reopen, shown only where the Lix can store it
 * (`useConversationsResolvable`): on a Lix without the `resolved` column
 * none of this renders, and every surface looks and counts as before.
 */

/** `conversationsResolvable` for a component: false until it is known. */
export function useConversationsResolvable(): boolean {
	const lix = useLix();
	const [resolvable, setResolvable] = useState(false);
	useEffect(() => {
		let current = true;
		void conversationsResolvable(lix).then((value) => {
			if (current) setResolvable(value);
		});
		return () => {
			current = false;
		};
	}, [lix]);
	return resolvable;
}

function CheckIcon({
	className = "size-3.5",
}: {
	readonly className?: string;
}) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M20 6 9 17l-5-5" />
		</svg>
	);
}

/**
 * "Resolve": a ✓ beside "Open conversation", drawn as it is (24px, the
 * secondary colour), and revealed the same way by the surface's classes.
 */
export function ResolveButton({
	onResolve,
	className = "",
}: {
	readonly onResolve: () => void;
	readonly className?: string;
}) {
	return (
		<button
			type="button"
			aria-label="Resolve conversation"
			title="Resolve"
			data-attr="resolve-conversation"
			onClick={(event) => {
				event.stopPropagation();
				onResolve();
			}}
			className={`inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-control text-history-secondary hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
		>
			<CheckIcon />
		</button>
	);
}

/**
 * A resolved conversation folded to one line where it was (History's open
 * checkpoint), so it is not lost: "✓ Resolved · 3 comments · Reopen".
 */
export function ResolvedLine({
	commentCount,
	onReopen,
	className = "",
}: {
	readonly commentCount: number;
	/** Absent where nothing may be written (read-only). */
	readonly onReopen?: () => void;
	readonly className?: string;
}) {
	return (
		<p
			data-attr="resolved-conversation"
			className={`comment-secondary flex items-center gap-1 text-[11.5px] leading-4 font-semibold ${className}`}
		>
			<CheckIcon className="size-3" />
			Resolved
			{commentCount > 0
				? ` · ${commentCount} ${commentCount === 1 ? "comment" : "comments"}`
				: null}
			{onReopen ? (
				<>
					<span aria-hidden="true">·</span>
					<button
						type="button"
						data-attr="reopen-conversation"
						onClick={onReopen}
						className="cursor-pointer rounded-[4px] text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						Reopen
					</button>
				</>
			) : null}
		</p>
	);
}

/** The conversation page's state under its title: "✓ Resolved", "Reopen". */
export function ResolvedChip({ onReopen }: { readonly onReopen?: () => void }) {
	return (
		<p
			data-attr="resolved-conversation"
			className="flex items-center gap-2 text-[13px] leading-5"
		>
			<span className="inline-flex h-6 items-center gap-1 rounded-full bg-success-subtle px-2 text-[12px] font-semibold text-success">
				<CheckIcon className="size-3" />
				Resolved
			</span>
			{onReopen ? (
				<button
					type="button"
					data-attr="reopen-conversation"
					onClick={onReopen}
					className="cursor-pointer font-semibold text-accent-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-[4px]"
				>
					Reopen
				</button>
			) : null}
		</p>
	);
}
