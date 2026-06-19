import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	filterExistingWorkspaceEntries,
	getWorkspaceSessionPath,
	readWorkspaceSessionEntries,
	writeWorkspaceSessionEntries,
	writeWorkspaceSessionEntriesSync,
	WORKSPACE_SESSION_VERSION,
} from "./workspace-session.mjs";

describe("workspace session store", () => {
	test("missing store returns no workspace entries", async () => {
		const userDataPath = createUserDataPath();

		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);
	});

	test("corrupt or invalid stores return no workspace entries", async () => {
		const userDataPath = createUserDataPath();
		await mkdir(userDataPath, { recursive: true });

		await writeFile(getWorkspaceSessionPath(userDataPath), "{bad json", "utf8");
		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);

		await writeFile(
			getWorkspaceSessionPath(userDataPath),
			JSON.stringify({ version: WORKSPACE_SESSION_VERSION }),
			"utf8",
		);
		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);

		await writeFile(
			getWorkspaceSessionPath(userDataPath),
			JSON.stringify({ version: 999, workspacePaths: ["/tmp/workspace"] }),
			"utf8",
		);
		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual(
			[],
		);
	});

	test("migrates v1 path stores to path entries", async () => {
		const userDataPath = createUserDataPath();
		const firstWorkspacePath = path.join(userDataPath, "first-workspace");
		const secondWorkspacePath = path.join(userDataPath, "second-workspace");
		await mkdir(userDataPath, { recursive: true });
		await writeFile(
			getWorkspaceSessionPath(userDataPath),
			JSON.stringify({
				version: 1,
				workspacePaths: [
					firstWorkspacePath,
					123,
					"",
					path.join(
						firstWorkspacePath,
						"..",
						path.basename(firstWorkspacePath),
					),
					secondWorkspacePath,
					null,
				],
			}),
			"utf8",
		);

		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual([
			{ kind: "path", path: firstWorkspacePath },
			{ kind: "path", path: secondWorkspacePath },
		]);
	});

	test("write persists normalized workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");
		const firstFilePath = path.join(userDataPath, "files", "one.md");
		const secondFilePath = path.join(userDataPath, "files", "two.md");

		await writeWorkspaceSessionEntries(userDataPath, [
			{ kind: "directory", path: workspacePath },
			{ kind: "directory", path: workspacePath },
			{
				kind: "transientDirectory",
				sourceFilePaths: [firstFilePath, secondFilePath, firstFilePath],
			},
		]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [
				{ kind: "directory", path: workspacePath },
				{
					kind: "transientDirectory",
					sourceFilePaths: [firstFilePath, secondFilePath],
				},
			],
		});
	});

	test("reads legacy ephemeral file entries as transient directories", async () => {
		const userDataPath = createUserDataPath();
		const firstFilePath = path.join(userDataPath, "files", "one.md");
		const secondFilePath = path.join(userDataPath, "files", "two.md");
		await mkdir(userDataPath, { recursive: true });
		await writeFile(
			getWorkspaceSessionPath(userDataPath),
			JSON.stringify({
				version: 2,
				workspaces: [
					{
						kind: "ephemeralFiles",
						sourceFilePaths: [firstFilePath, secondFilePath],
					},
				],
			}),
			"utf8",
		);

		await expect(readWorkspaceSessionEntries(userDataPath)).resolves.toEqual([
			{
				kind: "transientDirectory",
				sourceFilePaths: [firstFilePath, secondFilePath],
			},
		]);
	});

	test("sync write persists normalized workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");

		writeWorkspaceSessionEntriesSync(userDataPath, [
			{ kind: "directory", path: workspacePath },
		]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspaces: [{ kind: "directory", path: workspacePath }],
		});
	});

	test("filters stale workspace entries", async () => {
		const userDataPath = createUserDataPath();
		const directoryWorkspacePath = path.join(userDataPath, "directory");
		const firstFilePath = path.join(userDataPath, "one.md");
		const secondFilePath = path.join(userDataPath, "two.md");
		const staleWorkspacePath = path.join(userDataPath, "missing");
		await mkdir(directoryWorkspacePath, { recursive: true });
		await mkdir(userDataPath, { recursive: true });
		await writeFile(firstFilePath, "# One\n", "utf8");

		await expect(
			filterExistingWorkspaceEntries([
				{ kind: "directory", path: directoryWorkspacePath },
				{ kind: "directory", path: staleWorkspacePath },
				{
					kind: "transientDirectory",
					sourceFilePaths: [firstFilePath, secondFilePath],
				},
				{ kind: "path", path: firstFilePath },
			]),
		).resolves.toEqual([
			{ kind: "directory", path: directoryWorkspacePath },
			{ kind: "transientDirectory", sourceFilePaths: [firstFilePath] },
			{ kind: "path", path: firstFilePath },
		]);
	});
});

function createUserDataPath() {
	return path.join(tmpdir(), "flashtype-workspace-session-test", randomUUID());
}

async function readStore(userDataPath: string): Promise<unknown> {
	return JSON.parse(
		await readFile(getWorkspaceSessionPath(userDataPath), "utf8"),
	);
}
