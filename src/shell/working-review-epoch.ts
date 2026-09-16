import type { CommitSpan } from "@lix-js/sdk";

/**
 * Where a working review is pinned.
 *
 * A review compares two commits, and it goes on comparing those two while the
 * workspace moves on — that is what makes it a review and not a live view. The
 * one thing that may move it is a write the reviewer made themselves: being
 * told they are behind their own typing is no help to anybody, and a decision
 * refused against the epoch their own keystroke left behind is worse.
 *
 * So the review remembers where it has been. `afterCommitId` is what is on
 * screen; `heldAfterCommitIds` is that commit and every earlier one it was
 * pinned to. The workspace being on any of them means nobody else has written.
 */
export type WorkingReviewEpoch = {
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	/** Every commit this review has been pinned to, oldest first. */
	readonly heldAfterCommitIds: readonly string[];
};

/**
 * Where the review is pinned after a write of the reviewer's own — or null when
 * the write is not one it may follow.
 *
 * The receipt a write comes back with names the commit it produced and the
 * commit the workspace was on before it. The review follows it when, and only
 * when, it was pinned to the commit the write started from: then this write is
 * the only thing that has landed since, and following it cannot pull anybody
 * else's change into the review. Any other receipt means somebody else wrote
 * too, and a review that is behind somebody else's change has to say so.
 *
 * The test is the receipt alone. Nothing is asked of the workspace, so there is
 * no answer that can have moved on between the asking and the reading, and
 * nothing is timed, so there is no window in which a decision is taken against
 * one epoch while the review is on its way to another.
 */
export function epochAfterOwnWrite(
	epoch: WorkingReviewEpoch,
	commit: CommitSpan,
): WorkingReviewEpoch | null {
	if (epoch.afterCommitId !== commit.before) return null;
	return {
		beforeCommitId: epoch.beforeCommitId,
		afterCommitId: commit.after,
		heldAfterCommitIds: [...epoch.heldAfterCommitIds, commit.after],
	};
}

/**
 * Whether the workspace has moved somewhere this review has never been, which
 * is the only thing that puts a review behind the file.
 *
 * A write of the reviewer's own counts as held from the moment it returns,
 * which is before the query that watches the workspace has seen it. Accepting
 * any commit the review has held, rather than only its newest, is what keeps
 * the notice from flashing on in that gap — without ever holding it back once
 * it is somebody else who moved the file.
 */
export function reviewIsBehindWorkspace(
	epoch: WorkingReviewEpoch,
	workspace: {
		readonly beforeCommitId: string;
		readonly afterCommitId: string;
	},
): boolean {
	return (
		workspace.beforeCommitId !== epoch.beforeCommitId ||
		!epoch.heldAfterCommitIds.includes(workspace.afterCommitId)
	);
}
