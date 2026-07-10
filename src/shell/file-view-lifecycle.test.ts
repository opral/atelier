import { describe, expect, test } from "vitest";
import type { PanelState } from "@/extension-runtime/types";
import { reconcileCurrentFileViews } from "./file-view-lifecycle";

const EMPTY_PANEL: PanelState = { views: [], activeInstance: null };

describe("reconcileCurrentFileViews", () => {
	test("removes missing current file views regardless of renderer kind", () => {
		const currentView = {
			instance: "custom_renderer:file_current",
			kind: "custom_renderer",
			state: { fileId: "file_current", filePath: "/asset.custom" },
		};
		const missingView = {
			instance: "another_renderer:file_missing",
			kind: "another_renderer",
			state: { fileId: "file_missing", filePath: "/asset.other" },
		};
		const result = reconcileCurrentFileViews({
			panels: {
				left: EMPTY_PANEL,
				central: {
					views: [currentView, missingView],
					activeInstance: missingView.instance,
				},
				right: EMPTY_PANEL,
			},
			currentFileIds: new Set(["file_current"]),
		});

		expect(result.central).toEqual({
			views: [currentView],
			activeInstance: currentView.instance,
		});
	});

	test("preserves historical and non-file views", () => {
		const historicalView = {
			instance: "custom_renderer:file_deleted",
			kind: "custom_renderer",
			state: {
				fileId: "file_deleted",
				filePath: "/deleted.custom",
				afterCommitId: "commit_before_deletion",
			},
		};
		const nonFileView = {
			instance: "search-default",
			kind: "search",
			state: { fileId: "incidental-metadata" },
		};
		const panels = {
			left: { views: [nonFileView], activeInstance: nonFileView.instance },
			central: {
				views: [historicalView],
				activeInstance: historicalView.instance,
			},
			right: EMPTY_PANEL,
		};

		const result = reconcileCurrentFileViews({
			panels,
			currentFileIds: new Set(),
		});

		expect(result).toBe(panels);
	});
});
