import { describe, expect, test } from "vitest";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { openLix } from "@/test-utils/node-lix-sdk";
import { selectWorkingFileDiffs } from "@/queries";
import {
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

			const checkpoint = await createCheckpointForFiles(lix, [insideId]);
			expect(checkpoint?.commitId).toEqual(expect.any(String));

			// /docs and /docs/handbook were committed with their file by the
			// engine's dependency closure; /notes still has a changed file, so
			// its descriptor stays working.
			const remainingDirs = await lix.execute(
				`SELECT coalesce(to_path, from_path) AS path
				 FROM lix_diff('lix_directory', lix_latest_checkpoint_commit_id(), lix_active_branch_commit_id())`,
			);
			const remainingDirPaths = remainingDirs.rows
				.map((row) => row.get("path"))
				.sort();
			expect(remainingDirPaths).toEqual(["/notes"]);

			// Checkpointing the remaining file clears the working file diff.
			await createCheckpointForFiles(lix, [outsideId]);
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

	test("a full restore also removes files created after the checkpoint", async () => {
		const lix = await openLix();
		try {
			const keptId = fakeUuid("full-restore-kept");
			const laterId = fakeUuid("full-restore-later");
			await writeFile(lix, keptId, "/kept.md", "checkpoint data");
			const checkpoint = await lix.createCheckpoint();
			await writeFile(lix, keptId, "/kept.md", "current data");
			await writeFile(lix, laterId, "/later.md", "added afterwards");
			await lix.createCheckpoint();

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
