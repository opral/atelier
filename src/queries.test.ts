import { describe, test, expect } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { qb } from "@/lib/lix-kysely";
import {
	selectCheckpoints,
	selectCheckpointsWithFileCounts,
	selectFileWorkingChanges,
	selectFilesystemEntries,
	selectLatestCheckpoint,
	selectWorkingChangeCount,
	selectWorkingChanges,
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
	test("returns net working changes and newest-first checkpoints", async () => {
		const lix = await openLix();

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

		expect(await selectWorkingChanges(lix).execute()).toEqual([
			expect.objectContaining({
				row_pk: ["checkpoint-query-test"],
				schema_key: "lix_key_value",
				diff_type: "added",
				before_change_id: null,
			}),
		]);
		expect(await selectWorkingChangeCount(lix).execute()).toEqual([
			{ change_count: 1 },
		]);

		const checkpoint = await lix.createCheckpoint();

		expect(await selectWorkingChanges(lix).execute()).toEqual([]);
		expect(await selectWorkingChangeCount(lix).execute()).toEqual([
			{ change_count: 0 },
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

	test("returns composed working files and checkpoint file counts", async () => {
		const lix = await openLix();

		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
			[
				fakeUuid("review-file"),
				"/drafts/review.md",
				new TextEncoder().encode("draft"),
			],
		);
		expect(await selectFileWorkingChanges(lix).execute()).toEqual([
			{
				id: fakeUuid("review-file"),
				path: "/drafts/review.md",
				previous_path: null,
				diff_type: "added",
			},
		]);

		const checkpoint = await lix.createCheckpoint();
		expect(await selectFileWorkingChanges(lix).execute()).toEqual([]);
		expect(await selectCheckpointsWithFileCounts(lix).execute()).toEqual([
			expect.objectContaining({
				commit_id: checkpoint.commitId,
				file_count: 1,
			}),
			expect.objectContaining({ file_count: 0 }),
		]);

		await lix.close();
	});
});
