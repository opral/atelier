import fs from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const WORKSPACE_SESSION_FILE = "workspace-session.json";
export const WORKSPACE_SESSION_VERSION = 3;

export async function readWorkspaceSessionEntries(userDataPath) {
	try {
		const rawStore = await fs.readFile(getWorkspaceSessionPath(userDataPath), {
			encoding: "utf8",
		});
		const store = JSON.parse(rawStore);
		if (
			(store?.version === WORKSPACE_SESSION_VERSION || store?.version === 2) &&
			Array.isArray(store.workspaces)
		) {
			return normalizeWorkspaceSessionEntries(store.workspaces);
		}
		if (store?.version === 1 && Array.isArray(store.workspacePaths)) {
			return normalizeWorkspacePaths(store.workspacePaths).map(
				(workspacePath) => ({
					kind: "path",
					path: workspacePath,
				}),
			);
		}
		return [];
	} catch {
		return [];
	}
}

export async function writeWorkspaceSessionEntries(
	userDataPath,
	workspaceEntries,
) {
	await fs.mkdir(userDataPath, { recursive: true });
	await fs.writeFile(
		getWorkspaceSessionPath(userDataPath),
		serializeWorkspaceSessionEntries(workspaceEntries),
		"utf8",
	);
}

export function writeWorkspaceSessionEntriesSync(
	userDataPath,
	workspaceEntries,
) {
	mkdirSync(userDataPath, { recursive: true });
	writeFileSync(
		getWorkspaceSessionPath(userDataPath),
		serializeWorkspaceSessionEntries(workspaceEntries),
		"utf8",
	);
}

export async function filterExistingWorkspaceEntries(workspaceEntries) {
	const existingWorkspaceEntries = [];
	for (const workspaceEntry of normalizeWorkspaceSessionEntries(
		workspaceEntries,
	)) {
		if (workspaceEntry.kind === "directory") {
			try {
				if ((await fs.stat(workspaceEntry.path)).isDirectory()) {
					existingWorkspaceEntries.push(workspaceEntry);
				}
			} catch {
				// Ignore stale saved paths; explicit launch paths are handled elsewhere.
			}
			continue;
		}

		if (workspaceEntry.kind === "transientDirectory") {
			const sourceFilePaths = [];
			for (const sourceFilePath of workspaceEntry.sourceFilePaths) {
				try {
					if ((await fs.stat(sourceFilePath)).isFile()) {
						sourceFilePaths.push(sourceFilePath);
					}
				} catch {
					// Drop missing files from a restored transient workspace.
				}
			}
			if (sourceFilePaths.length > 0) {
				existingWorkspaceEntries.push({
					kind: "transientDirectory",
					sourceFilePaths,
				});
			}
			continue;
		}

		if (workspaceEntry.kind === "path") {
			try {
				const stats = await fs.stat(workspaceEntry.path);
				if (stats.isDirectory() || stats.isFile()) {
					existingWorkspaceEntries.push(workspaceEntry);
				}
			} catch {
				// Ignore stale v1 paths.
			}
		}
	}
	return existingWorkspaceEntries;
}

export function workspaceToSessionEntry(workspace) {
	if (!workspace) {
		return null;
	}
	if (workspace.kind === "directory") {
		return {
			kind: "directory",
			path: path.resolve(workspace.path),
		};
	}
	if (workspace.kind === "transientDirectory") {
		const sourceFilePaths = normalizeWorkspacePaths(workspace.sourceFilePaths);
		if (sourceFilePaths.length === 0) {
			return null;
		}
		return {
			kind: "transientDirectory",
			sourceFilePaths,
		};
	}
	return null;
}

export function normalizeWorkspaceSessionEntries(workspaceEntries) {
	if (!Array.isArray(workspaceEntries)) {
		return [];
	}

	const seen = new Set();
	const normalizedWorkspaceEntries = [];
	for (const workspaceEntry of workspaceEntries) {
		const normalizedWorkspaceEntry =
			normalizeWorkspaceSessionEntry(workspaceEntry);
		if (!normalizedWorkspaceEntry) {
			continue;
		}
		const key = workspaceSessionEntryKey(normalizedWorkspaceEntry);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		normalizedWorkspaceEntries.push(normalizedWorkspaceEntry);
	}
	return normalizedWorkspaceEntries;
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

function normalizeWorkspaceSessionEntry(workspaceEntry) {
	if (!workspaceEntry || typeof workspaceEntry !== "object") {
		return null;
	}
	if (
		workspaceEntry.kind === "directory" &&
		typeof workspaceEntry.path === "string" &&
		workspaceEntry.path.length > 0
	) {
		return {
			kind: "directory",
			path: path.resolve(workspaceEntry.path),
		};
	}
	if (
		workspaceEntry.kind === "transientDirectory" ||
		workspaceEntry.kind === "ephemeralFiles"
	) {
		const sourceFilePaths = normalizeWorkspacePaths(
			workspaceEntry.sourceFilePaths,
		);
		if (sourceFilePaths.length === 0) {
			return null;
		}
		return {
			kind: "transientDirectory",
			sourceFilePaths,
		};
	}
	if (
		workspaceEntry.kind === "path" &&
		typeof workspaceEntry.path === "string" &&
		workspaceEntry.path.length > 0
	) {
		return {
			kind: "path",
			path: path.resolve(workspaceEntry.path),
		};
	}
	return null;
}

function workspaceSessionEntryKey(workspaceEntry) {
	if (workspaceEntry.kind === "transientDirectory") {
		return `${workspaceEntry.kind}:${workspaceEntry.sourceFilePaths.join("\0")}`;
	}
	return `${workspaceEntry.kind}:${workspaceEntry.path}`;
}

function serializeWorkspaceSessionEntries(workspaceEntries) {
	return `${JSON.stringify(
		{
			version: WORKSPACE_SESSION_VERSION,
			workspaces: normalizeWorkspaceSessionEntries(workspaceEntries).filter(
				(workspaceEntry) => workspaceEntry.kind !== "path",
			),
		},
		null,
		2,
	)}\n`;
}

// Backwards-compatible aliases for older callers/tests.
export async function readWorkspaceSessionPaths(userDataPath) {
	return (await readWorkspaceSessionEntries(userDataPath))
		.filter((workspaceEntry) => workspaceEntry.kind === "path")
		.map((workspaceEntry) => workspaceEntry.path);
}

export async function writeWorkspaceSessionPaths(userDataPath, workspacePaths) {
	await writeWorkspaceSessionEntries(
		userDataPath,
		normalizeWorkspacePaths(workspacePaths).map((workspacePath) => ({
			kind: "directory",
			path: workspacePath,
		})),
	);
}

export function writeWorkspaceSessionPathsSync(userDataPath, workspacePaths) {
	writeWorkspaceSessionEntriesSync(
		userDataPath,
		normalizeWorkspacePaths(workspacePaths).map((workspacePath) => ({
			kind: "directory",
			path: workspacePath,
		})),
	);
}

export async function filterExistingWorkspacePaths(workspacePaths) {
	const entries = await filterExistingWorkspaceEntries(
		normalizeWorkspacePaths(workspacePaths).map((workspacePath) => ({
			kind: "path",
			path: workspacePath,
		})),
	);
	return entries
		.filter((workspaceEntry) => workspaceEntry.kind === "path")
		.map((workspaceEntry) => workspaceEntry.path);
}
