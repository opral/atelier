import { useQueryTakeFirst } from "@/lib/lix-react";
import { selectFileHistory } from "@/lib/lix-file-history";

export type HistoricalFileSnapshot = {
	readonly id: string;
	readonly path: string;
	readonly content: unknown;
};

type HistoricalFileSnapshotRow = {
	readonly id: string;
	readonly path: string | null;
	readonly content: unknown | null;
};

/**
 * Loads the shallowest visible file revision on each side of a historical
 * comparison. Historical snapshots are immutable, so neither query keeps a
 * live observer open.
 */
export function useFileSnapshotsAtCommits(
	fileId: string,
	beforeCommitId: string | null,
	afterCommitId: string | null,
	beforeFileId: string | null = null,
	afterFileId: string | null = null,
	beforeExists = true,
	afterExists = true,
): {
	readonly beforeSnapshot: HistoricalFileSnapshot | undefined;
	readonly afterSnapshot: HistoricalFileSnapshot | undefined;
} {
	const beforeId = beforeFileId ?? fileId;
	const afterId = afterFileId ?? fileId;
	const beforeRow = useQueryTakeFirst<HistoricalFileSnapshotRow>(
		(lix) =>
			selectFileHistory(lix, beforeCommitId ?? "")
				.select(["id", "path", "content", "lixcol_depth"])
				.where("id", "=", beforeId)
				.orderBy("lixcol_depth", "asc")
				.limit(1),
		{
			subscribe: false,
			enabled: fileId.length > 0 && beforeCommitId !== null && beforeExists,
		},
	);
	const afterRow = useQueryTakeFirst<HistoricalFileSnapshotRow>(
		(lix) =>
			selectFileHistory(lix, afterCommitId ?? "")
				.select(["id", "path", "content", "lixcol_depth"])
				.where("id", "=", afterId)
				.orderBy("lixcol_depth", "asc")
				.limit(1),
		{
			subscribe: false,
			enabled: fileId.length > 0 && afterCommitId !== null && afterExists,
		},
	);

	return {
		beforeSnapshot: beforeRow ? visibleSnapshot(beforeRow) : undefined,
		afterSnapshot: afterRow ? visibleSnapshot(afterRow) : undefined,
	};
}

function visibleSnapshot(
	row: HistoricalFileSnapshotRow,
): HistoricalFileSnapshot | undefined {
	if (typeof row.path !== "string" || row.content === null) {
		return undefined;
	}
	return { id: row.id, path: row.path, content: row.content };
}
