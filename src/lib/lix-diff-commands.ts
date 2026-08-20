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
): Promise<number> {
	if (fileIds.length === 0) return 0;
	return executeSelectedDiffs(
		lix,
		"lix_create_checkpoint",
		workingDiffSelection(fileIds),
		fileIds,
	);
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
