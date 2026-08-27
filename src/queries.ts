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

/** One changed file from lix_diff('lix_file'). */
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

export type CheckpointRow = {
	commit_id: string;
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
 * The working file diff defaults to latest checkpoint → active branch head.
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
 * Point-in-time file state: lix_state_at returns the complete tracked file
 * rows as of one commit, with the live relation's columns. An entity absent
 * at that commit contributes no row, and pk `=` / `IN` predicates bound the
 * historical read to the requested entities.
 */
export function selectFilesStateAt(lix: Lix, commitId: string) {
	return qb(lix).selectFrom(
		sql<any>`lix_state_at('lix_file', ${commitId})`.as("lix_state_at"),
	);
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

export function selectCheckpoints(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_checkpoint")
		.select(["commit_id", "lixcol_created_at as created_at"])
		.orderBy("created_at", "desc")
		.$castTo<CheckpointRow>();
}

/** First parent of a commit — position 0 of its ordered parent list. */
export function selectCommitParent(lix: Lix, commitId: string) {
	return qb(lix)
		.selectFrom("lix_commit")
		.select(sql<string | null>`parent_commit_ids ->> 0`.as("parent_id"))
		.where("id", "=", commitId)
		.limit(1)
		.$castTo<{ parent_id: string | null }>();
}

export function selectLatestCheckpoint(lix: Lix) {
	return selectCheckpoints(lix).limit(1);
}
