import type { Lix } from "@lix-js/sdk";

/**
 * Diff commands over the relation-scoped selection currency: every command
 * consumes (relation, row_pk) rows selected from lix_diff. Selecting a file
 * selects its underlying tracked content, and the engine computes the
 * dependency closure (ancestor directory descriptors ride along with partial
 * checkpoints).
 */

/** The working span: latest checkpoint (or the empty root) to the head. */
async function workingRange(
	lix: Lix,
): Promise<{ beforeCommitId: string; headCommitId: string }> {
	const result = await lix.execute(
		`SELECT lix_latest_checkpoint_commit_id() AS before_commit_id,
		        lix_active_branch_commit_id() AS head_commit_id`,
	);
	const beforeCommitId = result.rows[0]?.get("before_commit_id");
	const headCommitId = result.rows[0]?.get("head_commit_id");
	if (typeof beforeCommitId !== "string" || typeof headCommitId !== "string") {
		throw new Error("The active Lix branch has no resolvable diff range.");
	}
	return { beforeCommitId, headCommitId };
}

function fileIdParameters(fileIds: readonly string[], firstParameter: number) {
	return fileIds.map((_, index) => `$${firstParameter + index}`).join(", ");
}

export async function createCheckpointForFiles(
	lix: Lix,
	fileIds: readonly string[],
): Promise<{ readonly commitId: string; readonly diffCount: number } | null> {
	if (fileIds.length === 0) return null;
	const { beforeCommitId, headCommitId } = await workingRange(lix);
	const result = await lix.execute(
		`INSERT INTO lix_create_checkpoint (relation, row_pk)
		 SELECT 'lix_file', row_pk
		 FROM lix_diff('lix_file', $1, $2)
		 WHERE row_pk ->> 0 IN (${fileIdParameters(fileIds, 3)})
		 RETURNING commit_id`,
		[beforeCommitId, headCommitId, ...fileIds],
	);
	if (result.rowsAffected === 0) return null;
	// A command that creates a commit returns exactly one row; rowsAffected
	// still reports the number of selected identities.
	const commitId = result.rows[0]?.get("commit_id");
	if (result.rows.length !== 1 || !isString(commitId)) {
		throw new Error("Partial checkpoint did not return one commit ID.");
	}
	return {
		commitId,
		diffCount: result.rowsAffected,
	};
}

export async function revertWorkingChangesForFiles(
	lix: Lix,
	fileIds: readonly string[],
): Promise<number> {
	if (fileIds.length === 0) return 0;
	const { beforeCommitId, headCommitId } = await workingRange(lix);
	const result = await lix.execute(
		`INSERT INTO lix_revert (relation, row_pk)
		 SELECT 'lix_file', row_pk
		 FROM lix_diff('lix_file', $1, $2)
		 WHERE row_pk ->> 0 IN (${fileIdParameters(fileIds, 3)})`,
		[beforeCommitId, headCommitId, ...fileIds],
	);
	return result.rowsAffected;
}

/**
 * Restores the exact repository state of a checkpoint — including deleting
 * files created after it, which a file-scoped selection over the reviewed
 * span can never see.
 */
export async function restoreCheckpoint(
	lix: Lix,
	checkpointCommitId: string,
): Promise<void> {
	await lix.execute("INSERT INTO lix_restore (commit_id) VALUES ($1)", [
		checkpointCommitId,
	]);
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

	// Applying the head→checkpoint diff for the selected files restores their
	// checkpoint state without touching anything else.
	const result = await lix.execute(
		`INSERT INTO lix_apply (relation, row_pk)
		 SELECT 'lix_file', row_pk
		 FROM lix_diff('lix_file', $1, $2)
		 WHERE row_pk ->> 0 IN (${fileIdParameters(fileIds, 3)})`,
		[headCommitId, checkpointCommitId, ...fileIds],
	);
	return result.rowsAffected;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}
