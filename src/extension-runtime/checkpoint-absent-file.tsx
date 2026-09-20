import { useQueryResult } from "@/lib/lix-react";
import { formatCheckpointCreatedAt } from "@/lib/checkpoint-format";
import { selectCommitCreatedAt } from "@/queries";

/**
 * The empty state for a tab whose file has no version at the point in history
 * a diff session is viewing. The absence is temporal, not an error: the file
 * simply does not exist yet at that checkpoint, so the copy says when, not
 * whether.
 */
export function CheckpointAbsentFile({
	filePath,
	commitId,
}: {
	readonly filePath: string | null | undefined;
	/** The commit the view is pinned to; names the checkpoint when it is one. */
	readonly commitId: string | null;
}) {
	// The date is a detail that may arrive late. A read that suspends here
	// would reach the view's own boundary and hide the whole comparison, the
	// present side included, until one row came back.
	const checkpointResult = useQueryResult<{ created_at: string }>(
		(lix) => selectCommitCreatedAt(lix, commitId ?? ""),
		{ subscribe: false },
	);
	const checkpoint =
		checkpointResult.status === "success"
			? checkpointResult.rows[0]
			: undefined;
	const fileName = filePath?.split("/").filter(Boolean).at(-1);
	return (
		<div
			className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center"
			data-attr="checkpoint-absent-file"
		>
			<svg
				width="34"
				height="34"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="mb-2 text-fg-subtle"
				aria-hidden="true"
			>
				<path
					d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
					strokeDasharray="3 3"
				/>
			</svg>
			<div className="text-sm font-medium text-fg">
				{fileName
					? `${fileName} did not exist at this point in time`
					: "This file did not exist at this point in time"}
			</div>
			{checkpoint ? (
				<div className="max-w-95 text-[13px] leading-snug text-fg-muted">
					{`Checkpoint from ${formatCheckpointCreatedAt(checkpoint.created_at)}.`}
				</div>
			) : null}
		</div>
	);
}
