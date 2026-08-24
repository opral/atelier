import {
	createElement,
	StrictMode,
	Suspense,
	useEffect,
	type ComponentType,
} from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { qb } from "@/lib/lix-kysely";
import { GLOBAL_BRANCH_ID } from "@/lib/global-branch-id";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";
import {
	getExternalWriteReview,
	getExternalWriteReviewData,
	getAgentTurnExternalWriteReview,
	getPendingExternalWriteReviewPaths,
	getWorkingChangeExternalWriteReview,
	useExternalWriteReview,
	useExternalWriteReviewData,
	useAgentTurnCommitRanges,
} from "./external-write-review-history";
import {
	appendAgentTurnCommitRange,
	agentTurnReviewId,
	agentTurnReviewRangeIds,
	readAgentTurnCommitRanges,
	type AgentTurnCommitRange,
} from "./agent-turn-review-range";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("agent turn range consumers share one branch observer", async () => {
	const next = vi.fn(() => new Promise<undefined>(() => {}));
	const closeObservation = vi.fn();
	const closeSession = vi.fn().mockResolvedValue(undefined);
	const branchLix = {
		observe: vi.fn(() => ({ next, close: closeObservation })),
		close: closeSession,
	};
	const openAnotherSession = vi.fn().mockResolvedValue(branchLix);
	const lix = { openAnotherSession } as unknown as Lix;

	function Consumer() {
		useAgentTurnCommitRanges("branch-1");
		return null;
	}
	function Consumers({ first }: { readonly first: boolean }) {
		return createElement(
			"div",
			null,
			first ? createElement(Consumer) : null,
			createElement(Consumer),
		);
	}

	const rendered = render(
		createElement(LixProvider, {
			lix,
			// oxlint-disable-next-line react/no-children-prop
			children: createElement(Consumers, { first: true }),
		}),
	);
	await waitFor(() => expect(openAnotherSession).toHaveBeenCalledTimes(1));
	expect(branchLix.observe).toHaveBeenCalledTimes(1);

	rendered.rerender(
		createElement(LixProvider, {
			lix,
			// oxlint-disable-next-line react/no-children-prop
			children: createElement(Consumers, { first: false }),
		}),
	);
	await Promise.resolve();
	expect(closeObservation).not.toHaveBeenCalled();
	expect(closeSession).not.toHaveBeenCalled();

	rendered.unmount();
	await waitFor(() => expect(closeObservation).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(closeSession).toHaveBeenCalledTimes(1));
});

test("agent turn range observer publishes its first coherent result", async () => {
	const range: AgentTurnCommitRange = {
		id: "range-1",
		sourceId: "agent-1",
		beforeCommitId: "before-1",
		afterCommitId: "after-1",
		startedAt: 1,
		completedAt: 2,
	};
	const next = vi
		.fn()
		.mockResolvedValueOnce({
			result: { rows: [{ get: () => range }] },
		})
		.mockImplementation(() => new Promise<undefined>(() => {}));
	const closeObservation = vi.fn();
	const closeSession = vi.fn().mockResolvedValue(undefined);
	const branchLix = {
		observe: vi.fn(() => ({ next, close: closeObservation })),
		close: closeSession,
	};
	const lix = {
		openAnotherSession: vi.fn().mockResolvedValue(branchLix),
	} as unknown as Lix;

	function Consumer() {
		const { ranges } = useAgentTurnCommitRanges("branch-first-result");
		return createElement("span", null, ranges[0]?.id ?? "empty");
	}

	const rendered = render(
		createElement(LixProvider, {
			lix,
			// oxlint-disable-next-line react/no-children-prop
			children: createElement(Consumer),
		}),
	);
	await waitFor(() => expect(rendered.getByText("range-1")).toBeTruthy());
	expect(branchLix.observe).toHaveBeenCalledTimes(1);

	rendered.unmount();
	await waitFor(() => expect(closeObservation).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(closeSession).toHaveBeenCalledTimes(1));
});

test("agent turn range observer survives the StrictMode effect reconnect", async () => {
	const next = vi.fn(() => new Promise<undefined>(() => {}));
	const closeObservation = vi.fn();
	const closeSession = vi.fn().mockResolvedValue(undefined);
	const branchLix = {
		observe: vi.fn(() => ({ next, close: closeObservation })),
		close: closeSession,
	};
	const openAnotherSession = vi.fn().mockResolvedValue(branchLix);
	const lix = { openAnotherSession } as unknown as Lix;

	function Consumer() {
		useAgentTurnCommitRanges("branch-strict");
		return null;
	}

	const rendered = render(
		createElement(
			StrictMode,
			null,
			createElement(LixProvider, {
				lix,
				// oxlint-disable-next-line react/no-children-prop
				children: createElement(Consumer),
			}),
		),
	);
	await waitFor(() => expect(openAnotherSession).toHaveBeenCalledTimes(1));
	expect(branchLix.observe).toHaveBeenCalledTimes(1);
	expect(closeObservation).not.toHaveBeenCalled();

	rendered.unmount();
	await waitFor(() => expect(closeObservation).toHaveBeenCalledTimes(1));
	await waitFor(() => expect(closeSession).toHaveBeenCalledTimes(1));
});

describe("getWorkingChangeExternalWriteReview", () => {
	test("reviews the file from the latest checkpoint to the active head", async () => {
		const lix = await openLix();
		try {
			await writeFile(
				lix,
				fakeUuid("checkpoint-file"),
				"/checkpoint.md",
				"before",
			);
			const checkpoint = await lix.createCheckpoint();
			await writeFile(
				lix,
				fakeUuid("checkpoint-file"),
				"/checkpoint.md",
				"after",
			);
			const headCommitId = await activeCommitId(lix);

			const review = await getWorkingChangeExternalWriteReview(
				lix,
				fakeUuid("checkpoint-file"),
				"/checkpoint.md",
			);
			expect(review).toEqual(
				expect.objectContaining({
					fileId: fakeUuid("checkpoint-file"),
					path: "/checkpoint.md",
					beforeCommitId: checkpoint.commitId,
					afterCommitId: headCommitId,
				}),
			);
			if (!review) throw new Error("Expected a checkpoint working review");
			const data = await getExternalWriteReviewData(lix, review);
			expect(decoder.decode(data?.beforeData)).toBe("before");
			expect(decoder.decode(data?.afterData)).toBe("after");
		} finally {
			await lix.close();
		}
	});

	test("reviews a file deleted after the latest checkpoint", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("deleted-working-file");
			const path = "/deleted-working.md";
			await writeFile(lix, fileId, path, "before deletion");
			const checkpoint = await lix.createCheckpoint();
			await qb(lix).deleteFrom("lix_file").where("id", "=", fileId).execute();
			const headCommitId = await activeCommitId(lix);

			const review = await getWorkingChangeExternalWriteReview(
				lix,
				fileId,
				path,
			);

			expect(review).toEqual(
				expect.objectContaining({
					fileId,
					path,
					beforeCommitId: checkpoint.commitId,
					afterCommitId: headCommitId,
				}),
			);
			const data = await getExternalWriteReviewData(lix, review!);
			expect(decoder.decode(data?.beforeData)).toBe("before deletion");
			expect(data?.afterData).toEqual(new Uint8Array());
		} finally {
			await lix.close();
		}
	});
});

describe("getExternalWriteReview", () => {
	test("reads both range snapshots in one history statement", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("single-range-query-count");
			const path = "/docs/single-range-query-count.md";
			await writeFile(lix, fileId, path, "before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, fileId, path, "after");
			const afterCommitId = await activeCommitId(lix);
			const execute = vi.spyOn(lix, "execute");

			const review = await getAgentTurnExternalWriteReview(lix, fileId, path, [
				agentRange({
					id: "single-range",
					beforeCommitId,
					afterCommitId,
				}),
			]);

			expect(review?.agentTurnRangeIds).toEqual(["single-range"]);
			expect(historyReadCount(execute)).toBe(1);
		} finally {
			await lix.close();
		}
	});

	test("reads contiguous range snapshots in one history statement", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("contiguous-range-query-count");
			const path = "/docs/contiguous-range-query-count.md";
			await writeFile(lix, fileId, path, "before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, fileId, path, "middle");
			const middleCommitId = await activeCommitId(lix);
			await writeFile(lix, fileId, path, "after");
			const afterCommitId = await activeCommitId(lix);
			const execute = vi.spyOn(lix, "execute");

			const review = await getAgentTurnExternalWriteReview(lix, fileId, path, [
				agentRange({
					id: "earlier-range",
					beforeCommitId,
					afterCommitId: middleCommitId,
				}),
				agentRange({
					id: "later-range",
					beforeCommitId: middleCommitId,
					afterCommitId,
				}),
			]);

			expect(review?.agentTurnRangeIds).toEqual([
				"earlier-range",
				"later-range",
			]);
			expect(historyReadCount(execute)).toBe(1);
		} finally {
			await lix.close();
		}
	});

	test("returns no review when no agent turn range exists", async () => {
		const lix = await openLix();
		try {
			await writeFile(
				lix,
				fakeUuid("history-file"),
				"/docs/history.md",
				"before",
			);
			await writeFile(
				lix,
				fakeUuid("history-file"),
				"/docs/history.md",
				"after",
			);

			const review = await getExternalWriteReview(
				lix,
				fakeUuid("history-file"),
				"/docs/history.md",
			);

			expect(review).toBeNull();
		} finally {
			await lix.close();
		}
	});

	test("uses an agent turn range for the review diff", async () => {
		const lix = await openLix();
		try {
			await writeFile(
				lix,
				fakeUuid("agent-file"),
				"/docs/agent.md",
				"turn before",
			);
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(
				lix,
				fakeUuid("agent-file"),
				"/docs/agent.md",
				"intermediate",
			);
			await writeFile(
				lix,
				fakeUuid("agent-file"),
				"/docs/agent.md",
				"turn after",
			);
			const afterCommitId = await activeCommitId(lix);

			await appendAgentTurnCommitRange(
				lix,
				agentRange({ id: "range-1", beforeCommitId, afterCommitId }),
			);

			const review = await getExternalWriteReview(
				lix,
				fakeUuid("agent-file"),
				"/docs/agent.md",
			);

			expect(review?.agentTurnRangeIds).toEqual(["range-1"]);
			expect(review?.beforeCommitId).toBe(beforeCommitId);
			expect(review?.afterCommitId).toBe(afterCommitId);
			await expectReviewData(lix, review, "turn before", "turn after");
		} finally {
			await lix.close();
		}
	});

	test("resolves the complete review against the explicitly targeted branch", async () => {
		const lix = await openLix();
		try {
			const mainBranchId = await lix.activeBranchId();
			await writeFile(
				lix,
				fakeUuid("target-branch-file"),
				"/docs/target.md",
				"before",
			);
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(
				lix,
				fakeUuid("target-branch-file"),
				"/docs/target.md",
				"main after",
			);
			const afterCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-target-main",
					beforeCommitId,
					afterCommitId,
				}),
			);

			const draft = await lix.createBranch({ name: "Draft" });
			await lix.switchBranch({ branchId: draft.id });
			await writeFile(
				lix,
				fakeUuid("target-branch-file"),
				"/docs/target.md",
				"draft after",
			);

			const review = await getExternalWriteReview(
				lix,
				fakeUuid("target-branch-file"),
				"/docs/target.md",
				{ branchId: mainBranchId },
			);
			expect(review?.agentTurnRangeIds).toEqual(["range-target-main"]);
		} finally {
			await lix.close();
		}
	});

	test("uses empty before data for a file created during an agent turn", async () => {
		const lix = await openLix();
		try {
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(
				lix,
				fakeUuid("created-file"),
				"/docs/created.md",
				"created during turn",
			);
			const afterCommitId = await activeCommitId(lix);

			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-created",
					beforeCommitId,
					afterCommitId,
				}),
			);

			const review = await getExternalWriteReview(
				lix,
				fakeUuid("created-file"),
				"/docs/created.md",
			);

			expect(review?.agentTurnRangeIds).toEqual(["range-created"]);
			await expectReviewData(lix, review, "", "created during turn");
		} finally {
			await lix.close();
		}
	});

	test("keeps a review for a file deleted during an agent turn", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("deleted-agent-file");
			const path = "/docs/deleted.md";
			await writeFile(lix, fileId, path, "before deletion");
			const beforeCommitId = await activeCommitId(lix);
			await qb(lix).deleteFrom("lix_file").where("id", "=", fileId).execute();
			const afterCommitId = await activeCommitId(lix);

			const review = await getAgentTurnExternalWriteReview(lix, fileId, path, [
				agentRange({
					id: "deleted-agent-range",
					beforeCommitId,
					afterCommitId,
				}),
			]);

			expect(review).toEqual(
				expect.objectContaining({
					fileId,
					path,
					agentTurnRangeIds: ["deleted-agent-range"],
				}),
			);
			const data = await getExternalWriteReviewData(lix, review!);
			expect(decoder.decode(data?.beforeData)).toBe("before deletion");
			expect(data?.afterData).toEqual(new Uint8Array());
		} finally {
			await lix.close();
		}
	});

	test("does not confuse a deleted file with an existing empty file", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("empty-then-deleted-agent-file");
			const path = "/docs/empty-then-deleted.md";
			await writeFile(lix, fileId, path, "before empty");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, fileId, path, "");
			const afterCommitId = await activeCommitId(lix);
			await qb(lix).deleteFrom("lix_file").where("id", "=", fileId).execute();

			const review = await getAgentTurnExternalWriteReview(lix, fileId, path, [
				agentRange({
					id: "empty-then-deleted-agent-range",
					beforeCommitId,
					afterCommitId,
				}),
			]);

			expect(review).toBeNull();
		} finally {
			await lix.close();
		}
	});

	test("uses the nearest inherited file history snapshot at the before commit", async () => {
		const lix = await openLix();
		try {
			await writeFile(
				lix,
				fakeUuid("inherited-file"),
				"/docs/inherited.md",
				"inherited before",
			);
			await writeFile(
				lix,
				fakeUuid("other-file"),
				"/docs/other.md",
				"unrelated turn start",
			);
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(
				lix,
				fakeUuid("inherited-file"),
				"/docs/inherited.md",
				"inherited after",
			);
			const afterCommitId = await activeCommitId(lix);

			await appendAgentTurnCommitRange(
				lix,
				agentRange({ id: "range-inherited", beforeCommitId, afterCommitId }),
			);

			const review = await getExternalWriteReview(
				lix,
				fakeUuid("inherited-file"),
				"/docs/inherited.md",
			);

			expect(review?.agentTurnRangeIds).toEqual(["range-inherited"]);
			await expectReviewData(
				lix,
				review,
				"inherited before",
				"inherited after",
			);
		} finally {
			await lix.close();
		}
	});

	test("returns no review for a no-op agent turn range", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, fakeUuid("noop-file"), "/docs/noop.md", "before");
			const commitId = await activeCommitId(lix);
			await writeFile(lix, fakeUuid("noop-file"), "/docs/noop.md", "after");

			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-noop",
					beforeCommitId: commitId,
					afterCommitId: commitId,
				}),
			);

			await expect(
				getExternalWriteReview(lix, fakeUuid("noop-file"), "/docs/noop.md"),
			).resolves.toBeNull();
		} finally {
			await lix.close();
		}
	});

	test("omits undefined optional ids when persisting agent turn ranges", async () => {
		const lix = await openLix();
		try {
			await appendAgentTurnCommitRange(lix, {
				id: "range-without-optional-ids",
				sourceId: "codex",
				beforeCommitId: "commit-before",
				afterCommitId: "commit-after",
				sessionId: undefined,
				turnId: undefined,
				startedAt: 1,
				completedAt: 2,
			});

			const [range] = await readAgentTurnCommitRanges(lix);

			expect(range?.id).toBe("range-without-optional-ids");
			expect(Object.hasOwn(range ?? {}, "sessionId")).toBe(false);
			expect(Object.hasOwn(range ?? {}, "turnId")).toBe(false);
		} finally {
			await lix.close();
		}
	});

	test("persists concurrent agent ranges independently without lost updates", async () => {
		const lix = await openLix();
		try {
			const ranges = Array.from({ length: 8 }, (_, index) =>
				agentRange({
					id: `range-concurrent-${index}`,
					beforeCommitId: `commit-before-${index}`,
					afterCommitId: `commit-after-${index}`,
				}),
			);

			await Promise.all(
				ranges.map((range) => appendAgentTurnCommitRange(lix, range)),
			);

			const persistedRanges = await readAgentTurnCommitRanges(lix);
			expect(persistedRanges).toHaveLength(ranges.length);
			expect(persistedRanges.map((range) => range.id).sort()).toEqual(
				ranges.map((range) => range.id).sort(),
			);
		} finally {
			await lix.close();
		}
	});

	test("stores agent turn ranges on the active branch", async () => {
		const lix = await openLix();
		try {
			const mainBranchId = await lix.activeBranchId();
			const draftBranch = await lix.createBranch({ name: "Draft" });
			const mainRange = agentRange({
				id: "range-main",
				beforeCommitId: "commit-main-before",
				afterCommitId: "commit-main-after",
			});
			const draftRange = agentRange({
				id: "range-draft",
				beforeCommitId: "commit-draft-before",
				afterCommitId: "commit-draft-after",
			});

			await appendAgentTurnCommitRange(lix, mainRange);
			expect(
				(await readAgentTurnCommitRanges(lix)).map((range) => range.id),
			).toEqual(["range-main"]);

			await lix.switchBranch({ branchId: draftBranch.id });
			expect(await readAgentTurnCommitRanges(lix)).toEqual([]);

			await appendAgentTurnCommitRange(lix, draftRange);
			expect(
				(await readAgentTurnCommitRanges(lix)).map((range) => range.id),
			).toEqual(["range-draft"]);

			await lix.switchBranch({ branchId: mainBranchId });
			expect(
				(await readAgentTurnCommitRanges(lix)).map((range) => range.id),
			).toEqual(["range-main"]);
		} finally {
			await lix.close();
		}
	});

	test("pins the captured active branch before writing", async () => {
		const lix = await openLix();
		try {
			const mainBranchId = await lix.activeBranchId();
			const draft = await lix.createBranch({ name: "Draft" });
			const originalActiveBranchId = lix.activeBranchId.bind(lix);
			const activeBranchSpy = vi
				.spyOn(lix, "activeBranchId")
				.mockImplementationOnce(async () => {
					const captured = await originalActiveBranchId();
					await lix.switchBranch({ branchId: draft.id });
					return captured;
				});

			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-captured-main",
					beforeCommitId: "commit-captured-before",
					afterCommitId: "commit-captured-after",
				}),
			);
			activeBranchSpy.mockRestore();

			expect(await lix.activeBranchId()).toBe(draft.id);
			expect(
				(await readAgentTurnCommitRanges(lix, mainBranchId)).map(
					(range) => range.id,
				),
			).toContain("range-captured-main");
			expect(
				(await readAgentTurnCommitRanges(lix, draft.id)).map(
					(range) => range.id,
				),
			).not.toContain("range-captured-main");
		} finally {
			vi.restoreAllMocks();
			await lix.close();
		}
	});

	test("stores an explicitly global range as global state", async () => {
		const lix = await openLix();
		try {
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-global",
					beforeCommitId: "commit-global-before",
					afterCommitId: "commit-global-after",
				}),
				{ branchId: GLOBAL_BRANCH_ID },
			);
			const draft = await lix.createBranch({ name: "Draft" });
			await lix.switchBranch({ branchId: draft.id });

			expect(
				(await readAgentTurnCommitRanges(lix)).map((range) => range.id),
			).toContain("range-global");
		} finally {
			await lix.close();
		}
	});

	test("combines unresolved ranges in commit order rather than id order", async () => {
		const lix = await openLix();
		try {
			await writeFile(
				lix,
				fakeUuid("multi-file"),
				"/docs/multi.md",
				"turn 1 before",
			);
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(
				lix,
				fakeUuid("multi-file"),
				"/docs/multi.md",
				"turn 1 after",
			);
			const middleCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "z-earlier-range",
					beforeCommitId,
					afterCommitId: middleCommitId,
				}),
			);
			await writeFile(
				lix,
				fakeUuid("multi-file"),
				"/docs/multi.md",
				"turn 2 after",
			);
			const afterCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "a-later-range",
					beforeCommitId: middleCommitId,
					afterCommitId,
				}),
			);

			const review = await getExternalWriteReview(
				lix,
				fakeUuid("multi-file"),
				"/docs/multi.md",
			);

			expect(review?.reviewId).toBe(
				agentTurnReviewId(fakeUuid("multi-file"), [
					"z-earlier-range",
					"a-later-range",
				]),
			);
			expect(review?.agentTurnRangeIds).toEqual([
				"z-earlier-range",
				"a-later-range",
			]);
			expect(review?.beforeCommitId).toBe(beforeCommitId);
			expect(review?.afterCommitId).toBe(afterCommitId);
			await expectReviewData(lix, review, "turn 1 before", "turn 2 after");
		} finally {
			await lix.close();
		}
	});

	test("batches pending paths without changing added, resolved, stale, or duplicate-file behavior", async () => {
		const lix = await openLix();
		try {
			await Promise.all([
				writeFile(
					lix,
					fakeUuid("unchanged-file"),
					"/docs/unchanged.md",
					"same",
				),
				writeFile(
					lix,
					fakeUuid("resolved-file"),
					"/docs/resolved.md",
					"before",
				),
				writeFile(lix, fakeUuid("stale-file"), "/docs/stale.md", "before"),
				writeFile(
					lix,
					fakeUuid("duplicate-file"),
					"/docs/duplicate.md",
					"before",
				),
			]);
			const beforeCommitId = await activeCommitId(lix);
			await Promise.all([
				writeFile(lix, fakeUuid("added-file"), "/docs/added.md", "added"),
				writeFile(lix, fakeUuid("resolved-file"), "/docs/resolved.md", "after"),
				writeFile(lix, fakeUuid("stale-file"), "/docs/stale.md", "range after"),
				writeFile(
					lix,
					fakeUuid("duplicate-file"),
					"/docs/duplicate.md",
					"after",
				),
			]);
			const afterCommitId = await activeCommitId(lix);
			await writeFile(
				lix,
				fakeUuid("stale-file"),
				"/docs/stale.md",
				"current after",
			);
			const range = agentRange({
				id: "range-batched-paths",
				beforeCommitId,
				afterCommitId,
			});

			const pendingPaths = await getPendingExternalWriteReviewPaths(
				lix,
				[
					{ fileId: fakeUuid("added-file"), path: "/docs/added.md" },
					{ fileId: fakeUuid("unchanged-file"), path: "/docs/unchanged.md" },
					{ fileId: fakeUuid("resolved-file"), path: "/docs/resolved.md" },
					{ fileId: fakeUuid("stale-file"), path: "/docs/stale.md" },
					{ fileId: fakeUuid("duplicate-file"), path: "/docs/duplicate.md" },
					{
						fileId: fakeUuid("duplicate-file"),
						path: "/alternate/duplicate.md",
					},
					{ fileId: fakeUuid("missing-file"), path: "/docs/missing.md" },
				],
				[range],
				new Set([
					agentTurnReviewId(fakeUuid("resolved-file"), ["range-batched-paths"]),
				]),
			);

			expect([...pendingPaths].sort()).toEqual([
				"/alternate/duplicate.md",
				"/docs/added.md",
				"/docs/duplicate.md",
			]);
		} finally {
			await lix.close();
		}
	});

	test("reads two files across 50 ranges in one bounded history statement", async () => {
		const lix = await openLix();
		try {
			const files = [
				{ fileId: fakeUuid("bounded-history-a"), path: "/docs/a.md" },
				{ fileId: fakeUuid("bounded-history-b"), path: "/docs/b.md" },
			] as const;
			await Promise.all(
				files.map((file) => writeFile(lix, file.fileId, file.path, "before")),
			);
			const ranges: AgentTurnCommitRange[] = [];
			let beforeCommitId = await activeCommitId(lix);
			for (let index = 0; index < 50; index += 1) {
				await Promise.all(
					files.map((file) =>
						writeFile(lix, file.fileId, file.path, `after ${index}`),
					),
				);
				const afterCommitId = await activeCommitId(lix);
				ranges.push({
					...agentRange({
						id: `bounded-history-${index}`,
						beforeCommitId,
						afterCommitId,
					}),
					startedAt: index * 2,
					completedAt: index * 2 + 1,
				});
				beforeCommitId = afterCommitId;
			}
			const execute = vi.spyOn(lix, "execute");

			const pendingPaths = await getPendingExternalWriteReviewPaths(
				lix,
				files,
				ranges,
			);

			expect([...pendingPaths].sort()).toEqual(["/docs/a.md", "/docs/b.md"]);
			expect(historyReadCount(execute)).toBe(1);
			const historyStatement = execute.mock.calls
				.map(([statement]) => String(statement))
				.find((statement) => statement.includes("lix_history('lix_file'"));
			expect(historyStatement).toBeDefined();
			const expectedSnapshotBranches = 2 * 51;
			expect(historyStatement?.match(/lix_history\('lix_file'/gi)).toHaveLength(
				expectedSnapshotBranches,
			);
			expect(historyStatement?.match(/where id =/gi)).toHaveLength(
				expectedSnapshotBranches,
			);
			expect(
				historyStatement?.match(/order by lixcol_depth asc/gi),
			).toHaveLength(expectedSnapshotBranches);
			expect(historyStatement?.match(/limit 1/gi)).toHaveLength(
				expectedSnapshotBranches,
			);
		} finally {
			await lix.close();
		}
	});

	test("uses global ancestry ordering when batching multiple pending ranges", async () => {
		const lix = await openLix();
		try {
			const file = {
				fileId: fakeUuid("batched-multi-file"),
				path: "/docs/multi.md",
			};
			await writeFile(lix, file.fileId, file.path, "turn 1 before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, file.fileId, file.path, "turn 1 after");
			const middleCommitId = await activeCommitId(lix);
			await writeFile(lix, file.fileId, file.path, "turn 2 after");
			const afterCommitId = await activeCommitId(lix);

			const pendingPaths = await getPendingExternalWriteReviewPaths(
				lix,
				[file],
				[
					agentRange({
						id: "a-later-range",
						beforeCommitId: middleCommitId,
						afterCommitId,
					}),
					agentRange({
						id: "z-earlier-range",
						beforeCommitId,
						afterCommitId: middleCommitId,
					}),
				],
			);

			expect([...pendingPaths]).toEqual([file.path]);
		} finally {
			await lix.close();
		}
	});

	test("round-trips structured range ids without delimiter collisions", () => {
		// Lix now requires canonical UUID file ids, so the file id itself can no
		// longer carry delimiter characters; the range ids below still exercise
		// delimiter handling inside the review id encoding.
		const fileId = fakeUuid("file:with,delimiters");
		const rangeIds = [
			JSON.stringify(["atelier-diff", "codex", "session,1"]),
			"plain,range:id",
		];
		const reviewId = agentTurnReviewId(fileId, rangeIds);

		expect(agentTurnReviewRangeIds(reviewId, fileId)).toEqual(rangeIds);
		expect(agentTurnReviewRangeIds(reviewId, fakeUuid("other-file"))).toEqual(
			[],
		);
		expect(agentTurnReviewRangeIds(`${fileId}:legacy-range`, fileId)).toEqual(
			[],
		);
	});

	test("excludes resolved ranges before combining a later review", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("resolved-then-later-file");
			const path = "/docs/resolved-then-later.md";
			await writeFile(lix, fileId, path, "before range A");
			const beforeRangeA = await activeCommitId(lix);
			await writeFile(lix, fileId, path, "after range A");
			const afterRangeA = await activeCommitId(lix);
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-resolved-a",
					beforeCommitId: beforeRangeA,
					afterCommitId: afterRangeA,
				}),
			);
			await writeFile(lix, fileId, path, "after range B");
			const afterRangeB = await activeCommitId(lix);
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-pending-b",
					beforeCommitId: afterRangeA,
					afterCommitId: afterRangeB,
				}),
			);

			const review = await getExternalWriteReview(lix, fileId, path, {
				resolvedReviewIds: new Set([
					agentTurnReviewId(fileId, ["range-resolved-a"]),
				]),
			});

			expect(review?.reviewId).toBe(
				agentTurnReviewId(fileId, ["range-pending-b"]),
			);
			expect(review?.agentTurnRangeIds).toEqual(["range-pending-b"]);
			expect(review?.beforeCommitId).toBe(afterRangeA);
			expect(review?.afterCommitId).toBe(afterRangeB);
			await expectReviewData(lix, review, "after range A", "after range B");
		} finally {
			await lix.close();
		}
	});

	test("updates an already mounted review hook when the persisted range appears", async () => {
		const lix = await openLix();
		let utils: ReturnType<typeof render> | undefined;
		try {
			await writeFile(
				lix,
				fakeUuid("live-file"),
				"/docs/live.md",
				"live before",
			);
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(
				lix,
				fakeUuid("live-file"),
				"/docs/live.md",
				"live after",
			);
			const afterCommitId = await activeCommitId(lix);
			const activeBranchId = await lix.activeBranchId();
			const reviews: Array<ExternalWriteReview | null> = [];

			await act(async () => {
				utils = render(
					createElement(
						LixProvider as ComponentType<{ lix: Lix }>,
						{ lix },
						createElement(
							Suspense,
							{ fallback: null },
							createElement(ExternalWriteReviewProbe, {
								fileId: fakeUuid("live-file"),
								path: "/docs/live.md",
								activeBranchId,
								onReview: (review) => reviews.push(review),
							}),
						),
					),
				);
			});

			await waitFor(() => {
				expect(reviews.length).toBeGreaterThan(0);
				expect(reviews.at(-1)).toBeNull();
			});

			await act(async () => {
				await appendAgentTurnCommitRange(
					lix,
					agentRange({
						id: "range-live-hook",
						beforeCommitId,
						afterCommitId,
					}),
				);
			});

			await waitFor(() => {
				const review = reviews.at(-1);
				expect(review?.agentTurnRangeIds).toEqual(["range-live-hook"]);
				expect(review?.beforeCommitId).toBe(beforeCommitId);
				expect(review?.afterCommitId).toBe(afterCommitId);
			});
		} finally {
			await act(async () => {
				utils?.unmount();
			});
			await lix.close();
		}
	});

	test("keeps a mounted review hook pinned when the primary session switches branches", async () => {
		const lix = await openLix();
		let utils: ReturnType<typeof render> | undefined;
		try {
			const fileId = fakeUuid("pinned-live-file");
			const path = "/docs/pinned-live.md";
			await writeFile(lix, fileId, path, "pinned before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, fileId, path, "pinned after");
			const afterCommitId = await activeCommitId(lix);
			const mainBranchId = await lix.activeBranchId();
			const draftBranch = await lix.createBranch({ name: "Draft" });
			const reviews: Array<ExternalWriteReview | null> = [];

			await act(async () => {
				utils = render(
					createElement(
						LixProvider as ComponentType<{ lix: Lix }>,
						{ lix },
						createElement(
							Suspense,
							{ fallback: null },
							createElement(ExternalWriteReviewProbe, {
								fileId,
								path,
								activeBranchId: mainBranchId,
								onReview: (review) => reviews.push(review),
							}),
						),
					),
				);
			});

			await waitFor(() => expect(reviews.at(-1)).toBeNull());
			await lix.switchBranch({ branchId: draftBranch.id });
			await act(async () => {
				await appendAgentTurnCommitRange(
					lix,
					agentRange({
						id: "range-pinned-live-hook",
						beforeCommitId,
						afterCommitId,
					}),
					{ branchId: mainBranchId },
				);
			});

			await waitFor(() => {
				const review = reviews.at(-1);
				expect(review?.agentTurnRangeIds).toEqual(["range-pinned-live-hook"]);
				expect(review?.beforeCommitId).toBe(beforeCommitId);
				expect(review?.afterCommitId).toBe(afterCommitId);
			});
			expect(await lix.activeBranchId()).toBe(draftBranch.id);
		} finally {
			await act(async () => {
				utils?.unmount();
			});
			await lix.close();
		}
	});

	test("never returns a review calculated for the previous file key", async () => {
		const lix = await openLix();
		let utils: ReturnType<typeof render> | undefined;
		try {
			await writeFile(lix, fakeUuid("keyed-file"), "/docs/keyed.md", "before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, fakeUuid("keyed-file"), "/docs/keyed.md", "after");
			const afterCommitId = await activeCommitId(lix);
			const activeBranchId = await lix.activeBranchId();
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-keyed-review",
					beforeCommitId,
					afterCommitId,
				}),
			);
			const renders: Array<ExternalWriteReview | null> = [];
			const renderProbe = (path: string) =>
				createElement(
					LixProvider as ComponentType<{ lix: Lix }>,
					{ lix },
					createElement(
						Suspense,
						{ fallback: null },
						createElement(ExternalWriteReviewRenderProbe, {
							fileId: fakeUuid("keyed-file"),
							path,
							activeBranchId,
							onRender: (review) => renders.push(review),
						}),
					),
				);

			await act(async () => {
				utils = render(renderProbe("/docs/keyed.md"));
			});
			await waitFor(() => {
				expect(renders.at(-1)?.path).toBe("/docs/keyed.md");
			});

			const firstRenderForNewKey = renders.length;
			await act(async () => {
				utils?.rerender(renderProbe("/docs/renamed-keyed.md"));
			});

			expect(renders[firstRenderForNewKey]).toBeNull();
			await waitFor(() => {
				expect(renders.at(-1)?.path).toBe("/docs/renamed-keyed.md");
			});
		} finally {
			await act(async () => {
				utils?.unmount();
			});
			await lix.close();
		}
	});

	test("never returns history bytes for the previous review key", async () => {
		const lix = await openLix();
		let utils: ReturnType<typeof render> | undefined;
		try {
			await writeFile(lix, fakeUuid("data-a"), "/docs/data-a.md", "a before");
			const aBeforeCommitId = await activeCommitId(lix);
			await writeFile(lix, fakeUuid("data-a"), "/docs/data-a.md", "a after");
			const aAfterCommitId = await activeCommitId(lix);
			await writeFile(lix, fakeUuid("data-b"), "/docs/data-b.md", "b before");
			const bBeforeCommitId = await activeCommitId(lix);
			await writeFile(lix, fakeUuid("data-b"), "/docs/data-b.md", "b after");
			const bAfterCommitId = await activeCommitId(lix);
			const reviewA: ExternalWriteReview = {
				fileId: fakeUuid("data-a"),
				path: "/docs/data-a.md",
				reviewId: "review-data-a",
				beforeCommitId: aBeforeCommitId,
				afterCommitId: aAfterCommitId,
				agentTurnRangeIds: ["range-data-a"],
			};
			const reviewB: ExternalWriteReview = {
				fileId: fakeUuid("data-b"),
				path: "/docs/data-b.md",
				reviewId: "review-data-b",
				beforeCommitId: bBeforeCommitId,
				afterCommitId: bAfterCommitId,
				agentTurnRangeIds: ["range-data-b"],
			};
			const renders: string[] = [];
			const renderProbe = (review: ExternalWriteReview) =>
				createElement(
					LixProvider as ComponentType<{ lix: Lix }>,
					{ lix },
					createElement(
						Suspense,
						{ fallback: null },
						createElement(ExternalWriteReviewDataRenderProbe, {
							review,
							onRender: (value) => renders.push(value),
						}),
					),
				);

			await act(async () => {
				utils = render(renderProbe(reviewA));
			});
			await waitFor(() => {
				expect(renders.at(-1)).toBe("a before -> a after");
			});

			const firstRenderForReviewB = renders.length;
			await act(async () => {
				utils?.rerender(renderProbe(reviewB));
			});
			await waitFor(() => {
				expect(renders.at(-1)).toBe("b before -> b after");
			});
			expect(renders.slice(firstRenderForReviewB)).not.toContain(
				"a before -> a after",
			);
		} finally {
			await act(async () => {
				utils?.unmount();
			});
			await lix.close();
		}
	});
});

function ExternalWriteReviewProbe({
	fileId,
	path,
	activeBranchId,
	onReview,
}: {
	readonly fileId: string;
	readonly path: string;
	readonly activeBranchId: string;
	readonly onReview: (review: ExternalWriteReview | null) => void;
}) {
	const review = useExternalWriteReview({
		fileId,
		path,
		activeBranchId,
	});
	useEffect(() => {
		onReview(review);
	}, [onReview, review]);
	return null;
}

function ExternalWriteReviewRenderProbe({
	fileId,
	path,
	activeBranchId,
	onRender,
}: {
	readonly fileId: string;
	readonly path: string;
	readonly activeBranchId: string;
	readonly onRender: (review: ExternalWriteReview | null) => void;
}) {
	const review = useExternalWriteReview({
		fileId,
		path,
		activeBranchId,
	});
	onRender(review);
	return null;
}

function ExternalWriteReviewDataRenderProbe({
	review,
	onRender,
}: {
	readonly review: ExternalWriteReview;
	readonly onRender: (value: string) => void;
}) {
	const data = useExternalWriteReviewData(review);
	onRender(
		data
			? `${decode(data.beforeData)} -> ${decode(data.afterData)}`
			: "loading",
	);
	return null;
}

async function writeFile(
	lix: Lix,
	id: string,
	path: string,
	text: string,
): Promise<void> {
	await qb(lix)
		.insertInto("lix_file")
		.values({ id, path, content: encoder.encode(text) })
		.onConflict((oc) =>
			oc.column("id").doUpdateSet({ path, content: encoder.encode(text) }),
		)
		.execute();
}

async function activeCommitId(lix: Lix): Promise<string> {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	const commitId = result.rows[0]?.get("commit_id");
	if (typeof commitId !== "string") {
		throw new Error("Missing active commit id");
	}
	return commitId;
}

function historyReadCount(execute: ReturnType<typeof vi.spyOn>): number {
	return execute.mock.calls.filter(([statement]: unknown[]) =>
		String(statement).includes("lix_history('lix_file'"),
	).length;
}

function agentRange(
	overrides: Pick<
		AgentTurnCommitRange,
		"id" | "beforeCommitId" | "afterCommitId"
	>,
): AgentTurnCommitRange {
	return {
		sourceId: "codex",
		sessionId: "session-1",
		turnId: "turn-1",
		startedAt: 1,
		completedAt: 2,
		...overrides,
	};
}

async function expectReviewData(
	lix: Lix,
	review: ExternalWriteReview | null | undefined,
	beforeText: string,
	afterText: string,
): Promise<void> {
	expect(review).not.toBeNull();
	expect(review).not.toBeUndefined();
	const data = await getExternalWriteReviewData(
		lix,
		review as ExternalWriteReview,
	);
	expect(decode(data?.beforeData)).toBe(beforeText);
	expect(decode(data?.afterData)).toBe(afterText);
}

function decode(value: Uint8Array | undefined): string {
	return decoder.decode(value ?? new Uint8Array());
}
