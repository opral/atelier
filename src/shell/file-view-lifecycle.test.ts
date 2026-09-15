import { describe, expect, test } from "vitest";
import type { AreaState } from "@/extension-runtime/types";
import { reconcileCurrentFileViews } from "./file-view-lifecycle";

const EMPTY_PANEL: AreaState = { views: [], activeInstance: null };

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
			areas: {
				left: EMPTY_PANEL,
				main: {
					views: [currentView, missingView],
					activeInstance: missingView.instance,
				},
				right: EMPTY_PANEL,
			},
			currentFileIds: new Set(["file_current"]),
		});

		expect(result.main).toEqual({
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
		const areas = {
			left: { views: [nonFileView], activeInstance: nonFileView.instance },
			main: {
				views: [historicalView],
				activeInstance: historicalView.instance,
			},
			right: EMPTY_PANEL,
		};

		const result = reconcileCurrentFileViews({
			areas,
			currentFileIds: new Set(),
		});

		expect(result).toBe(areas);
	});

	test("refreshes current file paths and generated tab labels", () => {
		const currentView = {
			instance: "custom_renderer:file_current",
			kind: "custom_renderer",
			state: {
				fileId: "file_current",
				filePath: "/untitled.md",
				atelier: { label: "untitled.md" },
				customState: true,
			},
		};
		const areas = {
			left: EMPTY_PANEL,
			main: {
				views: [currentView],
				activeInstance: currentView.instance,
			},
			right: EMPTY_PANEL,
		};

		const result = reconcileCurrentFileViews({
			areas,
			currentFileIds: new Set(["file_current"]),
			currentFilePathsById: new Map([
				["file_current", "/project-aurora-launch-plan.md"],
			]),
		});

		expect(result.main.views[0]?.state).toEqual({
			fileId: "file_current",
			filePath: "/project-aurora-launch-plan.md",
			atelier: { label: "project-aurora-launch-plan.md" },
			customState: true,
		});
	});

	test("migrates renamed files to a new renderer without losing selection", () => {
		const currentView = {
			instance: "atelier_file:file_current",
			kind: "atelier_file",
			state: { fileId: "file_current", filePath: "/notes.md" },
		};
		const result = reconcileCurrentFileViews({
			areas: {
				left: EMPTY_PANEL,
				main: {
					views: [currentView],
					activeInstance: currentView.instance,
				},
				right: EMPTY_PANEL,
			},
			currentFileIds: new Set(["file_current"]),
			currentFilePathsById: new Map([["file_current", "/notes.csv"]]),
			resolveCurrentFileView: ({ fileId }) => ({
				kind: "atelier_csv",
				instance: `atelier_csv:${fileId}`,
			}),
		});

		expect(result.main.views[0]).toMatchObject({
			kind: "atelier_csv",
			instance: "atelier_csv:file_current",
			state: {
				fileId: "file_current",
				filePath: "/notes.csv",
				atelier: { label: "notes.csv" },
			},
		});
		expect(result.main.activeInstance).toBe("atelier_csv:file_current");
	});

	test("re-evaluates renderers after handlers load and coalesces collisions", () => {
		const fallbackView = {
			instance: "atelier_file:file_current",
			kind: "atelier_file",
			state: { fileId: "file_current", filePath: "/notes.custom" },
		};
		const installedView = {
			instance: "installed_renderer:file_current",
			kind: "installed_renderer",
			state: { fileId: "file_current", filePath: "/notes.custom" },
		};
		const result = reconcileCurrentFileViews({
			areas: {
				left: EMPTY_PANEL,
				main: {
					views: [fallbackView, installedView],
					activeInstance: fallbackView.instance,
				},
				right: EMPTY_PANEL,
			},
			currentFileIds: new Set(["file_current"]),
			currentFilePathsById: new Map([["file_current", "/notes.custom"]]),
			resolveCurrentFileView: ({ fileId }) => ({
				kind: "installed_renderer",
				instance: `installed_renderer:${fileId}`,
			}),
		});

		expect(result.main.views).toHaveLength(1);
		expect(result.main.views[0]).toMatchObject({
			kind: "installed_renderer",
			instance: "installed_renderer:file_current",
		});
		expect(result.main.activeInstance).toBe("installed_renderer:file_current");
	});
});
