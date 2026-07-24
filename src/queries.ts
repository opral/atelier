import type { JsonValue, Lix } from "@lix-js/sdk";
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
	entity_pk: JsonValue;
	schema_key: string;
	file_id: string | null;
	change_kind: "added" | "modified" | "removed";
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
	change_kind: "added" | "modified" | "removed";
};

export type CheckpointRow = {
	commit_id: string;
	created_at: string;
	lixcol_depth: number;
};

export type CheckpointWithFileCountRow = CheckpointRow & {
	file_count: number;
};

/**
 * Unified filesystem listing containing both directories and files ordered by path.
 *
 * Each row represents either a directory (with `kind === "directory"`) or a file
 * (`kind === "file"`) and is shaped to make tree construction straightforward on
 * the client.
 */
export function selectFilesystemEntries(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_directory")
		.select((eb) => [
			eb.ref("lix_directory.id").as("id"),
			eb.ref("lix_directory.parent_id").as("parent_id"),
			eb.ref("lix_directory.path").as("path"),
			eb.ref("lix_directory.name").as("display_name"),
			sql<string>`'directory'`.as("kind"),
			sql<string>`'lix'`.as("source"),
		])
		.unionAll(
			qb(lix)
				.selectFrom("lix_file")
				.select((eb) => [
					eb.ref("lix_file.id").as("id"),
					eb.ref("lix_file.directory_id").as("parent_id"),
					eb.ref("lix_file.path").as("path"),
					eb.ref("lix_file.name").as("display_name"),
					sql<string>`'file'`.as("kind"),
					sql<string>`'lix'`.as("source"),
				]),
		)
		.orderBy("path", "asc")
		.$castTo<FilesystemEntryRow>();
}

/**
 * Net tracked changes between the latest checkpoint and the active branch head.
 */
export function selectWorkingChanges(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_working_change")
		.select([
			"entity_pk",
			"schema_key",
			"file_id",
			"change_kind",
			"before_change_id",
			"after_change_id",
		])
		.orderBy("schema_key", "asc")
		.orderBy("entity_pk", "asc")
		.$castTo<WorkingChangeRow>();
}

export function selectWorkingChangeCount(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_working_change")
		.select((eb) => eb.fn.countAll<number>().as("change_count"))
		.$castTo<WorkingChangeCountRow>();
}

/**
 * Net logical files changed between the latest checkpoint and active head.
 * Directory moves are expanded to their descendant files.
 */
export function selectFileWorkingChanges(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_file_working_change")
		.select(["id", "path", "previous_path", "change_kind"])
		.orderBy("path", "asc")
		.$castTo<FileWorkingChangeRow>();
}

/**
 * Checkpoints reachable from the active branch, newest first.
 */
export function selectCheckpoints(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_checkpoint")
		.select(["commit_id", "created_at", "lixcol_depth"])
		.orderBy("lixcol_depth", "asc")
		.$castTo<CheckpointRow>();
}

export function selectLatestCheckpoint(lix: Lix) {
	return selectCheckpoints(lix).limit(1);
}

/**
 * Files represented by the net changes stored in one checkpoint commit.
 */
export function selectCheckpointsWithFileCounts(lix: Lix) {
	return qb(lix)
		.selectFrom("lix_checkpoint")
		.leftJoin(
			"lix_file_history",
			"lix_file_history.lixcol_observed_commit_id",
			"lix_checkpoint.commit_id",
		)
		.select([
			"lix_checkpoint.commit_id",
			"lix_checkpoint.created_at",
			"lix_checkpoint.lixcol_depth",
			sql<number>`count(distinct lix_file_history.id)`.as("file_count"),
		])
		.groupBy([
			"lix_checkpoint.commit_id",
			"lix_checkpoint.created_at",
			"lix_checkpoint.lixcol_depth",
		])
		.orderBy("lix_checkpoint.lixcol_depth", "asc")
		.$castTo<CheckpointWithFileCountRow>();
}
