import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { resolveWorkspace } from "./workspace.mjs";

vi.mock("electron", () => ({
	dialog: { showOpenDialog: vi.fn() },
	ipcMain: { handle: vi.fn() },
}));

describe("workspace resolution", () => {
	test("uses a directory path as the workspace", async () => {
		const directory = path.join(
			process.cwd(),
			"tmp",
			randomUUID(),
			"workspace",
		);
		await mkdir(directory, { recursive: true });

		await expect(resolveWorkspace(directory)).resolves.toEqual({
			path: directory,
			name: "workspace",
		});
	});

	test("uses a file's parent directory as the workspace", async () => {
		const directory = path.join(
			process.cwd(),
			"tmp",
			randomUUID(),
			"workspace",
		);
		const filePath = path.join(directory, "readme.md");
		await mkdir(directory, { recursive: true });
		await writeFile(filePath, "# Hello\n");

		await expect(resolveWorkspace(filePath)).resolves.toEqual({
			path: directory,
			name: "workspace",
		});
	});
});
