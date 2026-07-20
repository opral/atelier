import { createElement, Suspense, useEffect, type ComponentType } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { qb } from "@/lib/lix-kysely";
import type { ExternalWriteReview } from "@/extension-runtime/external-write-review";
import {
	getExternalWriteReview,
	getExternalWriteReviewData,
	getPendingExternalWriteReviewPaths,
	useExternalWriteReview,
	useExternalWriteReviewData,
} from "./external-write-review-history";
import {
	appendAgentTurnCommitRange,
	agentTurnCommitRangesFromValues,
	agentTurnReviewId,
	agentTurnReviewRangeIds,
	readAgentTurnCommitRanges,
	type AgentTurnCommitRange,
} from "./agent-turn-review-range";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("getExternalWriteReview", () => {
	test("returns no review when no agent turn range exists", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "history-file", "/docs/history.md", "before");
			await writeFile(lix, "history-file", "/docs/history.md", "after");

			const review = await getExternalWriteReview(
				lix,
				"history-file",
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
			await writeFile(lix, "agent-file", "/docs/agent.md", "turn before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "agent-file", "/docs/agent.md", "intermediate");
			await writeFile(lix, "agent-file", "/docs/agent.md", "turn after");
			const afterCommitId = await activeCommitId(lix);

			await appendAgentTurnCommitRange(
				lix,
				agentRange({ id: "range-1", beforeCommitId, afterCommitId }),
			);

			const review = await getExternalWriteReview(
				lix,
				"agent-file",
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

	test("uses empty before data for a file created during an agent turn", async () => {
		const lix = await openLix();
		try {
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(
				lix,
				"created-file",
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
				"created-file",
				"/docs/created.md",
			);

			expect(review?.agentTurnRangeIds).toEqual(["range-created"]);
			await expectReviewData(lix, review, "", "created during turn");
		} finally {
			await lix.close();
		}
	});

	test("uses the nearest inherited file history snapshot at the before commit", async () => {
		const lix = await openLix();
		try {
			await writeFile(
				lix,
				"inherited-file",
				"/docs/inherited.md",
				"inherited before",
			);
			await writeFile(
				lix,
				"other-file",
				"/docs/other.md",
				"unrelated turn start",
			);
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(
				lix,
				"inherited-file",
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
				"inherited-file",
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
			await writeFile(lix, "noop-file", "/docs/noop.md", "before");
			const commitId = await activeCommitId(lix);
			await writeFile(lix, "noop-file", "/docs/noop.md", "after");

			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "range-noop",
					beforeCommitId: commitId,
					afterCommitId: commitId,
				}),
			);

			await expect(
				getExternalWriteReview(lix, "noop-file", "/docs/noop.md"),
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

	test("preserves historical global clears when a normalized row has the same id", () => {
		const normalized = agentRange({
			id: "range-duplicate",
			beforeCommitId: "before-duplicate",
			afterCommitId: "after-duplicate",
		});
		const legacy = {
			ranges: [{ ...normalized, clearedFileIds: ["historically-closed"] }],
		};

		expect(
			agentTurnCommitRangesFromValues([normalized, legacy])[0]?.clearedFileIds,
		).toEqual(["historically-closed"]);
	});

	test("ignores shared clears attached to normalized range events", () => {
		const normalized = agentRange({
			id: "range-normalized-clear",
			beforeCommitId: "before-normalized-clear",
			afterCommitId: "after-normalized-clear",
		});

		expect(
			agentTurnCommitRangesFromValues([
				{ ...normalized, clearedFileIds: ["must-stay-private"] },
			])[0]?.clearedFileIds,
		).toBeUndefined();
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

	test("combines unresolved ranges in commit order rather than id order", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, "multi-file", "/docs/multi.md", "turn 1 before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "multi-file", "/docs/multi.md", "turn 1 after");
			const middleCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(
				lix,
				agentRange({
					id: "z-earlier-range",
					beforeCommitId,
					afterCommitId: middleCommitId,
				}),
			);
			await writeFile(lix, "multi-file", "/docs/multi.md", "turn 2 after");
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
				"multi-file",
				"/docs/multi.md",
			);

			expect(review?.reviewId).toBe(
				agentTurnReviewId("multi-file", ["z-earlier-range", "a-later-range"]),
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
				writeFile(lix, "unchanged-file", "/docs/unchanged.md", "same"),
				writeFile(lix, "cleared-file", "/docs/cleared.md", "before"),
				writeFile(lix, "resolved-file", "/docs/resolved.md", "before"),
				writeFile(lix, "stale-file", "/docs/stale.md", "before"),
				writeFile(lix, "duplicate-file", "/docs/duplicate.md", "before"),
			]);
			const beforeCommitId = await activeCommitId(lix);
			await Promise.all([
				writeFile(lix, "added-file", "/docs/added.md", "added"),
				writeFile(lix, "cleared-file", "/docs/cleared.md", "after"),
				writeFile(lix, "resolved-file", "/docs/resolved.md", "after"),
				writeFile(lix, "stale-file", "/docs/stale.md", "range after"),
				writeFile(lix, "duplicate-file", "/docs/duplicate.md", "after"),
			]);
			const afterCommitId = await activeCommitId(lix);
			await writeFile(lix, "stale-file", "/docs/stale.md", "current after");
			const range = {
				...agentRange({
					id: "range-batched-paths",
					beforeCommitId,
					afterCommitId,
				}),
				clearedFileIds: ["cleared-file"],
			};

			const pendingPaths = await getPendingExternalWriteReviewPaths(
				lix,
				[
					{ fileId: "added-file", path: "/docs/added.md" },
					{ fileId: "unchanged-file", path: "/docs/unchanged.md" },
					{ fileId: "cleared-file", path: "/docs/cleared.md" },
					{ fileId: "resolved-file", path: "/docs/resolved.md" },
					{ fileId: "stale-file", path: "/docs/stale.md" },
					{ fileId: "duplicate-file", path: "/docs/duplicate.md" },
					{ fileId: "duplicate-file", path: "/alternate/duplicate.md" },
					{ fileId: "missing-file", path: "/docs/missing.md" },
				],
				[range],
				new Set([agentTurnReviewId("resolved-file", ["range-batched-paths"])]),
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

	test("uses global ancestry ordering when batching multiple pending ranges", async () => {
		const lix = await openLix();
		try {
			const file = { fileId: "batched-multi-file", path: "/docs/multi.md" };
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
		const fileId = "file:with,delimiters";
		const rangeIds = [
			JSON.stringify(["atelier-diff", "codex", "session,1"]),
			"plain,range:id",
		];
		const reviewId = agentTurnReviewId(fileId, rangeIds);

		expect(agentTurnReviewRangeIds(reviewId, fileId)).toEqual(rangeIds);
		expect(agentTurnReviewRangeIds(reviewId, "other-file")).toEqual([]);
	});

	test("excludes resolved ranges before combining a later review", async () => {
		const lix = await openLix();
		try {
			const fileId = "resolved-then-later-file";
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
			await writeFile(lix, "live-file", "/docs/live.md", "live before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "live-file", "/docs/live.md", "live after");
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
								fileId: "live-file",
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

	test("never returns a review calculated for the previous file key", async () => {
		const lix = await openLix();
		let utils: ReturnType<typeof render> | undefined;
		try {
			await writeFile(lix, "keyed-file", "/docs/keyed.md", "before");
			const beforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "keyed-file", "/docs/keyed.md", "after");
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
							fileId: "keyed-file",
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
			await writeFile(lix, "data-a", "/docs/data-a.md", "a before");
			const aBeforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "data-a", "/docs/data-a.md", "a after");
			const aAfterCommitId = await activeCommitId(lix);
			await writeFile(lix, "data-b", "/docs/data-b.md", "b before");
			const bBeforeCommitId = await activeCommitId(lix);
			await writeFile(lix, "data-b", "/docs/data-b.md", "b after");
			const bAfterCommitId = await activeCommitId(lix);
			const reviewA: ExternalWriteReview = {
				fileId: "data-a",
				path: "/docs/data-a.md",
				reviewId: "review-data-a",
				beforeCommitId: aBeforeCommitId,
				afterCommitId: aAfterCommitId,
				agentTurnRangeIds: ["range-data-a"],
			};
			const reviewB: ExternalWriteReview = {
				fileId: "data-b",
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
		.values({ id, path, data: encoder.encode(text) })
		.onConflict((oc) =>
			oc.column("id").doUpdateSet({ path, data: encoder.encode(text) }),
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
