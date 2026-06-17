import { dialog, ipcMain } from "electron";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";

const LIX_DATABASE_FILE = path.join(".lix", "db.sqlite");

/**
 * The workspace is the folder Flashtype operates on. Each window has at most
 * one workspace; everything else (lix, terminal cwd, window title) derives
 * from that window's workspace. `null` means first run: the app renders
 * without a database until the user picks a folder.
 */
let registered = false;
const windowStates = new Map();

export function getWorkspace(window) {
	return getWindowState(window)?.workspace ?? null;
}

/**
 * Resolves a requested path (folder, or a file whose parent folder is meant)
 * to a workspace descriptor.
 */
export async function resolveWorkspace(requestedPath) {
	const resolved = path.resolve(requestedPath);
	let dir = resolved;
	try {
		const stats = await stat(resolved);
		if (stats.isFile()) {
			dir = path.dirname(resolved);
		}
	} catch {
		// Keep the resolved path; the lix backend reports unreadable paths.
	}
	return { path: dir, name: path.basename(dir) };
}

export async function setWorkspaceFromPath(
	requestedPath,
	window,
	options = {},
) {
	const state = getOrCreateWindowState(window);
	return await enqueueWorkspaceChange(state, async () => {
		const nextWorkspace = await resolveWorkspace(requestedPath);
		if (state.workspace?.path === nextWorkspace.path) {
			applyWindowChrome(window);
			return state.workspace;
		}
		await options.beforeChange?.(nextWorkspace, window);
		state.workspace = nextWorkspace;
		applyWindowChrome(window);
		return state.workspace;
	});
}

/**
 * Shows the native directory picker. Returns the new workspace, or null when
 * the user cancels (cancel keeps the current state; it is not an error).
 */
export async function openWorkspaceDialog(window, options = {}) {
	const result = await showWorkspaceDialog(window);
	const dir = result.filePaths[0];
	if (result.canceled || dir === undefined) {
		return null;
	}
	return await setWorkspaceFromPath(dir, window, options);
}

export async function exportWorkspaceLixFile(window) {
	const workspace = getWorkspace(window);
	if (!workspace) {
		throw new Error(
			"No workspace is open. Open a folder before exporting lix.",
		);
	}
	return await readFile(getWorkspaceLixDatabasePath(window));
}

export function getWorkspaceLixDatabasePath(window) {
	const workspace = getWorkspace(window);
	if (!workspace) {
		throw new Error(
			"No workspace is open. Open a folder before exporting lix.",
		);
	}
	return path.join(workspace.path, LIX_DATABASE_FILE);
}

export function applyWorkspaceWindowChrome(window) {
	applyWindowChrome(window);
}

function applyWindowChrome(window) {
	const workspace = getWorkspace(window);
	if (!workspace || !window || window.isDestroyed()) {
		return;
	}
	window.setTitle(workspace.name);
	// macOS proxy title: Cmd-click shows the folder's path popover.
	window.setRepresentedFilename(workspace.path);
}

async function showWorkspaceDialog(window) {
	const dialogOptions = {
		title: "Open Folder",
		buttonLabel: "Open",
		properties: ["openDirectory", "createDirectory"],
	};
	return window && !window.isDestroyed()
		? await dialog.showOpenDialog(window, dialogOptions)
		: await dialog.showOpenDialog(dialogOptions);
}

function enqueueWorkspaceChange(state, operation) {
	const result = state.workspaceChangeQueue.catch(() => {}).then(operation);
	state.workspaceChangeQueue = result.catch(() => {});
	return result;
}

export function registerWorkspaceIpc(getWindowForEvent, options = {}) {
	if (registered) {
		return;
	}
	registered = true;

	ipcMain.handle("workspace:get", (event) => {
		return getWorkspace(getWindowForEvent(event));
	});

	ipcMain.handle("workspace:open", async (event, payload) => {
		const window = getWindowForEvent(event);
		const requestedPath = payload?.path;
		if (typeof requestedPath === "string" && requestedPath.length > 0) {
			return await setWorkspaceFromPath(requestedPath, window, options);
		}
		return await openWorkspaceDialog(window, options);
	});

	ipcMain.handle("workspace:openInNewWindow", async (event, payload) => {
		if (typeof options.openInNewWindow !== "function") {
			throw new Error("workspace.openInNewWindow is not available");
		}
		const sourceWindow = getWindowForEvent(event);
		const requestedPath = payload?.path;
		if (typeof requestedPath === "string" && requestedPath.length > 0) {
			return await options.openInNewWindow(requestedPath, sourceWindow);
		}

		const result = await showWorkspaceDialog(sourceWindow);
		const dir = result.filePaths[0];
		if (result.canceled || dir === undefined) {
			return null;
		}
		return await options.openInNewWindow(dir, sourceWindow);
	});
}

function getWindowState(window) {
	if (!window || window.isDestroyed()) {
		return null;
	}
	return windowStates.get(window.id) ?? null;
}

function getOrCreateWindowState(window) {
	if (!window || window.isDestroyed()) {
		throw new Error("A live window is required to open a workspace.");
	}
	const existing = windowStates.get(window.id);
	if (existing) {
		return existing;
	}
	const state = {
		workspace: null,
		workspaceChangeQueue: Promise.resolve(),
	};
	windowStates.set(window.id, state);
	window.once("closed", () => {
		windowStates.delete(window.id);
	});
	return state;
}
