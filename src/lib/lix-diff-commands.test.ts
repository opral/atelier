import { describe, expect, test } from "vitest";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { openLix } from "@/test-utils/node-lix-sdk";
import { selectFileWorkingChanges } from "@/queries";
import {
	createCheckpointForFiles,
	restoreCheckpointFiles,
	revertWorkingChangesForFiles,
} from "./lix-diff-commands";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function writeFile(
	lix: Awaited<ReturnType<typeof openLix>>,
	id: string,
	path: string,
	data: string,
) {
	await lix.execute(
		`INSERT INTO lix_file (id, path, data)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
		[id, path, encoder.encode(data)],
	);
}

async function readFile(lix: Awaited<ReturnType<typeof openLix>>, id: string) {
	const result = await lix.execute("SELECT data FROM lix_file WHERE id = $1", [
		id,
	]);
	const data = result.rows[0]?.get("data");
	return data instanceof Uint8Array ? decoder.decode(data) : null;
}

describe("Lix SQL diff commands", () => {
	test("creates a checkpoint for only the selected file", async () => {
		const lix = await openLix();
		try {
			const firstId = fakeUuid("partial-checkpoint-first");
			const secondId = fakeUuid("partial-checkpoint-second");
			await writeFile(lix, firstId, "/first.md", "first");
			await writeFile(lix, secondId, "/second.md", "second");

			expect(await createCheckpointForFiles(lix, [firstId])).toBeGreaterThan(0);
			expect(await selectFileWorkingChanges(lix).execute()).toEqual([
				expect.objectContaining({ id: secondId }),
			]);
		} finally {
			await lix.close();
		}
	});

	test("reverts only the selected working file", async () => {
		const lix = await openLix();
		try {
			const firstId = fakeUuid("revert-first");
			const secondId = fakeUuid("revert-second");
			await writeFile(lix, firstId, "/first.md", "before first");
			await writeFile(lix, secondId, "/second.md", "before second");
			await lix.createCheckpoint();
			await writeFile(lix, firstId, "/first.md", "after first");
			await writeFile(lix, secondId, "/second.md", "after second");

			expect(
				await revertWorkingChangesForFiles(lix, [firstId]),
			).toBeGreaterThan(0);
			expect(await readFile(lix, firstId)).toBe("before first");
			expect(await readFile(lix, secondId)).toBe("after second");
		} finally {
			await lix.close();
		}
	});

	test("restores a selected file from a historical checkpoint", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("restore-checkpoint");
			await writeFile(lix, fileId, "/restore.md", "checkpoint data");
			const checkpoint = await lix.createCheckpoint();
			await writeFile(lix, fileId, "/restore.md", "current data");

			expect(
				await restoreCheckpointFiles(lix, checkpoint.commitId, [fileId]),
			).toBeGreaterThan(0);
			expect(await readFile(lix, fileId)).toBe("checkpoint data");
		} finally {
			await lix.close();
		}
	});
});
