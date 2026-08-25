import type { Lix } from "@lix-js/sdk";
import { qb, sql } from "@/lib/lix-kysely";

export type FileHistorySnapshotRequest = {
	readonly fileId: string;
	readonly commitId: string;
};

export type FileHistorySnapshotRow = {
	readonly id: string;
	readonly path: string | null;
	readonly content?: unknown;
	readonly commitId: string;
	readonly depth: number;
};

const HISTORY_QUERY_MAX_PARAMETERS = 900;

/**
 * Resolves exact file snapshots in bounded history arms. Every arm keeps the
 * depth ordering and LIMIT adjacent to lix_history so Lix can stop traversal
 * at the first matching version, while UNION batches avoid per-file round trips.
 */
export async function selectFileHistorySnapshotsAtCommits(
	lix: Lix,
	requests: readonly FileHistorySnapshotRequest[],
	options: { readonly includeContent: boolean },
): Promise<FileHistorySnapshotRow[]> {
	const snapshots: FileHistorySnapshotRow[] = [];
	for (
		let start = 0;
		start < requests.length;
		start += HISTORY_QUERY_MAX_PARAMETERS / 3
	) {
		const batch = requests.slice(
			start,
			start + HISTORY_QUERY_MAX_PARAMETERS / 3,
		);
		const contentProjection = options.includeContent
			? sql`, file_history.content`
			: sql``;
		const statement = sql.join(
			batch.map(
				({ fileId, commitId }) => sql`
					SELECT
						file_history.id,
						file_history.path,
						${commitId} AS commit_id,
						file_history.lixcol_depth AS depth
						${contentProjection}
					FROM (
						SELECT id, path, lixcol_depth
							${options.includeContent ? sql`, content` : sql``}
						FROM lix_history('lix_file', ${commitId})
						WHERE id = ${fileId}
						ORDER BY lixcol_depth ASC
						LIMIT 1
					) AS file_history
				`,
			),
			sql` UNION ALL `,
		);
		const result = await statement.execute(qb(lix));
		for (const row of result.rows as Array<{
			readonly id: string;
			readonly path: string | null;
			readonly content?: unknown;
			readonly commit_id: string;
			readonly depth: number;
		}>) {
			snapshots.push({
				id: row.id,
				path: row.path,
				...(options.includeContent ? { content: row.content } : {}),
				commitId: row.commit_id,
				depth: row.depth,
			});
		}
	}
	return snapshots;
}
