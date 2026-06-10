import { rawLixQuery } from "@/lib/lix-kysely";
import type { DiffWidgetConfig, RenderableDiff, WidgetKind } from "./types";

export const FILES_WIDGET_KIND = "flashtype_files" as WidgetKind;
export const SEARCH_WIDGET_KIND = "flashtype_search" as WidgetKind;
export const TASKS_WIDGET_KIND = "flashtype_tasks" as WidgetKind;
export const CHECKPOINT_WIDGET_KIND = "flashtype_checkpoint" as WidgetKind;
export const FILE_WIDGET_KIND = "flashtype_file" as WidgetKind;
export const DIFF_WIDGET_KIND = "flashtype_diff" as WidgetKind;
export const COMMIT_WIDGET_KIND = "flashtype_commit" as WidgetKind;
export const HISTORY_WIDGET_KIND = "flashtype_history" as WidgetKind;
export const TERMINAL_WIDGET_KIND = "flashtype_terminal" as WidgetKind;

export const fileWidgetInstance = (fileId: string): string =>
	`${FILE_WIDGET_KIND}:${fileId}`;

export const diffWidgetInstance = (fileId: string): string =>
	`${DIFF_WIDGET_KIND}:${fileId}`;

export const commitWidgetInstance = (checkpointId: string): string =>
	`${COMMIT_WIDGET_KIND}:${checkpointId}`;

export const historyWidgetInstance = (scope = "primary"): string =>
	`${HISTORY_WIDGET_KIND}:${scope}`;

export function decodeURIComponentSafe(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function diffLabelFromPath(filePath?: string): string | undefined {
	if (!filePath) return undefined;
	const encodedLabel = filePath.split("/").filter(Boolean).pop();
	return encodedLabel ? decodeURIComponentSafe(encodedLabel) : undefined;
}

export function fileLabelFromPath(
	filePath?: string,
	fallbackLabel?: string,
): string {
	const derived = diffLabelFromPath(filePath);
	if (derived) return derived;
	if (filePath) return filePath;
	return fallbackLabel ?? "Untitled";
}

export function buildFileWidgetProps(args: {
	fileId: string;
	filePath?: string;
	label?: string;
}) {
	const label = args.label ?? fileLabelFromPath(args.filePath, args.fileId);
	return args.filePath
		? {
				fileId: args.fileId,
				filePath: args.filePath,
				flashtype: { label },
			}
		: { fileId: args.fileId, flashtype: { label } };
}

export function createWorkingVsCheckpointDiffConfig(
	fileId: string,
	title: string,
): DiffWidgetConfig {
	return {
		title,
		query: (lix) => {
			void fileId;
			return rawLixQuery<RenderableDiff>(
				lix,
				"SELECT CAST(NULL AS TEXT) AS entity_id, CAST(NULL AS TEXT) AS schema_key, CAST(NULL AS TEXT) AS status, NULL AS before_snapshot_content, NULL AS after_snapshot_content, CAST(NULL AS TEXT) AS plugin_key WHERE false",
			);
		},
	};
}

export function buildDiffWidgetProps(args: {
	fileId: string;
	filePath: string;
	label?: string;
	diffConfig?: DiffWidgetConfig;
}) {
	const label = args.label ?? diffLabelFromPath(args.filePath) ?? args.filePath;
	const diff =
		args.diffConfig ?? createWorkingVsCheckpointDiffConfig(args.fileId, label);
	return {
		fileId: args.fileId,
		filePath: args.filePath,
		flashtype: { label },
		diff,
	};
}
