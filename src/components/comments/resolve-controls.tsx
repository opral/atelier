/*
 * Resolve and Reopen: the ✓ beside "Open conversation", a resolved
 * conversation folded to one line, and the conversation page's chip.
 */

function CheckIcon({
	className = "atw:size-3.5",
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
				className={`atw:inline-flex atw:h-7 atw:shrink-0 atw:cursor-pointer atw:items-center atw:gap-1.5 atw:rounded-control atw:px-2.5 atw:text-[12.5px] atw:font-semibold atw:text-fg-muted atw:ring-1 atw:ring-border-strong atw:ring-inset atw:hover:bg-bg-hover atw:hover:text-fg atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring ${className}`}
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
			className={`atw:inline-flex atw:size-6 atw:shrink-0 atw:cursor-pointer atw:items-center atw:justify-center atw:rounded-control atw:text-history-secondary atw:hover:bg-bg-hover atw:hover:text-fg atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring ${className}`}
		>
			<CheckIcon />
		</button>
	);
}

/** The conversation page's state under its title: "✓ Resolved", "Reopen". */
export function ResolvedChip({ onReopen }: { readonly onReopen?: () => void }) {
	return (
		<p
			data-attr="resolved-conversation"
			className="atw:flex atw:items-center atw:gap-2 atw:text-[13px] atw:leading-5"
		>
			<span className="atw:inline-flex atw:h-6 atw:items-center atw:gap-1 atw:rounded-full atw:bg-success-subtle atw:px-2 atw:text-[12px] atw:font-semibold atw:text-success">
				<CheckIcon className="atw:size-3" />
				Resolved
			</span>
			{onReopen ? (
				<button
					type="button"
					data-attr="reopen-conversation"
					onClick={onReopen}
					className="atw:cursor-pointer atw:font-semibold atw:text-accent-hover atw:hover:underline atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:rounded-[4px]"
				>
					Reopen
				</button>
			) : null}
		</p>
	);
}
