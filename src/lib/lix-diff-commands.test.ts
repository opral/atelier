import { describe, expect, test } from "vitest";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	selectWorkingFileDiffs,
	selectWorkingFileDiffSnapshot,
} from "@/queries";
import {
	createCheckpoint,
	createCheckpointForFiles,
	restoreCheckpoint,
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

async function workingFileDiffs(lix: Awaited<ReturnType<typeof openLix>>) {
	return selectWorkingFileDiffs(lix).execute();
}

async function workingEpoch(lix: Awaited<ReturnType<typeof openLix>>) {
	const snapshot = await selectWorkingFileDiffSnapshot(lix);
	if (snapshot.files.length === 0) {
		throw new Error("test expected a working diff epoch");
	}
	return {
		beforeCommitId: snapshot.beforeCommitId,
		afterCommitId: snapshot.afterCommitId,
	};
}

async function readFile(lix: Awaited<ReturnType<typeof openLix>>, id: string) {
	const result = await lix.execute(
		"SELECT content FROM lix_file WHERE id = $1",
		[id],
	);
	const data = result.rows[0]?.content;
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

			const checkpoint = await createCheckpointForFiles(
				lix,
				[firstId],
				await workingEpoch(lix),
			);
			expect(checkpoint?.commitId).toEqual(expect.any(String));
			expect(await workingFileDiffs(lix)).toEqual([
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

			const checkpoint = await createCheckpointForFiles(
				lix,
				[insideId],
				await workingEpoch(lix),
			);
			expect(checkpoint?.commitId).toEqual(expect.any(String));

			// /docs and /docs/handbook were committed with their file by the
			// engine's dependency closure; /notes still has a changed file, so
			// its descriptor stays working.
			const remainingDirs = await lix.execute(
				`SELECT coalesce(to_path, from_path) AS path
				 FROM lix_diff('lix_directory')`,
			);
			const remainingDirPaths = remainingDirs.rows
				.map((row) => row.path)
				.sort();
			expect(remainingDirPaths).toEqual(["/notes"]);

			// Checkpointing the remaining file clears the working file diff.
			await createCheckpointForFiles(lix, [outsideId], await workingEpoch(lix));
			expect(await workingFileDiffs(lix)).toEqual([]);
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
			await createCheckpoint(lix);
			await writeFile(lix, firstId, "/first.md", "after first");
			await writeFile(lix, secondId, "/second.md", "after second");

			expect(
				await revertWorkingChangesForFiles(
					lix,
					[firstId],
					await workingEpoch(lix),
				),
			).toBeGreaterThan(0);
			expect(await readFile(lix, firstId)).toBe("before first");
			expect(await readFile(lix, secondId)).toBe("after second");
		} finally {
			await lix.close();
		}
	});

	test("rejects a partial checkpoint after the reviewed working epoch changes", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("stale-partial-checkpoint");
			await writeFile(lix, fileId, "/stale-checkpoint.md", "reviewed");
			const reviewedEpoch = await workingEpoch(lix);
			await writeFile(lix, fileId, "/stale-checkpoint.md", "newer");

			await expect(
				createCheckpointForFiles(lix, [fileId], reviewedEpoch),
			).rejects.toThrow();
			expect(await readFile(lix, fileId)).toBe("newer");
			expect(await workingFileDiffs(lix)).toEqual([
				expect.objectContaining({ id: fileId }),
			]);
		} finally {
			await lix.close();
		}
	});

	test("rejects a revert after the reviewed working epoch changes", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("stale-revert");
			await writeFile(lix, fileId, "/stale-revert.md", "before");
			await createCheckpoint(lix);
			await writeFile(lix, fileId, "/stale-revert.md", "reviewed");
			const reviewedEpoch = await workingEpoch(lix);
			await writeFile(lix, fileId, "/stale-revert.md", "newer");

			await expect(
				revertWorkingChangesForFiles(lix, [fileId], reviewedEpoch),
			).rejects.toThrow("working diff changed");
			expect(await readFile(lix, fileId)).toBe("newer");
		} finally {
			await lix.close();
		}
	});

	test("restores a selected file from a historical checkpoint", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("restore-checkpoint");
			await writeFile(lix, fileId, "/restore.md", "checkpoint data");
			const checkpoint = await createCheckpoint(lix);
			await writeFile(lix, fileId, "/restore.md", "current data");

			expect(
				await restoreCheckpointFiles(lix, checkpoint.commitId, [fileId]),
			).toBeGreaterThan(0);
			expect(await readFile(lix, fileId)).toBe("checkpoint data");
		} finally {
			await lix.close();
		}
	});

	test("a full restore also removes files created after the checkpoint", async () => {
		const lix = await openLix();
		try {
			const keptId = fakeUuid("full-restore-kept");
			const laterId = fakeUuid("full-restore-later");
			await writeFile(lix, keptId, "/kept.md", "checkpoint data");
			const checkpoint = await createCheckpoint(lix);
			await writeFile(lix, keptId, "/kept.md", "current data");
			await writeFile(lix, laterId, "/later.md", "added afterwards");
			await createCheckpoint(lix);

			await restoreCheckpoint(lix, checkpoint.commitId);

			expect(await readFile(lix, keptId)).toBe("checkpoint data");
			// The later-added file cannot appear in the span's file list, so
			// only the exact restore can delete it.
			expect(await readFile(lix, laterId)).toBeNull();
		} finally {
			await lix.close();
		}
	});
});
