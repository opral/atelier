/*
 * Resolve and Reopen: the ✓ beside "Open conversation", a resolved
 * conversation folded to one line, and the conversation page's chip.
 */

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
 * With `labelled`, a small button that says it (the conversation page,
 * under its reply box).
 */
export function ResolveButton({
	onResolve,
	className = "",
	labelled = false,
}: {
	readonly onResolve: () => void;
	readonly className?: string;
	readonly labelled?: boolean;
}) {
	if (labelled)
		return (
			<button
				type="button"
				data-attr="resolve-conversation"
				onClick={onResolve}
				className={`inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-control px-2.5 text-[12.5px] font-semibold text-fg-muted ring-1 ring-border-strong ring-inset hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
			>
				<CheckIcon />
				Resolve conversation
			</button>
		);
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
