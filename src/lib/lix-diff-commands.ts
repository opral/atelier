import type { Lix } from "@lix-js/sdk";

/**
 * Diff commands use lix_row_ref as their selection currency. Selecting a file
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
	const beforeCommitId = result.rows[0]?.before_commit_id;
	const headCommitId = result.rows[0]?.head_commit_id;
	if (typeof beforeCommitId !== "string" || typeof headCommitId !== "string") {
		throw new Error("The active Lix branch has no resolvable diff range.");
	}
	return { beforeCommitId, headCommitId };
}

function fileRowRefs(fileIds: readonly string[], firstParameter: number) {
	return fileIds
		.map((_, index) => `lix_row_ref('lix_file', $${firstParameter + index})`)
		.join(", ");
}

/** Creates a full checkpoint through the canonical SQL surface. */
export async function createCheckpoint(
	lix: Lix,
): Promise<{ readonly commitId: string }> {
	const result = await lix.execute(
		"SELECT commit_id FROM lix_create_checkpoint()",
	);
	const commitId = result.rows[0]?.commit_id;
	if (result.rows.length !== 1 || !isString(commitId)) {
		throw new Error("Checkpoint creation did not return one commit ID.");
	}
	return { commitId };
}

export async function createCheckpointForFiles(
	lix: Lix,
	fileIds: readonly string[],
): Promise<{ readonly commitId: string } | null> {
	if (fileIds.length === 0) return null;
	const result = await lix.execute(
		`SELECT commit_id
		 FROM lix_create_checkpoint(ARRAY[${fileRowRefs(fileIds, 1)}])`,
		[...fileIds],
	);
	if (result.rows.length === 0) return null;
	const commitId = result.rows[0]?.commit_id;
	if (result.rows.length !== 1 || !isString(commitId)) {
		throw new Error("Partial checkpoint did not return one commit ID.");
	}
	return { commitId };
}

export async function revertWorkingChangesForFiles(
	lix: Lix,
	fileIds: readonly string[],
): Promise<number> {
	if (fileIds.length === 0) return 0;
	const { beforeCommitId, headCommitId } = await workingRange(lix);
	const result = await lix.execute(
		`INSERT INTO lix_revert (row_ref)
		 SELECT row_ref
		 FROM lix_diff('lix_file', $1, $2)
		 WHERE row_ref IN (${fileRowRefs(fileIds, 3)})`,
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
	const headCommitId = headResult.rows[0]?.commit_id;
	if (typeof headCommitId !== "string") {
		throw new Error("The active Lix branch has no head commit.");
	}
	if (headCommitId === checkpointCommitId) return 0;

	// Applying the head→checkpoint diff for the selected files restores their
	// checkpoint state without touching anything else.
	const result = await lix.execute(
		`INSERT INTO lix_apply (row_ref)
		 SELECT row_ref
		 FROM lix_diff('lix_file', $1, $2)
		 WHERE row_ref IN (${fileRowRefs(fileIds, 3)})`,
		[headCommitId, checkpointCommitId, ...fileIds],
	);
	return result.rowsAffected;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}
