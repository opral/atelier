import { useEffect, useMemo, useState } from "react";
import type { Lix } from "@lix-js/sdk";
import { useLix, useQuery } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
} from "@/extension-runtime/external-write-review";
import {
	AGENT_TURN_COMMIT_RANGE_KEY,
	agentTurnCommitRangesFromValues,
	agentTurnReviewId,
	agentTurnReviewRangeIds,
	readAgentTurnCommitRanges,
	type AgentTurnCommitRange,
} from "./agent-turn-review-range";

type FileHistoryRow = {
	readonly data: unknown;
};

type ResolvedExternalWriteReview = {
	readonly key: string;
	readonly review: ExternalWriteReview | null;
};

type ResolvedExternalWriteReviewData = {
	readonly key: string;
	readonly data: ExternalWriteReviewData | null;
};

type AgentTurnFileData = ExternalWriteReviewData & {
	readonly beforeExists: boolean;
};

const EMPTY_FILE_DATA = new Uint8Array();

export type ExternalWriteReviewFile = {
	readonly fileId: string;
	readonly path: string;
};

export async function getExternalWriteReview(
	lix: Lix,
	fileId: string,
	path: string,
	options?: {
		readonly branchId?: string;
		readonly resolvedReviewIds?: ReadonlySet<string>;
	},
): Promise<ExternalWriteReview | null> {
	const ranges = await readAgentTurnCommitRanges(lix, options?.branchId);
	const review = await getAgentTurnExternalWriteReview(
		lix,
		fileId,
		path,
		ranges,
		options?.resolvedReviewIds,
	);
	return review && !options?.resolvedReviewIds?.has(review.reviewId)
		? review
		: null;
}

export async function getPendingExternalWriteReviewPaths(
	lix: Lix,
	files: readonly ExternalWriteReviewFile[],
	ranges?: readonly AgentTurnCommitRange[],
	resolvedReviewIds: ReadonlySet<string> = new Set(),
): Promise<Set<string>> {
	const pendingPaths = new Set<string>();
	const resolvedRanges = ranges ?? (await readAgentTurnCommitRanges(lix));
	if (files.length === 0 || resolvedRanges.length === 0) {
		return pendingPaths;
	}
	await Promise.all(
		files.map(async (file) => {
			const review = await getAgentTurnExternalWriteReview(
				lix,
				file.fileId,
				file.path,
				resolvedRanges,
				resolvedReviewIds,
			);
			if (review && !resolvedReviewIds.has(review.reviewId)) {
				pendingPaths.add(file.path);
			}
		}),
	);
	return pendingPaths;
}

export function useExternalWriteReview(args: {
	readonly fileId?: string | null;
	readonly path?: string | null;
	readonly activeBranchId: string;
	readonly resolvedReviewIds?: readonly string[];
}): ExternalWriteReview | null {
	const lix = useLix();
	const rangeRows = useQuery<{
		value: unknown;
		lixcol_branch_id: string | null;
	}>((queryLix) =>
		qb(queryLix)
			.selectFrom("lix_key_value_by_branch")
			.select(["value", "lixcol_branch_id"])
			.where("key", "like", `${AGENT_TURN_COMMIT_RANGE_KEY}%`)
			.where("lixcol_branch_id", "=", args.activeBranchId),
	);
	const activeRangeValues = useMemo(
		() =>
			rangeRows
				.filter((row) => row.lixcol_branch_id === args.activeBranchId)
				.map((row) => row.value),
		[args.activeBranchId, rangeRows],
	);
	const ranges = useMemo(
		() => agentTurnCommitRangesFromValues(activeRangeValues),
		[activeRangeValues],
	);
	const resolvedReviewKey = JSON.stringify(
		[...(args.resolvedReviewIds ?? [])].sort(),
	);
	const resolvedReviewIdSet = useMemo(
		() => new Set<string>(JSON.parse(resolvedReviewKey)),
		[resolvedReviewKey],
	);
	const reviewKey =
		args.fileId && args.path
			? JSON.stringify([
					args.activeBranchId,
					args.fileId,
					args.path,
					activeRangeValues,
					resolvedReviewKey,
				])
			: null;
	const [resolvedReview, setResolvedReview] =
		useState<ResolvedExternalWriteReview | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (!reviewKey || !args.fileId || !args.path) return;
		const loadReview =
			ranges.length === 0
				? Promise.resolve(null)
				: getAgentTurnExternalWriteReview(
						lix,
						args.fileId,
						args.path,
						ranges,
						resolvedReviewIdSet,
					);
		void loadReview
			.then((nextReview) => {
				if (!cancelled) {
					setResolvedReview({
						key: reviewKey,
						review:
							nextReview && !resolvedReviewIdSet.has(nextReview.reviewId)
								? nextReview
								: null,
					});
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					console.warn("[agent-turn-review] failed to load review", error);
					setResolvedReview({ key: reviewKey, review: null });
				}
			});
		return () => {
			cancelled = true;
		};
	}, [lix, args.fileId, args.path, ranges, resolvedReviewIdSet, reviewKey]);

	return resolvedReview?.key === reviewKey ? resolvedReview.review : null;
}

export function useExternalWriteReviewData(
	review: ExternalWriteReview | null | undefined,
): ExternalWriteReviewData | null {
	const reviewKey = review
		? JSON.stringify([
				review.fileId,
				review.reviewId,
				review.beforeCommitId,
				review.afterCommitId,
			])
		: null;
	const lix = useLix();
	const [resolvedData, setResolvedData] =
		useState<ResolvedExternalWriteReviewData | null>(null);

	useEffect(() => {
		if (!review || !reviewKey) return;
		let cancelled = false;
		void getExternalWriteReviewData(lix, review)
			.then((data) => {
				if (!cancelled) setResolvedData({ key: reviewKey, data });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				console.warn("[agent-turn-review] failed to load review data", error);
				setResolvedData({ key: reviewKey, data: null });
			});
		return () => {
			cancelled = true;
		};
	}, [lix, review, reviewKey]);

	return resolvedData?.key === reviewKey ? resolvedData.data : null;
}

export async function getExternalWriteReviewData(
	lix: Lix,
	review: ExternalWriteReview,
): Promise<ExternalWriteReviewData | null> {
	const data = await getRangeFileData(lix, review.fileId, {
		beforeCommitId: review.beforeCommitId,
		afterCommitId: review.afterCommitId,
	});
	return data
		? { beforeData: data.beforeData, afterData: data.afterData }
		: null;
}

export async function getFileDataAtCommit(
	lix: Lix,
	fileId: string,
	commitId: string,
): Promise<Uint8Array | null> {
	const snapshot = await getFileHistorySnapshotAtCommit(lix, fileId, commitId);
	return snapshot ? decodeFileDataToBytes(snapshot.data) : null;
}

async function getAgentTurnExternalWriteReview(
	lix: Lix,
	fileId: string,
	path: string,
	ranges: readonly AgentTurnCommitRange[],
	resolvedReviewIds: ReadonlySet<string> = new Set(),
): Promise<ExternalWriteReview | null> {
	const relevantRanges: AgentTurnCommitRange[] = [];
	const resolvedRangeIds = resolvedAgentTurnRangeIds(fileId, resolvedReviewIds);
	for (const range of ranges) {
		if (resolvedRangeIds.has(range.id)) continue;
		if (range.beforeCommitId === range.afterCommitId) continue;
		if (range.clearedFileIds?.includes(fileId)) continue;
		const data = await getRangeFileData(lix, fileId, range);
		if (!data) continue;
		if (data.beforeExists && fileBytesEqual(data.beforeData, data.afterData)) {
			continue;
		}
		relevantRanges.push(range);
	}
	if (relevantRanges.length === 0) return null;
	const orderedRanges = await orderAgentTurnRangesByCommitAncestry(
		lix,
		relevantRanges,
	);
	const firstRange = orderedRanges[0];
	const lastRange = orderedRanges[orderedRanges.length - 1];
	if (!firstRange || !lastRange) return null;
	const data = await getRangeFileData(lix, fileId, {
		beforeCommitId: firstRange.beforeCommitId,
		afterCommitId: lastRange.afterCommitId,
	});
	if (!data) return null;
	if (data.beforeExists && fileBytesEqual(data.beforeData, data.afterData)) {
		return null;
	}
	const current = await qb(lix)
		.selectFrom("lix_file")
		.select("data")
		.where("id", "=", fileId)
		.limit(1)
		.executeTakeFirst();
	if (
		!current ||
		!fileBytesEqual(decodeFileDataToBytes(current.data), data.afterData)
	) {
		return null;
	}
	const rangeIds = orderedRanges.map((range) => range.id);
	return {
		fileId,
		path,
		reviewId: agentTurnReviewId(fileId, rangeIds),
		beforeCommitId: firstRange.beforeCommitId,
		afterCommitId: lastRange.afterCommitId,
		agentTurnRangeIds: rangeIds,
	};
}

function resolvedAgentTurnRangeIds(
	fileId: string,
	resolvedReviewIds: ReadonlySet<string>,
): Set<string> {
	const resolvedRangeIds = new Set<string>();
	for (const reviewId of resolvedReviewIds) {
		for (const rangeId of agentTurnReviewRangeIds(reviewId, fileId)) {
			resolvedRangeIds.add(rangeId);
		}
	}
	return resolvedRangeIds;
}

async function orderAgentTurnRangesByCommitAncestry(
	lix: Lix,
	ranges: readonly AgentTurnCommitRange[],
): Promise<AgentTurnCommitRange[]> {
	if (ranges.length < 2) return [...ranges];
	const result = await lix.execute(
		`
			SELECT observed_commit_id AS commit_id, MAX(depth) AS depth
			FROM lix_state_history
			WHERE start_commit_id = lix_active_branch_commit_id()
				AND schema_key = 'lix_commit'
			GROUP BY observed_commit_id
		`,
	);
	const depthByCommit = new Map<string, number>();
	for (const row of result.rows) {
		const commitId = row.get("commit_id");
		const depth = row.get("depth");
		if (typeof commitId === "string" && typeof depth === "number") {
			depthByCommit.set(commitId, depth);
		}
	}
	return [...ranges].sort((left, right) => {
		const afterDepthDifference =
			(depthByCommit.get(right.afterCommitId) ?? 0) -
			(depthByCommit.get(left.afterCommitId) ?? 0);
		if (afterDepthDifference !== 0) return afterDepthDifference;
		const beforeDepthDifference =
			(depthByCommit.get(right.beforeCommitId) ?? 0) -
			(depthByCommit.get(left.beforeCommitId) ?? 0);
		return (
			beforeDepthDifference ||
			left.completedAt - right.completedAt ||
			left.id.localeCompare(right.id)
		);
	});
}

async function getRangeFileData(
	lix: Lix,
	fileId: string,
	range: Pick<AgentTurnCommitRange, "beforeCommitId" | "afterCommitId">,
): Promise<AgentTurnFileData | null> {
	const [beforeData, afterData] = await Promise.all([
		getFileDataAtCommit(lix, fileId, range.beforeCommitId),
		getFileDataAtCommit(lix, fileId, range.afterCommitId),
	]);
	if (!afterData) return null;
	return {
		beforeData: beforeData ?? EMPTY_FILE_DATA,
		afterData,
		beforeExists: beforeData !== null,
	};
}

function fileHistorySnapshotQuery(lix: Lix, fileId: string, commitId: string) {
	return qb(lix)
		.selectFrom("lix_file_history")
		.select("data")
		.where("lixcol_start_commit_id", "=", commitId)
		.where("id", "=", fileId)
		.orderBy("lixcol_depth", "asc")
		.limit(1);
}

async function getFileHistorySnapshotAtCommit(
	lix: Lix,
	fileId: string,
	commitId: string,
): Promise<FileHistoryRow | null> {
	const row = (await fileHistorySnapshotQuery(
		lix,
		fileId,
		commitId,
	).executeTakeFirst()) as FileHistoryRow | undefined;
	return row ?? null;
}

function fileBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}
