import { expect, test } from "vitest";
import { openLix } from "../test-utils/node-lix-sdk";
import {
	renameWorkspaceEntry,
	WorkspacePathTakenError,
} from "./workspace-file-ops";

test("replaying a rename for the same file is a no-op without another commit", async () => {
	const lix = await openLix();
	try {
		const created = await lix.execute(
			"INSERT INTO lix_file (path) VALUES ('/untitled.md') RETURNING id",
		);
		const entry = { kind: "file" as const, id: String(created.rows[0]?.id) };
		await renameWorkspaceEntry(lix, entry, "/Title.md");
		const before = await lix.execute(
			"SELECT lix_active_branch_commit_id() AS id",
		);
		await renameWorkspaceEntry(lix, entry, "/Title.md");
		const after = await lix.execute(
			"SELECT lix_active_branch_commit_id() AS id",
		);
		expect(after.rows).toEqual(before.rows);
		expect(
			(await lix.execute("SELECT path FROM lix_file WHERE id = $1", [entry.id]))
				.rows[0]?.path,
		).toBe("/Title.md");
	} finally {
		await lix.close();
	}
});

test("another file or directory at the destination remains a collision", async () => {
	const lix = await openLix();
	try {
		const created = await lix.execute(
			"INSERT INTO lix_file (path) VALUES ('/untitled.md') RETURNING id",
		);
		const entry = { kind: "file" as const, id: String(created.rows[0]?.id) };
		await lix.execute("INSERT INTO lix_file (path) VALUES ('/Taken.md')");
		await lix.execute("INSERT INTO lix_directory (path) VALUES ('/Folder')");
		await expect(
			renameWorkspaceEntry(lix, entry, "/Taken.md"),
		).rejects.toBeInstanceOf(WorkspacePathTakenError);
		await expect(
			renameWorkspaceEntry(lix, entry, "/Folder"),
		).rejects.toBeInstanceOf(WorkspacePathTakenError);
		expect(
			(await lix.execute("SELECT path FROM lix_file WHERE id = $1", [entry.id]))
				.rows[0]?.path,
		).toBe("/untitled.md");
	} finally {
		await lix.close();
	}
});
