import type { ExtensionState } from "./types";

export type EditorRevisionState = {
	readonly beforeCommitId: string | null;
	readonly afterCommitId: string | null;
	readonly beforeFileId: string | null;
	readonly afterFileId: string | null;
	readonly beforeExists: boolean;
	readonly afterExists: boolean;
};

export type EditorRevisionMode = "editor" | "snapshot" | "diff";

/**
 * View-state keys that pin an editor to a historical revision. They are the
 * tab's identity, not accumulated state: navigating a tab to the live
 * document must drop them or the tab stays a read-only snapshot forever.
 */
export const EDITOR_REVISION_STATE_KEYS = [
	"beforeCommitId",
	"afterCommitId",
	"beforeFileId",
	"afterFileId",
	"beforeExists",
	"afterExists",
	"sourceCommitId",
] as const;

export function normalizeEditorRevisionState(
	state:
		| ExtensionState
		| {
				readonly beforeCommitId?: unknown;
				readonly afterCommitId?: unknown;
				readonly beforeFileId?: unknown;
				readonly afterFileId?: unknown;
				readonly beforeExists?: unknown;
				readonly afterExists?: unknown;
		  }
		| null
		| undefined,
): EditorRevisionState {
	return {
		beforeCommitId: normalizeCommitId(state?.beforeCommitId),
		afterCommitId: normalizeCommitId(state?.afterCommitId),
		beforeFileId: normalizeCommitId(state?.beforeFileId),
		afterFileId: normalizeCommitId(state?.afterFileId),
		beforeExists: state?.beforeExists !== false,
		afterExists: state?.afterExists !== false,
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
