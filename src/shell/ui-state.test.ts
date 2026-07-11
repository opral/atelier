import { describe, expect, test } from "vitest";
import { FILES_EXTENSION_KIND } from "../extension-runtime/extension-instance-helpers";
import {
	coerceAtelierUiState,
	DEFAULT_ATELIER_UI_STATE,
	type AtelierUiState,
} from "./ui-state";

describe("coerceAtelierUiState", () => {
	test("fresh defaults open Files in the centered workspace", () => {
		const state = coerceAtelierUiState(undefined);

		expect(state.panels.left.views).toEqual([]);
		expect(state.panels.central.views.map((view) => view.kind)).toEqual([
			FILES_EXTENSION_KIND,
		]);
		expect(state.panels.central.activeInstance).toBe("files-default");
		expect(state.layout?.sizes).toEqual({ left: 0, central: 100, right: 0 });
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
