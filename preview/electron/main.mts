import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import {
	openLix,
	type ExecuteResult,
	type Lix,
	type LixTransaction,
	type ObserveEvents,
	type SqlParam,
} from "@lix-js/sdk";

let lix: Lix;
const transactions = new Map<string, LixTransaction>();
const observations = new Map<string, ObserveEvents>();

function serializeResult(result: ExecuteResult) {
	return {
		columns: result.columns,
		rows: result.rows.map((row) =>
			result.columns.map((column) => row.value(column).toJS()),
		),
		rowsAffected: result.rowsAffected,
		notices: result.notices,
	};
}

function registerLixIpc() {
	ipcMain.handle("atelier:lix:execute", async (_event, payload) => {
		const result = await lix.execute(
			String(payload?.sql ?? ""),
			(payload?.params ?? []) as SqlParam[],
			payload?.options,
		);
		return serializeResult(result);
	});

	ipcMain.handle("atelier:lix:transaction:begin", async () => {
		const transactionId = randomUUID();
		transactions.set(transactionId, await lix.beginTransaction());
		return transactionId;
	});

	ipcMain.handle("atelier:lix:transaction:execute", async (_event, payload) => {
		const transaction = transactions.get(String(payload?.transactionId ?? ""));
		if (!transaction) throw new Error("Unknown Lix transaction");
		return serializeResult(
			await transaction.execute(
				String(payload?.sql ?? ""),
				(payload?.params ?? []) as SqlParam[],
				payload?.options,
			),
		);
	});

	ipcMain.handle("atelier:lix:transaction:commit", async (_event, id) => {
		const transaction = transactions.get(String(id));
		if (!transaction) throw new Error("Unknown Lix transaction");
		transactions.delete(String(id));
		await transaction.commit();
	});

	ipcMain.handle("atelier:lix:transaction:rollback", async (_event, id) => {
		const transaction = transactions.get(String(id));
		if (!transaction) throw new Error("Unknown Lix transaction");
		transactions.delete(String(id));
		await transaction.rollback();
	});

	ipcMain.handle("atelier:lix:observe:start", (_event, payload) => {
		const observeId = randomUUID();
		observations.set(
			observeId,
			lix.observe(
				String(payload?.sql ?? ""),
				(payload?.params ?? []) as SqlParam[],
			),
		);
		return observeId;
	});

	ipcMain.handle("atelier:lix:observe:next", async (_event, id) => {
		const observation = observations.get(String(id));
		if (!observation) return undefined;
		const next = await observation.next();
		if (!next) return undefined;
		return { ...next, result: serializeResult(next.result) };
	});

	ipcMain.handle("atelier:lix:observe:close", (_event, id) => {
		const observation = observations.get(String(id));
		observations.delete(String(id));
		observation?.close();
	});

	ipcMain.handle("atelier:lix:activeBranchId", () => lix.activeBranchId());
	ipcMain.handle("atelier:lix:createBranch", (_event, options) =>
		lix.createBranch(options),
	);
	ipcMain.handle("atelier:lix:switchBranch", (_event, options) =>
		lix.switchBranch(options),
	);
	ipcMain.handle("atelier:lix:mergeBranchPreview", (_event, options) =>
		lix.mergeBranchPreview(options),
	);
	ipcMain.handle("atelier:lix:mergeBranch", (_event, options) =>
		lix.mergeBranch(options),
	);
}

async function seedPreviewWorkspace() {
	const files = [
		{
			id: "preview-readme",
			path: "/README.md",
			contents:
				"# Atelier\n\nThis workspace is running on an in-memory Lix inside the Electron preview.\n",
		},
		{
			id: "preview-notes",
			path: "/notes.md",
			contents:
				"# Notes\n\n- Atelier owns the workspace UI.\n- The host owns the Lix.\n",
		},
	];

	for (const file of files) {
		await lix.execute(
			"INSERT INTO lix_file (id, path, data) VALUES ($1, $2, $3)",
			[file.id, file.path, new TextEncoder().encode(file.contents)],
		);
	}

	const activeFileId = "preview-readme";
	const activeFileInstance = `flashtype_file:${activeFileId}`;
	await lix.execute(
		"INSERT INTO lix_key_value (key, value, lixcol_global, lixcol_untracked) VALUES ($1, $2, true, true)",
		["flashtype_active_file_id", activeFileId],
	);
	await lix.execute(
		"INSERT INTO lix_key_value (key, value, lixcol_global, lixcol_untracked) VALUES ($1, $2, true, true)",
		[
			"flashtype_ui_state",
			{
				focusedPanel: "central",
				panels: {
					left: {
						views: [{ instance: "files-default", kind: "flashtype_files" }],
						activeInstance: "files-default",
					},
					central: {
						views: [
							{
								instance: activeFileInstance,
								kind: "flashtype_file",
								state: {
									fileId: activeFileId,
									filePath: "/README.md",
									flashtype: { label: "README.md" },
								},
							},
						],
						activeInstance: activeFileInstance,
					},
					right: {
						views: [{ instance: "history-default", kind: "flashtype_history" }],
						activeInstance: "history-default",
					},
				},
				layout: { sizes: { left: 20, central: 50, right: 30 } },
			},
		],
	);
}

async function createPreviewWindow() {
	const window = new BrowserWindow({
		width: 1280,
		height: 820,
		backgroundColor: "#f4f2ef",
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
		},
	});

	const devServerUrl = process.env.ATELIER_PREVIEW_URL;
	if (!devServerUrl) {
		throw new Error("ATELIER_PREVIEW_URL is required for the Electron preview");
	}
	await window.loadURL(devServerUrl);
}

app.whenReady().then(async () => {
	lix = await openLix();
	await seedPreviewWorkspace();
	registerLixIpc();
	await createPreviewWindow();
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
	for (const observation of observations.values()) observation.close();
	observations.clear();
	void lix?.close();
});
