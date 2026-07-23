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

export type CheckpointRow = {
	commit_id: string;
	created_at: string;
	lixcol_depth: number;
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
