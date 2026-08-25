import { describe, expect, test } from "vitest";
import { FILES_EXTENSION_KIND } from "../extension-runtime/extension-instance-helpers";
import {
	coerceAtelierUiState,
	createInitialAtelierUiState,
	DEFAULT_ATELIER_UI_STATE,
	type AtelierUiState,
} from "./ui-state";

describe("coerceAtelierUiState", () => {
	test("fresh defaults seed Files in the left sidebar", () => {
		const state = coerceAtelierUiState(undefined);

		expect(state.panels.left.views.map((view) => view.kind)).toEqual([
			FILES_EXTENSION_KIND,
		]);
		expect(state.panels.left.activeInstance).toBe("files-default");
		expect(state.panels.central.views).toEqual([]);
		expect(state.layout?.sizes).toEqual({ left: 0, central: 100, right: 0 });
	});

	test("seeds History into a right panel persisted with no views", () => {
		const persistedState: AtelierUiState = {
			focusedPanel: "central",
			panels: {
				left: DEFAULT_ATELIER_UI_STATE.panels.left,
				central: { views: [], activeInstance: null },
				right: { views: [], activeInstance: null },
			},
			layout: DEFAULT_ATELIER_UI_STATE.layout,
		};

		const coerced = coerceAtelierUiState(persistedState);

		expect(coerced.panels.right.views.map((view) => view.kind)).toEqual([
			"atelier_history",
		]);
		expect(coerced.panels.right.activeInstance).toBe("history-default");
	});

	test("keeps a right panel that already holds views", () => {
		const persistedState: AtelierUiState = {
			focusedPanel: "central",
			panels: {
				left: DEFAULT_ATELIER_UI_STATE.panels.left,
				central: { views: [], activeInstance: null },
				right: {
					views: [{ instance: "sql-right", kind: "sql_explorer" }],
					activeInstance: "sql-right",
				},
			},
			layout: DEFAULT_ATELIER_UI_STATE.layout,
		};

		const coerced = coerceAtelierUiState(persistedState);

		expect(coerced.panels.right.views.map((view) => view.kind)).toEqual([
			"sql_explorer",
		]);
		expect(coerced.panels.right.activeInstance).toBe("sql-right");
	});

	test("preserves persisted left panel views without adding History", () => {
		const persistedState: AtelierUiState = {
			focusedPanel: "left",
			panels: {
				left: {
					views: [{ instance: "files-left", kind: FILES_EXTENSION_KIND }],
					activeInstance: "files-left",
				},
				central: { views: [], activeInstance: null },
				right: { views: [], activeInstance: null },
			},
			layout: DEFAULT_ATELIER_UI_STATE.layout,
		};

		const coerced = coerceAtelierUiState(persistedState);

		expect(coerced.panels.left.views.map((view) => view.kind)).toEqual([
			FILES_EXTENSION_KIND,
		]);
		expect(coerced.panels.left.activeInstance).toBe("files-left");
	});
});

describe("createInitialAtelierUiState", () => {
	test("opens requested side panels only for the fresh layout", () => {
		expect(createInitialAtelierUiState(["right"]).layout?.sizes).toEqual({
			left: 0,
			central: 80,
			right: 20,
		});
		expect(
			createInitialAtelierUiState(["left", "right"]).layout?.sizes,
		).toEqual({
			left: 20,
			central: 60,
			right: 20,
		});
	});
});
