import { describe, test, expect } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { qb } from "@/lib/lix-kysely";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import {
	selectCheckpoints,
	selectCheckpointFilePreviewPage,
	selectFilesystemEntries,
	selectFileCheckpointChanges,
	selectLatestCheckpoint,
	selectWorkingChangeCount,
	selectWorkingFileDiffContent,
	selectWorkingFileDiffSnapshot,
	selectWorkingFileDiffs,
} from "@/queries";

function isUserPath(path: string): boolean {
	return !path.startsWith("/.lix/");
}

describe("selectFilesystemEntries", () => {
	test("returns directories and files with hierarchy metadata", async () => {
		const lix = await openLix();

		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs" } as any)
			.execute();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/guides" } as any)
			.execute();

		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: fakeUuid("f_root"),
					path: "/README.md",
					content: new Uint8Array(),
				},
				{
					id: fakeUuid("f_nested"),
					path: "/docs/guides/intro.md",
					content: new Uint8Array(),
				},
			])
			.execute();

		const rows = await selectFilesystemEntries(lix).execute();
		const userRows = rows.filter((row) => isUserPath(row.path));
		expect(userRows.map((row) => row.kind)).toEqual([
			"file",
			"directory",
			"directory",
			"file",
		]);
		expect(userRows.map((row) => row.path)).toEqual([
			"/README.md",
			"/docs/",
			"/docs/guides/",
			"/docs/guides/intro.md",
		]);

		const docsRow = userRows.find((row) => row.path === "/docs/");
		expect(docsRow?.parent_id).toBeNull();
		expect(docsRow?.display_name).toBe("docs");

		const guidesRow = userRows.find((row) => row.path === "/docs/guides/");
		expect(guidesRow?.parent_id).toBe(docsRow?.id);
		expect(guidesRow?.display_name).toBe("guides");

		const nestedFile = userRows.find(
			(row) => row.path === "/docs/guides/intro.md",
		);
		expect(nestedFile?.parent_id).toBe(guidesRow?.id);
		expect(nestedFile?.display_name).toBe("intro.md");
		expect(nestedFile).not.toHaveProperty("hidden");
	});

	test("distinguishes root files from nested files", async () => {
		const lix = await openLix();

		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs" } as any)
			.execute();

		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: fakeUuid("root_file"),
					path: "/root.md",
					content: new Uint8Array(),
				},
				{
					id: fakeUuid("nested_file"),
					path: "/docs/deep.md",
					content: new Uint8Array(),
				},
			])
			.execute();

		const rows = await selectFilesystemEntries(lix).execute();
		const rootRow = rows.find((row) => row.id === fakeUuid("root_file"));
		expect(rootRow?.parent_id).toBeNull();
		const docsRow = rows.find((row) => row.path === "/docs/");
		const nestedRow = rows.find((row) => row.id === fakeUuid("nested_file"));
		expect(docsRow).toBeDefined();
		expect(nestedRow?.parent_id).toBe(docsRow?.id);
	});
});

describe("checkpoint queries", () => {
	test("uses a dirty fork's actual baseline for review and checkpoint history", async () => {
		const lix = await openLix();
		try {
			const id = fakeUuid("dirty-fork-history");
			await lix.execute(
				"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
				[id, "/draft.md", new TextEncoder().encode("inherited")],
			);
			const head = await lix.execute(
				"SELECT lix_active_branch_commit_id() AS id",
			);
			const inheritedCommit = head.rows[0]!.id as string;
			const draft = await lix.createBranch({
				name: "Draft",
				fromCommitId: inheritedCommit,
			});
			await lix.switchBranch({ branchId: draft.id });
			const empty = await selectWorkingFileDiffSnapshot(lix);
			expect(empty.beforeCommitId).toBe(inheritedCommit);
			expect(empty.files).toEqual([]);
			await lix.execute("UPDATE lix_file SET content = $1 WHERE id = $2", [
				new TextEncoder().encode("reviewed"),
				id,
			]);
			const review = await selectWorkingFileDiffSnapshot(lix);
			expect(review.beforeCommitId).toBe(inheritedCommit);
			const contents = await selectWorkingFileDiffContent(
				lix,
				id,
				review.beforeCommitId,
				review.afterCommitId,
			);
			expect(
				new TextDecoder().decode(contents.from_content as Uint8Array),
			).toBe("inherited");
			const checkpoint = await createCheckpoint(lix);
			const changes = await selectFileCheckpointChanges(lix, id).execute();
			expect(changes).toEqual([
				expect.objectContaining({
					commit_id: checkpoint.commitId,
					parent_commit_id: inheritedCommit,
					change_kind: "modified",
				}),
			]);
			const checkpoints = await selectCheckpoints(lix).execute();
			expect(checkpoints[0]).toMatchObject({
				commit_id: checkpoint.commitId,
				parent_commit_id: inheritedCommit,
			});
		} finally {
			await lix.close();
		}
	});

	test("excludes other branches and keeps empty checkpoint entries", async () => {
		const lix = await openLix();
		try {
			const mainId = await lix.activeBranchId();
			const mainCheckpoint = await createCheckpoint(lix);
			const draft = await lix.createBranch({ name: "Other" });
			await lix.switchBranch({ branchId: draft.id });
			const otherCheckpoint = await createCheckpoint(lix);
			await lix.switchBranch({ branchId: mainId });
			const checkpoints = await selectCheckpoints(lix).execute();
			expect(checkpoints.map((row) => row.commit_id)).toContain(
				mainCheckpoint.commitId,
			);
			expect(checkpoints.map((row) => row.commit_id)).not.toContain(
				otherCheckpoint.commitId,
			);
			expect(
				await selectCheckpointFilePreviewPage(lix, [
					mainCheckpoint.commitId,
				]).execute(),
			).toEqual([]);
		} finally {
			await lix.close();
		}
	});

	test("returns net working changes and newest-first checkpoints", async () => {
		const lix = await openLix();

		expect(await selectCheckpoints(lix).execute()).toEqual([]);
		await createCheckpoint(lix);
		const initialCheckpoints = await selectCheckpoints(lix).execute();
		expect(initialCheckpoints).toHaveLength(1);

		await lix.execute(
			"INSERT INTO lix_key_value (key, value) VALUES ($1, $2)",
			["checkpoint-query-test", "one"],
		);
		await lix.execute("UPDATE lix_key_value SET value = $1 WHERE key = $2", [
			"two",
			"checkpoint-query-test",
		]);

		// Metadata-only changes do not count: the file-tier diff sees only
		// file changes, never the workspace's own key-value writes.
		expect(await selectWorkingChangeCount(lix).execute()).toEqual([
			{ change_count: 0, file_count: 0 },
		]);

		const checkpoint = await createCheckpoint(lix);

		expect(await selectWorkingChangeCount(lix).execute()).toEqual([
			{ change_count: 0, file_count: 0 },
		]);
		const checkpoints = await selectCheckpoints(lix).execute();
		expect(checkpoints).toHaveLength(2);
		expect(checkpoints[0]).toEqual(
			expect.objectContaining({
				commit_id: checkpoint.commitId,
			}),
		);
		expect(checkpoints[1]?.commit_id).toBe(initialCheckpoints[0]?.commit_id);
		expect(await selectLatestCheckpoint(lix).execute()).toEqual([
			checkpoints[0],
		]);

		await lix.close();
	});

	test("returns composed working files and clears them at a checkpoint", async () => {
		const lix = await openLix();

		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
			[
				fakeUuid("review-file"),
				"/drafts/review.md",
				new TextEncoder().encode("draft"),
			],
		);
		const snapshot = await selectWorkingFileDiffSnapshot(lix);
		const workingFiles = snapshot.files;
		expect(workingFiles).toEqual([
			expect.objectContaining({
				id: fakeUuid("review-file"),
				path: "/drafts/review.md",
				diff_type: "added",
			}),
		]);
		expect(snapshot.beforeCommitId).not.toBe(snapshot.afterCommitId);
		const workingFile = workingFiles[0]!;
		const content = await selectWorkingFileDiffContent(
			lix,
			workingFile.id,
			snapshot.beforeCommitId,
			snapshot.afterCommitId,
		);
		expect(content.from_content).toBeNull();
		expect(new TextDecoder().decode(content.to_content as Uint8Array)).toBe(
			"draft",
		);
		// The file's descriptor and content rows count; the workspace's own
		// key-value write does not.
		expect(await selectWorkingChangeCount(lix).execute()).toEqual([
			{ change_count: 2, file_count: 1 },
		]);

		await createCheckpoint(lix);
		expect(await selectWorkingFileDiffs(lix).execute()).toEqual([]);

		await lix.close();
	});

	test("returns files removed since the latest checkpoint", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("removed-review-file");

		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/drafts/removed.md",
				content: new TextEncoder().encode("remove me"),
			})
			.execute();
		await createCheckpoint(lix);
		await qb(lix).deleteFrom("lix_file").where("id", "=", fileId).execute();

		// Removed files keep their pre-deletion path from the diff's base side.
		expect(await selectWorkingFileDiffs(lix).execute()).toEqual([
			expect.objectContaining({
				id: fileId,
				path: "/drafts/removed.md",
				diff_type: "removed",
			}),
		]);

		await lix.close();
	});
});

describe("selectCheckpointFilePreviewPage", () => {
	test("lists changed files with checkpoint paths for renamed and deleted files", async () => {
		const lix = await openLix();
		const ids = ["preview-rename", "preview-delete", "preview-unchanged"].map(
			fakeUuid,
		);
		for (const [index, path] of [
			"/before.md",
			"/removed.csv",
			"/unchanged.txt",
		].entries()) {
			await lix.execute(
				"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
				[ids[index], path, new TextEncoder().encode("before")],
			);
		}
		const base = await createCheckpoint(lix);
		await lix.execute("UPDATE lix_file SET path = $1 WHERE id = $2", [
			"/renamed.md",
			ids[0],
		]);
		await lix.execute("DELETE FROM lix_file WHERE id = $1", [ids[1]]);
		const target = await createCheckpoint(lix);
		await lix.execute("UPDATE lix_file SET path = $1 WHERE id = $2", [
			"/renamed-again.md",
			ids[0],
		]);
		expect(
			await selectCheckpointFilePreviewPage(lix, [target.commitId]).execute(),
		).toEqual([
			{ commit_id: target.commitId, id: ids[1], path: "/removed.csv" },
			{ commit_id: target.commitId, id: ids[0], path: "/renamed.md" },
		]);
		expect(
			await selectCheckpointFilePreviewPage(lix, [base.commitId]).execute(),
		).toEqual([
			{ commit_id: base.commitId, id: ids[0], path: "/before.md" },
			{ commit_id: base.commitId, id: ids[1], path: "/removed.csv" },
			{ commit_id: base.commitId, id: ids[2], path: "/unchanged.txt" },
		]);
		const page = await selectCheckpointFilePreviewPage(lix, [
			target.commitId,
			base.commitId,
		]).execute();
		expect(page).toHaveLength(5);
		expect(page.filter((row) => row.id === ids[1])).toEqual(
			expect.arrayContaining([
				{ commit_id: target.commitId, id: ids[1], path: "/removed.csv" },
				{ commit_id: base.commitId, id: ids[1], path: "/removed.csv" },
			]),
		);

		await lix.close();
	});
});
