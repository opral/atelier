import type { ExtensionState } from "./types";

export type EditorRevisionState = {
	readonly beforeCommitId: string | null;
	readonly afterCommitId: string | null;
	readonly beforeFileId: string | null;
	readonly afterFileId: string | null;
};

export type EditorRevisionMode = "editor" | "snapshot" | "diff";

export function normalizeEditorRevisionState(
	state:
		| ExtensionState
		| {
				readonly beforeCommitId?: unknown;
				readonly afterCommitId?: unknown;
				readonly beforeFileId?: unknown;
				readonly afterFileId?: unknown;
		  }
		| null
		| undefined,
): EditorRevisionState {
	return {
		beforeCommitId: normalizeCommitId(state?.beforeCommitId),
		afterCommitId: normalizeCommitId(state?.afterCommitId),
		beforeFileId: normalizeCommitId(state?.beforeFileId),
		afterFileId: normalizeCommitId(state?.afterFileId),
	};
}

export function editorRevisionMode(
	revision: EditorRevisionState,
): EditorRevisionMode {
	if (revision.beforeCommitId) return "diff";
	if (revision.afterCommitId) return "snapshot";
	return "editor";
}

export function hasHistoricalEditorRevisionState(
	state: ExtensionState | null | undefined,
): boolean {
	const revision = normalizeEditorRevisionState(state);
	return revision.beforeCommitId !== null || revision.afterCommitId !== null;
}

export function editorRevisionReviewId(args: {
	readonly fileId: string;
	readonly path: string;
	readonly beforeCommitId: string | null;
	readonly afterCommitId: string | null;
}): string {
	return [
		"editor-revision",
		args.beforeCommitId ?? "none",
		args.afterCommitId ?? "head",
		args.fileId,
		args.path,
	].join(":");
}

function normalizeCommitId(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}
