import type { Lix } from "@lix-js/sdk";

type DiffCommand = "lix_apply" | "lix_create_checkpoint" | "lix_revert";

function fileIdPredicate(fileIds: readonly string[], firstParameter: number) {
	const parameters = fileIds
		.map((_, index) => `$${firstParameter + index}`)
		.join(", ");
	return `coalesce(
		file_id,
		case
			when schema_key = 'lix_file_descriptor'
			then row_pk ->> 0
		end
	) in (${parameters})`;
}

async function executeSelectedDiffs(
	lix: Lix,
	command: DiffCommand,
	fromAndWhere: string,
	parameters: readonly string[],
): Promise<number> {
	const countResult = await lix.execute(
		`SELECT count(*) AS diff_count ${fromAndWhere}`,
		[...parameters],
	);
	const diffCount = Number(countResult.rows[0]?.get("diff_count") ?? 0);
	if (diffCount === 0) return 0;

	await lix.execute(
		`INSERT INTO ${command} (diff_id)
		 SELECT diff_id ${fromAndWhere}`,
		[...parameters],
	);
	return diffCount;
}

function workingDiffSelection(fileIds: readonly string[]) {
	return `FROM lix_working_diff()
		WHERE ${fileIdPredicate(fileIds, 1)}`;
}

export async function createCheckpointForFiles(
	lix: Lix,
	fileIds: readonly string[],
): Promise<{ readonly commitId: string; readonly diffCount: number } | null> {
	if (fileIds.length === 0) return null;
	// Directories ride along: a folder created for a selected file (or one
	// holding no changed files at all, which no later file checkpoint would
	// ever sweep) is part of this checkpoint. Without this, partial
	// checkpoints strand lix_directory_descriptor rows in the working diff.
	const directoryIds = await selectCheckpointDirectoryIds(lix, fileIds);
	const directoryPredicate = directoryIds.length
		? ` OR (schema_key = 'lix_directory_descriptor' AND row_pk ->> 0 IN (${directoryIds
				.map((_, index) => `$${fileIds.length + 1 + index}`)
				.join(", ")}))`
		: "";
	const result = await lix.execute(
		`INSERT INTO lix_create_checkpoint (diff_id)
		 SELECT diff_id FROM lix_working_diff()
		 WHERE ${fileIdPredicate(fileIds, 1)}${directoryPredicate}
		 RETURNING commit_id`,
		[...fileIds, ...directoryIds],
	);
	if (result.rowsAffected === 0) return null;
	const returnedCommitIds = result.rows
		.map((row) => row.get("commit_id"))
		.filter(isString);
	const commitIds = new Set(returnedCommitIds);
	if (commitIds.size !== 1 || returnedCommitIds.length !== result.rows.length) {
		throw new Error("Partial checkpoint did not return one commit ID.");
	}
	return {
		commitId: [...commitIds][0]!,
		diffCount: result.rowsAffected,
	};
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

/**
 * Changed directories this checkpoint should include: ancestors of the
 * selected files, plus changed directories containing no changed file at
 * all (nothing else would ever sweep those).
 */
async function selectCheckpointDirectoryIds(
	lix: Lix,
	fileIds: readonly string[],
): Promise<string[]> {
	const changedDirRows = await lix.execute(
		`SELECT DISTINCT row_pk ->> 0 AS dir_id FROM lix_working_diff()
		 WHERE schema_key = 'lix_directory_descriptor'`,
	);
	const changedDirIds = changedDirRows.rows
		.map((row) => row.get("dir_id"))
		.filter(isString);
	if (changedDirIds.length === 0) return [];

	const [directories, selectedFiles, changedFiles] = await Promise.all([
		lix.execute(`SELECT id, path FROM lix_directory`),
		lix.execute(
			`SELECT path FROM lix_file WHERE id IN (${fileIds
				.map((_, index) => `$${index + 1}`)
				.join(", ")})`,
			[...fileIds],
		),
		lix.execute(
			`SELECT f.path AS path FROM lix_file f WHERE f.id IN (
				SELECT DISTINCT coalesce(
					file_id,
					case when schema_key = 'lix_file_descriptor' then row_pk ->> 0 end
				) FROM lix_working_diff()
			)`,
		),
	]);
	const directoryPaths = new Map<string, string>();
	for (const row of directories.rows) {
		const id = row.get("id");
		const path = row.get("path");
		if (isString(id) && isString(path)) directoryPaths.set(id, path);
	}
	const selectedPaths = selectedFiles.rows
		.map((row) => row.get("path"))
		.filter(isString);
	const changedPaths = changedFiles.rows
		.map((row) => row.get("path"))
		.filter(isString);

	const isAncestorOf = (directoryPath: string, filePath: string) =>
		filePath.startsWith(
			directoryPath === "/" ? "/" : `${directoryPath}/`,
		);
	return changedDirIds.filter((dirId) => {
		const directoryPath = directoryPaths.get(dirId);
		// A deleted directory has no live path; leave its rows for a full sweep.
		if (directoryPath === undefined) return false;
		if (selectedPaths.some((path) => isAncestorOf(directoryPath, path))) {
			return true;
		}
		return !changedPaths.some((path) => isAncestorOf(directoryPath, path));
	});
}

export async function revertWorkingChangesForFiles(
	lix: Lix,
	fileIds: readonly string[],
): Promise<number> {
	if (fileIds.length === 0) return 0;
	return executeSelectedDiffs(
		lix,
		"lix_revert",
		workingDiffSelection(fileIds),
		fileIds,
	);
}

export async function restoreCheckpointFiles(
	lix: Lix,
	checkpointCommitId: string,
	fileIds: readonly string[],
): Promise<number> {
	if (fileIds.length === 0) return 0;
	const headResult = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	const headCommitId = headResult.rows[0]?.get("commit_id");
	if (typeof headCommitId !== "string") {
		throw new Error("The active Lix branch has no head commit.");
	}
	if (headCommitId === checkpointCommitId) return 0;

	return executeSelectedDiffs(
		lix,
		"lix_apply",
		`FROM lix_diff($1, $2)
		 WHERE ${fileIdPredicate(fileIds, 3)}`,
		[headCommitId, checkpointCommitId, ...fileIds],
	);
}
