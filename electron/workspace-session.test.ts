import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
	filterExistingWorkspacePaths,
	getWorkspaceSessionPath,
	readWorkspaceSessionPaths,
	writeWorkspaceSessionPaths,
	writeWorkspaceSessionPathsSync,
	WORKSPACE_SESSION_VERSION,
} from "./workspace-session.mjs";

describe("workspace session store", () => {
	test("missing store returns no workspace paths", async () => {
		const userDataPath = createUserDataPath();

		await expect(readWorkspaceSessionPaths(userDataPath)).resolves.toEqual([]);
	});

	test("corrupt or invalid stores return no workspace paths", async () => {
		const userDataPath = createUserDataPath();
		await mkdir(userDataPath, { recursive: true });

		await writeFile(getWorkspaceSessionPath(userDataPath), "{bad json", "utf8");
		await expect(readWorkspaceSessionPaths(userDataPath)).resolves.toEqual([]);

		await writeFile(
			getWorkspaceSessionPath(userDataPath),
			JSON.stringify({ version: WORKSPACE_SESSION_VERSION }),
			"utf8",
		);
		await expect(readWorkspaceSessionPaths(userDataPath)).resolves.toEqual([]);

		await writeFile(
			getWorkspaceSessionPath(userDataPath),
			JSON.stringify({ version: 999, workspacePaths: ["/tmp/workspace"] }),
			"utf8",
		);
		await expect(readWorkspaceSessionPaths(userDataPath)).resolves.toEqual([]);
	});

	test("read ignores non-string paths and dedupes resolved paths", async () => {
		const userDataPath = createUserDataPath();
		const firstWorkspacePath = path.join(userDataPath, "first-workspace");
		const secondWorkspacePath = path.join(userDataPath, "second-workspace");
		await mkdir(userDataPath, { recursive: true });
		await writeFile(
			getWorkspaceSessionPath(userDataPath),
			JSON.stringify({
				version: WORKSPACE_SESSION_VERSION,
				workspacePaths: [
					firstWorkspacePath,
					123,
					"",
					path.join(firstWorkspacePath, "..", path.basename(firstWorkspacePath)),
					secondWorkspacePath,
					null,
				],
			}),
			"utf8",
		);

		await expect(readWorkspaceSessionPaths(userDataPath)).resolves.toEqual([
			firstWorkspacePath,
			secondWorkspacePath,
		]);
	});

	test("write persists normalized workspace paths", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");

		await writeWorkspaceSessionPaths(userDataPath, [
			workspacePath,
			workspacePath,
		]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspacePaths: [workspacePath],
		});
	});

	test("sync write persists normalized workspace paths", async () => {
		const userDataPath = createUserDataPath();
		const workspacePath = path.join(userDataPath, "workspace");

		writeWorkspaceSessionPathsSync(userDataPath, [workspacePath]);

		await expect(readStore(userDataPath)).resolves.toEqual({
			version: WORKSPACE_SESSION_VERSION,
			workspacePaths: [workspacePath],
		});
	});

	test("filters stale workspace paths", async () => {
		const userDataPath = createUserDataPath();
		const directoryWorkspacePath = path.join(userDataPath, "directory");
		const fileWorkspacePath = path.join(userDataPath, "solo.md");
		const staleWorkspacePath = path.join(userDataPath, "missing");
		await mkdir(directoryWorkspacePath, { recursive: true });
		await mkdir(userDataPath, { recursive: true });
		await writeFile(fileWorkspacePath, "# Solo\n", "utf8");

		await expect(
			filterExistingWorkspacePaths([
				directoryWorkspacePath,
				staleWorkspacePath,
				fileWorkspacePath,
			]),
		).resolves.toEqual([directoryWorkspacePath, fileWorkspacePath]);
	});
});

function createUserDataPath() {
	return path.join(tmpdir(), "flashtype-workspace-session-test", randomUUID());
}

async function readStore(userDataPath: string): Promise<unknown> {
	return JSON.parse(await readFile(getWorkspaceSessionPath(userDataPath), "utf8"));
}
