import type { Lix } from "@lix-js/sdk";
import { qb, sql } from "@/lib/lix-kysely";

export type FilesystemEntryRow = {
	id: string;
	parent_id: string | null;
	path: string;
	display_name: string;
	kind: "directory" | "file";
	source?: "lix" | "watched";
};

export type WorkingChangeCountRow = {
	/** Changed atoms across the file tier (sum of per-file row_count). */
	change_count: number;
	/** Changed logical files. */
	file_count: number;
};

/** One changed file from the certified HOT working diff. */
export type FileDiffRow = {
	/** The file relation's typed primary key, projected by lix_diff. */
	id: string;
	diff_type: "added" | "modified" | "removed";
	/** Resolved for the side that has one: to for added/modified, from for removed. */
	path: string;
	row_count: number;
	/** Side paths: a modified row whose sides differ is a move/rename. */
	from_path: string | null;
	to_path: string | null;
};

export type WorkingFileDiffContentRow = {
	from_content: unknown | null;
	from_metadata?: unknown;
	to_metadata?: unknown;
	to_content: unknown | null;
};

export type CheckpointRow = {
	commit_id: string;
	parent_commit_id: string | null;
	created_at: string;
};

/**
 * Unified filesystem listing containing both directories and files ordered by path.
 *
 * Each row represents either a directory (with `kind === "directory"`) or a file
 * (`kind === "file"`) and is shaped to make tree construction straightforward on
 * the client.
 */
export function selectFilesystemEntries(lix: Lix) {
	return selectFilesystemDirectories(lix)
		.unionAll(selectFilesystemFiles(lix))
		.orderBy("path", "asc")
		.$castTo<FilesystemEntryRow>();
}

/** Directory half of the filesystem listing, kept observable without a UNION. */
export function selectFilesystemDirectories(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_directory")
		.select((eb) => [
			eb.ref("lix_directory.id").as("id"),
			eb.ref("lix_directory.parent_id").as("parent_id"),
			sql<string>`case
				when lix_directory.path = '/' then '/'
				else lix_directory.path || '/'
			end`.as("path"),
			eb.ref("lix_directory.name").as("display_name"),
			sql<string>`'directory'`.as("kind"),
			sql<string>`'lix'`.as("source"),
		])
		.$castTo<FilesystemEntryRow>();
}

/** File half of the filesystem listing, kept observable without a UNION. */
export function selectFilesystemFiles(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_file")
		.select((eb) => [
			eb.ref("lix_file.id").as("id"),
			eb.ref("lix_file.directory_id").as("parent_id"),
			eb.ref("lix_file.path").as("path"),
			eb.ref("lix_file.name").as("display_name"),
			sql<string>`'file'`.as("kind"),
			sql<string>`'lix'`.as("source"),
		])
		.$castTo<FilesystemEntryRow>();
}

/**
 * The working file diff defaults to working baseline → active branch head.
 * One row per changed file, path resolved for the side that has one — removed
 * files keep their pre-deletion path from the base side.
 */
export function selectWorkingFileDiffs(lix: Lix) {
	return qb(lix)
		.selectFrom(workingFileDiffTable().as("lix_diff"))
		.select([
			"id",
			"diff_type",
			sql<string>`coalesce(to_path, from_path)`.as("path"),
			"row_count",
			"from_path",
			"to_path",
		])
		.orderBy(sql`coalesce(to_path, from_path)`, "asc")
		.$castTo<FileDiffRow>();
}

/** The working diff row for one file, or none when it is unchanged. */
export function selectWorkingFileDiff(lix: Lix, fileId: string) {
	return selectWorkingFileDiffs(lix).where("id", "=", fileId);
}

/** Net changes introduced by each retained checkpoint on the active mainline. */
export type FileCheckpointChangeRow = {
	commit_id: string;
	parent_commit_id: string;
	commit_created_at: string;
	change_kind: "added" | "modified" | "removed";
	path: string | null;
};

export function selectFileCheckpointChanges(lix: Lix, fileId: string) {
	return qb(lix)
		.selectFrom(sql<any>`lix_history('lix_file')`.as("history"))
		.select([
			sql<string>`lixcol_to_commit_id`.as("commit_id"),
			sql<string>`lixcol_from_commit_id`.as("parent_commit_id"),
			sql<string>`lixcol_commit_created_at`.as("commit_created_at"),
			sql<FileCheckpointChangeRow["change_kind"]>`diff_type`.as("change_kind"),
			sql<string | null>`coalesce(to_path, from_path)`.as("path"),
		])
		.where("id", "=", fileId)
		.where(sql<boolean>`lixcol_commit_is_checkpoint`, "=", true)
		.orderBy(sql`lixcol_position`, "asc")
		.$castTo<FileCheckpointChangeRow>();
}

export function selectWorkingChangeCount(lix: Lix) {
	return qb(lix)
		.selectFrom(workingFileDiffTable().as("lix_diff"))
		.select((eb) => [
			sql<number>`coalesce(sum(row_count), 0)`.as("change_count"),
			eb.fn.countAll<number>().as("file_count"),
		])
		.$castTo<WorkingChangeCountRow>();
}

function workingFileDiffTable() {
	return sql<any>`lix_diff('lix_file')`;
}

/**
 * Opens one coherent working-review epoch without adding a review-specific SQL
 * surface. executeBatch pins both statements to the same repository snapshot:
 * the first resolves the epoch and the second reads the certified HOT index.
 */
export async function selectWorkingFileDiffSnapshot(lix: Lix): Promise<{
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly files: readonly FileDiffRow[];
}> {
	const results = await lix.executeBatch([
		{
			sql: `SELECT working_base_commit_id AS before_commit_id,
			             commit_id AS after_commit_id
			      FROM lix_branch WHERE id = lix_active_branch_id()`,
		},
		{
			sql: `SELECT id, diff_type,
			             coalesce(to_path, from_path) AS path,
			             row_count, from_path, to_path
			      FROM lix_diff('lix_file')
			      ORDER BY coalesce(to_path, from_path) ASC`,
		},
	]);
	const epoch = results[0]?.rows[0];
	if (
		typeof epoch?.before_commit_id !== "string" ||
		typeof epoch?.after_commit_id !== "string"
	) {
		throw new Error("The active Lix branch has no working-review epoch.");
	}
	return {
		beforeCommitId: epoch.before_commit_id,
		afterCommitId: epoch.after_commit_id,
		files: (results[1]?.rows ?? []) as FileDiffRow[],
	};
}

/** Lazily loads one selected file's immutable bytes from the review epoch. */
export async function selectWorkingFileDiffContent(
	lix: Lix,
	fileId: string,
	beforeCommitId: string,
	afterCommitId: string,
): Promise<WorkingFileDiffContentRow> {
	const results = await lix.executeBatch([
		{
			sql: "SELECT content, lixcol_metadata FROM lix_as_of('lix_file', $1) WHERE id = $2",
			params: [beforeCommitId, fileId],
		},
		{
			sql: "SELECT content, lixcol_metadata FROM lix_as_of('lix_file', $1) WHERE id = $2",
			params: [afterCommitId, fileId],
		},
	]);
	return {
		from_metadata: results[0]?.rows[0]?.lixcol_metadata,
		to_metadata: results[1]?.rows[0]?.lixcol_metadata,
		from_content: results[0]?.rows[0]?.content ?? null,
		to_content: results[1]?.rows[0]?.content ?? null,
	};
}

/**
 * Point-in-time file state: lix_as_of returns the complete tracked file
 * rows as of one commit, with the live relation's columns. An entity absent
 * at that commit contributes no row, and pk `=` / `IN` predicates bound the
 * historical read to the requested entities.
 */
export function selectFilesStateAt(lix: Lix, commitId: string) {
	return qb(lix).selectFrom(
		sql<any>`lix_as_of('lix_file', ${commitId})`.as("lix_as_of"),
	);
}

export const CHECKPOINT_PREVIEW_PAGE_SIZE = 20;
export type CheckpointFilePreviewRow = {
	commit_id: string;
	id: string;
	path: string;
};

/** One pinned, bounded history read for a visible page of checkpoint names. */
export function selectCheckpointFilePreviewPage(
	lix: Lix,
	commitIds: readonly string[],
) {
	if (
		commitIds.length === 0 ||
		commitIds.length > CHECKPOINT_PREVIEW_PAGE_SIZE
	) {
		throw new Error("A checkpoint preview page must contain 1–20 commit IDs.");
	}
	return qb(lix)
		.selectFrom(
			sql<any>`lix_history('lix_file', ${commitIds[0]})`.as("history"),
		)
		.select([
			sql<string>`lixcol_to_commit_id`.as("commit_id"),
			"id",
			sql<string>`coalesce(to_path, from_path)`.as("path"),
		])
		.where(sql<string>`lixcol_to_commit_id`, "in", [...commitIds])
		.orderBy("path", "asc")
		.$castTo<CheckpointFilePreviewRow>();
}

/**
 * Resolves the path each file had at its requested commit — rename-aware, and
 * absent files simply have no entry. Requests are grouped per commit so a
 * whole tab set resolves in one bounded read per distinct commit.
 */
export async function selectFilePathsAtCommits(
	lix: Lix,
	requests: readonly { readonly fileId: string; readonly commitId: string }[],
): Promise<Map<string, string>> {
	const byCommit = new Map<string, string[]>();
	for (const { fileId, commitId } of requests) {
		const ids = byCommit.get(commitId) ?? [];
		ids.push(fileId);
		byCommit.set(commitId, ids);
	}
	const paths = new Map<string, string>();
	for (const [commitId, fileIds] of byCommit) {
		const rows = (await selectFilesStateAt(lix, commitId)
			.select(["id", "path"])
			.where("id", "in", fileIds)
			.execute()) as ReadonlyArray<{ id: string; path: string | null }>;
		for (const row of rows) {
			if (typeof row.path === "string") paths.set(row.id, row.path);
		}
	}
	return paths;
}

/** Checkpoints on the active branch, ordered by ancestry rather than time. */
export function selectCheckpoints(lix: Lix) {
	return qb(lix)
		.selectFrom(sql<any>`lix_log()`.as("log"))
		.select(["commit_id", "parent_commit_id", "created_at"])
		.where("is_checkpoint", "=", true)
		.orderBy("position", "asc")
		.$castTo<CheckpointRow>();
}

export function selectLatestCheckpoint(lix: Lix) {
	return selectCheckpoints(lix).limit(1);
}
