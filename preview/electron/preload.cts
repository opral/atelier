const { contextBridge, ipcRenderer } =
	require("electron") as typeof import("electron");

contextBridge.exposeInMainWorld("atelierPreview", {
	execute: (payload: unknown) =>
		ipcRenderer.invoke("atelier:lix:execute", payload),
	transactionBegin: () => ipcRenderer.invoke("atelier:lix:transaction:begin"),
	transactionExecute: (payload: unknown) =>
		ipcRenderer.invoke("atelier:lix:transaction:execute", payload),
	transactionCommit: (id: string) =>
		ipcRenderer.invoke("atelier:lix:transaction:commit", id),
	transactionRollback: (id: string) =>
		ipcRenderer.invoke("atelier:lix:transaction:rollback", id),
	observeStart: (payload: unknown) =>
		ipcRenderer.invoke("atelier:lix:observe:start", payload),
	observeNext: (id: string) =>
		ipcRenderer.invoke("atelier:lix:observe:next", id),
	observeClose: (id: string) =>
		ipcRenderer.invoke("atelier:lix:observe:close", id),
	activeBranchId: () => ipcRenderer.invoke("atelier:lix:activeBranchId"),
	createBranch: (options: unknown) =>
		ipcRenderer.invoke("atelier:lix:createBranch", options),
	switchBranch: (options: unknown) =>
		ipcRenderer.invoke("atelier:lix:switchBranch", options),
	mergeBranchPreview: (options: unknown) =>
		ipcRenderer.invoke("atelier:lix:mergeBranchPreview", options),
	mergeBranch: (options: unknown) =>
		ipcRenderer.invoke("atelier:lix:mergeBranch", options),
});
