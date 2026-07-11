import { useQuery } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";

export type HistoricalFileSnapshot = {
	readonly id: string;
	readonly path: string;
	readonly data: unknown;
};

type HistoricalFileSnapshotRow = {
	readonly id: string;
	readonly path: string | null;
	readonly data: unknown | null;
	readonly commit_id: string;
};

/**
 * Loads both sides of a historical file comparison in one Suspense-backed
 * query. Historical snapshots are immutable, so this query intentionally does
 * not keep a live observer open.
 */
export function useFileSnapshotsAtCommits(
	fileId: string,
	beforeCommitId: string | null,
	afterCommitId: string | null,
): {
	readonly beforeSnapshot: HistoricalFileSnapshot | undefined;
	readonly afterSnapshot: HistoricalFileSnapshot | undefined;
} {
	const commitIds = [beforeCommitId, afterCommitId].filter(
		(commitId): commitId is string => Boolean(commitId),
	);
	const rows = useQuery<HistoricalFileSnapshotRow>(
		(lix) => {
			let query = qb(lix)
				.selectFrom("lix_file_history")
				.select(["id", "path", "data", "lixcol_start_commit_id as commit_id"])
				.where("id", "=", fileId);
			query = commitIds.length
				? query.where("lixcol_start_commit_id", "in", commitIds)
				: query.where("lixcol_start_commit_id", "=", "");
			return query
				.orderBy("lixcol_start_commit_id", "asc")
				.orderBy("lixcol_depth", "asc");
		},
		{
			subscribe: false,
			enabled: fileId.length > 0 && commitIds.length > 0,
		},
	);

	const snapshots = new Map<string, HistoricalFileSnapshot | undefined>();
	for (const row of rows) {
		// The first (shallowest) row is the visible state at this commit. Keep an
		// explicit undefined entry for deletions instead of falling through to an
		// older, deeper row.
		if (!snapshots.has(row.commit_id)) {
			snapshots.set(row.commit_id, visibleSnapshot(row));
		}
	}

	return {
		beforeSnapshot: beforeCommitId ? snapshots.get(beforeCommitId) : undefined,
		afterSnapshot: afterCommitId ? snapshots.get(afterCommitId) : undefined,
	};
}

function visibleSnapshot(
	row: HistoricalFileSnapshotRow,
): HistoricalFileSnapshot | undefined {
	if (typeof row.path !== "string" || row.data === null) {
		return undefined;
	}
	return { id: row.id, path: row.path, data: row.data };
}
