import type { JsonValue, Lix } from "@lix-js/sdk";
import { selectFileHistory } from "@/lib/lix-file-history";
import { qb, sql } from "@/lib/lix-kysely";

export type FilesystemEntryRow = {
	id: string;
	parent_id: string | null;
	path: string;
	display_name: string;
	kind: "directory" | "file";
	source?: "lix" | "watched";
};

export type WorkingChangeRow = {
	diff_id: string;
	row_pk: JsonValue;
	schema_key: string;
	file_id: string | null;
	diff_type: "added" | "modified" | "removed";
	before_change_id: string | null;
	after_change_id: string | null;
};

export type WorkingChangeCountRow = {
	change_count: number;
};

export type FileWorkingChangeRow = {
	id: string;
	path: string | null;
	previous_path: string | null;
	diff_type: "added" | "modified" | "removed";
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
 * Net tracked changes between the latest checkpoint and the active branch head.
 */
export function selectWorkingChanges(lix: Lix) {
	return qb(lix)
		.selectFrom(sql<any>`lix_working_diff()`.as("lix_working_diff"))
		.select([
			"diff_id",
			"row_pk",
			"schema_key",
			"file_id",
			"diff_type",
			"before_change_id",
			"after_change_id",
		])
		.orderBy("schema_key", "asc")
		.orderBy("row_pk", "asc")
		.$castTo<WorkingChangeRow>();
}

export function selectWorkingChangeCount(lix: Lix) {
	return qb(lix)
		.selectFrom(sql<any>`lix_working_diff()`.as("lix_working_diff"))
		.select((eb) => eb.fn.countAll<number>().as("change_count"))
		.$castTo<WorkingChangeCountRow>();
}

/**
 * Net logical files changed between the latest checkpoint and active head.
 *
 * Derived from the heterogeneous `lix_working_diff()` envelope. Files removed
 * since the checkpoint are not reported; no consumer acts on removed files
 * today.
 */
export function selectFileWorkingChanges(lix: Lix) {
	return qb(lix)
		.selectFrom(sql<any>`lix_working_diff()`.as("lix_working_diff"))
		.innerJoin("lix_file", (join) =>
			join.on(
				sql`lix_file.id = coalesce(lix_working_diff.file_id, case when lix_working_diff.schema_key = 'lix_file_descriptor' then lix_working_diff.row_pk ->> 0 end)`,
			),
		)
		.select([
			"lix_file.id",
			"lix_file.path",
			sql<string | null>`null`.as("previous_path"),
			// File descriptor rows carry the file id in row_pk, not file_id.
			sql<string>`case when max(case when lix_working_diff.schema_key = 'lix_file_descriptor' and lix_working_diff.diff_type = 'added' then 1 else 0 end) = 1 then 'added' else 'modified' end`.as(
				"diff_type",
			),
		])
		.groupBy(["lix_file.id", "lix_file.path"])
		.orderBy("lix_file.path", "asc")
		.$castTo<FileWorkingChangeRow>();
}

/**
 * Working files that can be reviewed, including files deleted after the
 * latest checkpoint. Deleted files are reconstructed from that checkpoint
 * because they no longer have a row in the current `lix_file` view.
 */
export async function selectReviewableFileWorkingChanges(
	lix: Lix,
): Promise<FileWorkingChangeRow[]> {
	const [currentFiles, workingChanges, latestCheckpoint] = await Promise.all([
		selectFileWorkingChanges(lix).execute(),
		selectWorkingChanges(lix).execute(),
		selectLatestCheckpoint(lix).executeTakeFirst(),
	]);
	if (!latestCheckpoint) return currentFiles;

	const currentIds = new Set(currentFiles.map((file) => file.id));
	const removedIds = new Set<string>();
	for (const change of workingChanges) {
		if (change.diff_type !== "removed") continue;
		const descriptorFileId =
			change.schema_key === "lix_file_descriptor" &&
			Array.isArray(change.row_pk) &&
			typeof change.row_pk[0] === "string"
				? change.row_pk[0]
				: null;
		const fileId = change.file_id ?? descriptorFileId;
		if (fileId && !currentIds.has(fileId)) removedIds.add(fileId);
	}
	if (removedIds.size === 0) return currentFiles;

	const historicalRows = await selectFileHistory(
		lix,
		latestCheckpoint.commit_id,
	)
		.select(["id", "path", "lixcol_depth"])
		.where("id", "in", [...removedIds])
		.orderBy("lixcol_depth", "asc")
		.execute();
	const removedFiles: FileWorkingChangeRow[] = [];
	const resolvedIds = new Set<string>();
	for (const row of historicalRows) {
		if (resolvedIds.has(row.id)) continue;
		resolvedIds.add(row.id);
		if (typeof row.path !== "string") continue;
		removedFiles.push({
			id: row.id,
			path: row.path,
			previous_path: row.path,
			diff_type: "removed",
		});
	}

	return [...currentFiles, ...removedFiles].sort((left, right) =>
		(left.path ?? "").localeCompare(right.path ?? ""),
	);
}

/**
 * Checkpoints reachable from the active branch, newest first.
 */
export function selectCheckpoints(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_checkpoint")
		.select(["commit_id", "lixcol_created_at as created_at"])
		.orderBy("created_at", "desc")
		.$castTo<CheckpointRow>();
}

export function selectLatestCheckpoint(lix: Lix) {
	return selectCheckpoints(lix).limit(1);
}
