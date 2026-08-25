import { useDeferredValue, useMemo } from "react";

export type EditorRevisionProps = {
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
	readonly beforeFileId?: string | null;
	readonly afterFileId?: string | null;
	readonly beforeExists?: boolean;
	readonly afterExists?: boolean;
};

/**
 * Defers revision-prop changes so a tab switching revisions — entering or
 * leaving a checkpoint, or retargeting to another one — keeps its previous
 * document mounted while the next revision's reads suspend in the background,
 * instead of flashing the Suspense fallback.
 */
export function useDeferredRevisionProps(
	props: EditorRevisionProps,
): Required<EditorRevisionProps> {
	const revision = useMemo(
		() => ({
			beforeCommitId: props.beforeCommitId ?? null,
			afterCommitId: props.afterCommitId ?? null,
			beforeFileId: props.beforeFileId ?? null,
			afterFileId: props.afterFileId ?? null,
			beforeExists: props.beforeExists !== false,
			afterExists: props.afterExists !== false,
		}),
		[
			props.afterCommitId,
			props.afterExists,
			props.afterFileId,
			props.beforeCommitId,
			props.beforeExists,
			props.beforeFileId,
		],
	);
	return useDeferredValue(revision);
}
