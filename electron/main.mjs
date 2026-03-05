import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { disposeLixIpc, registerLixIpc } from "./ipc-lix.mjs";
import { disposeTerminalIpc, registerTerminalIpc } from "./ipc-terminal.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL =
	process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:4173";
let mainWindow = null;

function createMainWindow() {
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.focus();
		return mainWindow;
	}

	mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 1000,
		minHeight: 700,
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	const window = mainWindow;
	const showFallback = setTimeout(() => {
		if (window.isDestroyed() || window.isVisible()) {
			return;
		}
		window.show();
	}, 3000);

	window.once("ready-to-show", () => {
		if (window.isDestroyed()) {
			return;
		}
		window.show();
		window.focus();
	});

	window.on("closed", () => {
		clearTimeout(showFallback);
		if (mainWindow === window) {
			mainWindow = null;
		}
	});

	window.webContents.on(
		"did-fail-load",
		(_event, errorCode, errorDescription, validatedURL) => {
			console.error(
				`Failed to load ${validatedURL} (${errorCode}): ${errorDescription}`,
			);
			if (!window.isDestroyed() && !window.isVisible()) {
				window.show();
			}
		},
	);

	window.webContents.on("render-process-gone", (_event, details) => {
		console.error(
			`Renderer process exited: ${details.reason} (${details.exitCode ?? "n/a"})`,
		);
	});

	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	if (app.isPackaged) {
		void window.loadFile(path.join(__dirname, "../dist/index.html"));
	} else {
		void window.loadURL(DEV_SERVER_URL);
	}

	return window;
}

app.whenReady().then(() => {
	registerLixIpc();
	registerTerminalIpc();
	createMainWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createMainWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("before-quit", () => {
	void disposeLixIpc();
	disposeTerminalIpc();
});
