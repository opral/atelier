import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import {
	closeElectronApp,
	devElectronHeadless,
	launchDevElectronAppWithArgs,
	registerRendererConsoleLogging,
} from "./electron-test-utils";

test("headless e2e launches keep Electron windows hidden and unfocused", async ({
	browserName: _browserName,
}) => {
	test.skip(
		devElectronHeadless !== "1",
		"headless launch assertions only apply to quiet e2e runs",
	);

	let electronApp: ElectronApplication | undefined;
	try {
		electronApp = await launchDevElectronAppWithArgs([]);
		const page = await electronApp.firstWindow();
		registerRendererConsoleLogging(page);

		await expect(page.getByText("Open a folder")).toBeVisible();

		const state = await electronApp.evaluate(({ app, BrowserWindow }) => {
			return {
				dockVisible:
					process.platform === "darwin" ? app.dock.isVisible() : null,
				hasFocusedWindow: BrowserWindow.getFocusedWindow() !== null,
				windows: BrowserWindow.getAllWindows().map((window) => ({
					focused: window.isFocused(),
					visible: window.isVisible(),
				})),
			};
		});

		expect(state.windows.length).toBeGreaterThan(0);
		expect(state.hasFocusedWindow).toBe(false);
		expect(state.windows.every((window) => !window.visible)).toBe(true);
		expect(state.windows.every((window) => !window.focused)).toBe(true);
		if (process.platform === "darwin") {
			expect(state.dockVisible).toBe(false);
		}
	} finally {
		await closeElectronApp(electronApp);
	}
});
