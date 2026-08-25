import { qb } from "@/lib/lix-kysely";
import { useQueryTakeFirst } from "@/lib/lix-react";
import { formatCheckpointCreatedAt } from "@/lib/checkpoint-format";

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
	const checkpoint = useQueryTakeFirst<{ created_at: string }>(
		(lix) =>
			qb(lix)
				.selectFrom("lix_checkpoint")
				.select(["lixcol_created_at as created_at"])
				.where("commit_id", "=", commitId ?? "")
				.limit(1),
		{ subscribe: false },
	);
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
				className="mb-2 text-[var(--color-text-tertiary)]"
				aria-hidden="true"
			>
				<path
					d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
					strokeDasharray="3 3"
				/>
			</svg>
			<div className="text-sm font-medium text-[var(--color-text-primary)]">
				{fileName ? `${fileName} doesn’t exist yet` : "Doesn’t exist yet"}
			</div>
			<div className="max-w-95 text-[13px] leading-snug text-[var(--color-text-secondary)]">
				{checkpoint
					? `at the checkpoint from ${formatCheckpointCreatedAt(checkpoint.created_at)}.`
					: "at the point in history you’re viewing."}
			</div>
		</div>
	);
}
