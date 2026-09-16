import { describe, expect, test } from "vitest";
import {
	epochAfterOwnWrite,
	reviewIsBehindWorkspace,
	type WorkingReviewEpoch,
} from "./working-review-epoch";

const opened: WorkingReviewEpoch = {
	beforeCommitId: "checkpoint",
	afterCommitId: "opened-at",
	heldAfterCommitIds: ["opened-at"],
};

describe("a working review and the reviewer's own writes", () => {
	test("follows a write that starts from where it is pinned", () => {
		const moved = epochAfterOwnWrite(opened, {
			before: "opened-at",
			after: "typed",
		});
		expect(moved).toEqual({
			beforeCommitId: "checkpoint",
			afterCommitId: "typed",
			heldAfterCommitIds: ["opened-at", "typed"],
		});
	});

	test("follows a run of them, one after another", () => {
		const first = epochAfterOwnWrite(opened, {
			before: "opened-at",
			after: "typed",
		});
		const second = epochAfterOwnWrite(first!, {
			before: "typed",
			after: "typed-again",
		});
		expect(second?.afterCommitId).toBe("typed-again");
		expect(second?.heldAfterCommitIds).toEqual([
			"opened-at",
			"typed",
			"typed-again",
		]);
	});

	// The write landed on top of somebody else's. Following it would move the
	// review onto an epoch containing a change nobody has read.
	test("stays put when the workspace had already moved on", () => {
		expect(
			epochAfterOwnWrite(opened, {
				before: "somebody-else",
				after: "typed",
			}),
		).toBeNull();
	});
});

describe("whether a working review is behind the file", () => {
	const moved = epochAfterOwnWrite(opened, {
		before: "opened-at",
		after: "typed",
	})!;

	test("is not behind the commit its own write produced", () => {
		expect(
			reviewIsBehindWorkspace(moved, {
				beforeCommitId: "checkpoint",
				afterCommitId: "typed",
			}),
		).toBe(false);
	});

	// The query that watches the workspace reports the older commit for a
	// moment after the write returns. The review already knows better.
	test("is not behind a commit it has held before", () => {
		expect(
			reviewIsBehindWorkspace(moved, {
				beforeCommitId: "checkpoint",
				afterCommitId: "opened-at",
			}),
		).toBe(false);
	});

	test("is behind a commit it has never held", () => {
		expect(
			reviewIsBehindWorkspace(moved, {
				beforeCommitId: "checkpoint",
				afterCommitId: "somebody-else",
			}),
		).toBe(true);
	});

	// A checkpoint moves the base the review compares against, so what is on
	// screen is a span that no longer starts where the working diff does.
	test("is behind once the base itself has moved", () => {
		expect(
			reviewIsBehindWorkspace(moved, {
				beforeCommitId: "newer-checkpoint",
				afterCommitId: "typed",
			}),
		).toBe(true);
	});
});
