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
		`INSERT INTO lix_file (id, path, content)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (id) DO UPDATE SET content = excluded.content`,
		[id, path, encoder.encode(data)],
	);
}

async function readFile(lix: Awaited<ReturnType<typeof openLix>>, id: string) {
	const result = await lix.execute(
		"SELECT content FROM lix_file WHERE id = $1",
		[id],
	);
	const data = result.rows[0]?.get("content");
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

			const checkpoint = await createCheckpointForFiles(lix, [firstId]);
			expect(checkpoint?.diffCount).toBeGreaterThan(0);
			expect(checkpoint?.commitId).toEqual(expect.any(String));
			expect(await selectFileWorkingChanges(lix).execute()).toEqual([
				expect.objectContaining({ id: secondId }),
			]);
		} finally {
			await lix.close();
		}
	});

	test("sweeps the selected file's new directories into the checkpoint", async () => {
		const lix = await openLix();
		try {
			const insideId = fakeUuid("dir-sweep-inside");
			const outsideId = fakeUuid("dir-sweep-outside");
			await writeFile(lix, insideId, "/docs/handbook/inside.md", "inside");
			await writeFile(lix, outsideId, "/notes/outside.md", "outside");

			const checkpoint = await createCheckpointForFiles(lix, [insideId]);
			expect(checkpoint?.commitId).toEqual(expect.any(String));

			// /docs and /docs/handbook were committed with their file; /notes
			// still has a changed file, so its descriptor stays working.
			const remainingDirs = await lix.execute(
				`SELECT row_pk ->> 0 AS dir_id FROM lix_working_diff()
				 WHERE schema_key = 'lix_directory_descriptor'`,
			);
			const remainingDirPaths = await Promise.all(
				remainingDirs.rows.map(async (row) => {
					const result = await lix.execute(
						"SELECT path FROM lix_directory WHERE id = $1",
						[row.get("dir_id")],
					);
					return result.rows[0]?.get("path");
				}),
			);
			expect(remainingDirPaths.sort()).toEqual(["/notes"]);

			// Checkpointing the remaining file clears the working diff entirely.
			await createCheckpointForFiles(lix, [outsideId]);
			const finalDiff = await lix.execute(
				"SELECT count(*) AS n FROM lix_working_diff()",
			);
			expect(Number(finalDiff.rows[0]?.get("n"))).toBe(0);
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
