import fs from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const WORKSPACE_SESSION_FILE = "workspace-session.json";
export const WORKSPACE_SESSION_VERSION = 1;

export async function readWorkspaceSessionPaths(userDataPath) {
	try {
		const rawStore = await fs.readFile(getWorkspaceSessionPath(userDataPath), {
			encoding: "utf8",
		});
		const store = JSON.parse(rawStore);
		if (
			store?.version !== WORKSPACE_SESSION_VERSION ||
			!Array.isArray(store.workspacePaths)
		) {
			return [];
		}
		return normalizeWorkspacePaths(store.workspacePaths);
	} catch {
		return [];
	}
}

export async function writeWorkspaceSessionPaths(
	userDataPath,
	workspacePaths,
) {
	await fs.mkdir(userDataPath, { recursive: true });
	await fs.writeFile(
		getWorkspaceSessionPath(userDataPath),
		serializeWorkspaceSessionPaths(workspacePaths),
		"utf8",
	);
}

export function writeWorkspaceSessionPathsSync(userDataPath, workspacePaths) {
	mkdirSync(userDataPath, { recursive: true });
	writeFileSync(
		getWorkspaceSessionPath(userDataPath),
		serializeWorkspaceSessionPaths(workspacePaths),
		"utf8",
	);
}

export async function filterExistingWorkspacePaths(workspacePaths) {
	const existingWorkspacePaths = [];
	for (const workspacePath of normalizeWorkspacePaths(workspacePaths)) {
		try {
			const stats = await fs.stat(workspacePath);
			if (stats.isDirectory() || stats.isFile()) {
				existingWorkspacePaths.push(workspacePath);
			}
		} catch {
			// Ignore stale saved paths; explicit launch paths are handled elsewhere.
		}
	}
	return existingWorkspacePaths;
}

export function normalizeWorkspacePaths(workspacePaths) {
	if (!Array.isArray(workspacePaths)) {
		return [];
	}

	const seen = new Set();
	const normalizedWorkspacePaths = [];
	for (const workspacePath of workspacePaths) {
		if (typeof workspacePath !== "string" || workspacePath.length === 0) {
			continue;
		}
		const normalizedWorkspacePath = path.resolve(workspacePath);
		if (seen.has(normalizedWorkspacePath)) {
			continue;
		}
		seen.add(normalizedWorkspacePath);
		normalizedWorkspacePaths.push(normalizedWorkspacePath);
	}
	return normalizedWorkspacePaths;
}

export function getWorkspaceSessionPath(userDataPath) {
	return path.join(userDataPath, WORKSPACE_SESSION_FILE);
}

function serializeWorkspaceSessionPaths(workspacePaths) {
	return `${JSON.stringify(
		{
			version: WORKSPACE_SESSION_VERSION,
			workspacePaths: normalizeWorkspacePaths(workspacePaths),
		},
		null,
		2,
	)}\n`;
}
