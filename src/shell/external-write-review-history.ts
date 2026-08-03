import { useEffect, useMemo, useRef, useState } from "react";
import type { Lix } from "@lix-js/sdk";
import { useLix, useQuery } from "@/lib/lix-react";
import { selectFileHistory } from "@/lib/lix-file-history";
import { qb, sql } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { selectWorkingChanges } from "@/queries";
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
	readonly content: unknown;
};

type BatchedFileHistoryRow = FileHistoryRow & {
	readonly id: string;
	readonly commit_id: string;
	readonly depth: number;
};

type CurrentFileRow = {
	readonly id: string;
	readonly content: unknown;
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

type PendingFileReviewCandidate = {
	readonly file: ExternalWriteReviewFile;
	readonly orderedRanges: readonly AgentTurnCommitRange[];
	readonly data: AgentTurnFileData;
};

type FileHistorySnapshots = Map<
	string,
	Map<string, { readonly content: unknown; readonly depth: number }>
>;

const EMPTY_FILE_DATA = new Uint8Array();
const HISTORY_QUERY_MAX_PARAMETERS = 900;

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
	const snapshots = await getFileHistorySnapshotsAtCommits(
		lix,
		uniqueStrings(files.map((file) => file.fileId)),
		uniqueStrings(
			resolvedRanges.flatMap((range) => [
				range.beforeCommitId,
				range.afterCommitId,
			]),
		),
	);
	const relevantRangesByFile = files.map((file) => ({
		file,
		ranges: relevantAgentTurnRanges(
			file.fileId,
			resolvedRanges,
			resolvedReviewIds,
			snapshots,
		),
	}));
	const needsRangeOrdering = relevantRangesByFile.some(
		({ ranges: relevantRanges }) => relevantRanges.length > 1,
	);
	const globallyOrderedRanges = needsRangeOrdering
		? await orderAgentTurnRangesByCommitAncestry(lix, resolvedRanges)
		: resolvedRanges;
	const candidates: PendingFileReviewCandidate[] = [];
	for (const { file, ranges: relevantRanges } of relevantRangesByFile) {
		if (relevantRanges.length === 0) continue;
		const orderedRanges =
			relevantRanges.length > 1
				? globallyOrderedRanges.filter((range) =>
						relevantRanges.includes(range),
					)
				: relevantRanges;
		const firstRange = orderedRanges[0];
		const lastRange = orderedRanges[orderedRanges.length - 1];
		if (!firstRange || !lastRange) continue;
		const data = getRangeFileDataFromSnapshots(
			file.fileId,
			{
				beforeCommitId: firstRange.beforeCommitId,
				afterCommitId: lastRange.afterCommitId,
			},
			snapshots,
		);
		if (
			!data ||
			(data.beforeExists && fileBytesEqual(data.beforeData, data.afterData))
		) {
			continue;
		}
		candidates.push({ file, orderedRanges, data });
	}
	if (candidates.length === 0) return pendingPaths;

	const currentDataByFileId = await getCurrentFileData(
		lix,
		uniqueStrings(candidates.map(({ file }) => file.fileId)),
	);
	for (const { file, orderedRanges, data } of candidates) {
		const currentData = currentDataByFileId.get(file.fileId);
		const reviewId = agentTurnReviewId(
			file.fileId,
			orderedRanges.map((range) => range.id),
		);
		if (
			currentData &&
			fileBytesEqual(currentData, data.afterData) &&
			!resolvedReviewIds.has(reviewId)
		) {
			pendingPaths.add(file.path);
		}
	}
	return pendingPaths;
}

export function useAgentTurnCommitRanges(
	activeBranchId: string,
	reviewRangeSessionId?: string,
): {
	readonly rangeValues: readonly unknown[];
	readonly ranges: readonly AgentTurnCommitRange[];
} {
	const resultRef = useRef<{
		readonly key: string;
		readonly value: {
			readonly rangeValues: readonly unknown[];
			readonly ranges: readonly AgentTurnCommitRange[];
		};
	} | null>(null);
	const rangeRows = useQuery<{
		value: unknown;
		lixcol_branch_id: string | null;
	}>(
		(queryLix) =>
			qb(queryLix)
				.selectFrom("lix_key_value_by_branch")
				.select(["value", "lixcol_branch_id"])
				.where("key", "like", `${AGENT_TURN_COMMIT_RANGE_KEY}%`)
				.where("lixcol_branch_id", "=", activeBranchId),
		{ enabled: activeBranchId.length > 0 },
	);
	// Filtering again prevents a cached row for the previous branch from being
	// interpreted as current while useQuery swaps subscriptions.
	const storedRangeValues = rangeRows
		.filter((row) => row.lixcol_branch_id === activeBranchId)
		.map((row) => row.value);
	const storedRanges = agentTurnCommitRangesFromValues(storedRangeValues);
	const ranges =
		reviewRangeSessionId === undefined
			? storedRanges
			: storedRanges.filter(
					(range) => range.sessionId === reviewRangeSessionId,
				);
	const rangeValues: readonly unknown[] =
		reviewRangeSessionId === undefined ? storedRangeValues : ranges;
	const key = JSON.stringify([
		activeBranchId,
		reviewRangeSessionId ?? null,
		rangeValues,
	]);
	if (resultRef.current?.key !== key) {
		resultRef.current = { key, value: { rangeValues, ranges } };
	}
	return resultRef.current.value;
}

export function useExternalWriteReview(args: {
	readonly fileId?: string | null;
	readonly path?: string | null;
	readonly activeBranchId: string;
	readonly resolvedReviewIds?: readonly string[];
	readonly reviewRangeSessionId?: string;
	readonly enabled?: boolean;
	readonly reviewMode?: "agent-turn" | "working-changes";
}): ExternalWriteReview | null {
	const lix = useLix();
	const reviewMode = args.reviewMode ?? "agent-turn";
	const { rangeValues, ranges } = useAgentTurnCommitRanges(
		args.activeBranchId,
		args.reviewRangeSessionId,
	);
	const workingChanges = useQuery(
		(queryLix) => selectWorkingChanges(queryLix),
		{
			enabled: args.enabled !== false && reviewMode === "working-changes",
		},
	);
	const fileWorkingChangesKey = JSON.stringify(
		workingChanges
			.filter((change) => change.file_id === args.fileId)
			.map((change) => [
				change.schema_key,
				change.entity_pk,
				change.diff_type,
				change.before_change_id,
				change.after_change_id,
			]),
	);
	const resolvedReviewKey = JSON.stringify(
		[...(args.resolvedReviewIds ?? [])].sort(),
	);
	const resolvedReviewIdSet = useMemo(
		() => new Set<string>(JSON.parse(resolvedReviewKey)),
		[resolvedReviewKey],
	);
	const reviewKey =
		args.enabled !== false && args.fileId && args.path
			? JSON.stringify([
					args.activeBranchId,
					args.fileId,
					args.path,
					reviewMode,
					reviewMode === "working-changes"
						? fileWorkingChangesKey
						: rangeValues,
					resolvedReviewKey,
				])
			: null;
	const [resolvedReview, setResolvedReview] =
		useState<ResolvedExternalWriteReview | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (!reviewKey || !args.fileId || !args.path) return;
		const loadReview =
			reviewMode === "working-changes"
				? fileWorkingChangesKey === "[]"
					? Promise.resolve(null)
					: getWorkingChangeExternalWriteReview(lix, args.fileId, args.path)
				: ranges.length === 0
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
	}, [
		lix,
		args.fileId,
		args.path,
		fileWorkingChangesKey,
		ranges,
		resolvedReviewIdSet,
		reviewKey,
		reviewMode,
	]);

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
	return snapshot ? decodeFileDataToBytes(snapshot.content) : null;
}

export async function getAgentTurnExternalWriteReview(
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
		.select("content")
		.where("id", "=", fileId)
		.limit(1)
		.executeTakeFirst();
	if (
		!current ||
		!fileBytesEqual(decodeFileDataToBytes(current.content), data.afterData)
	) {
		return null;
	}
	const rangeIds = orderedRanges.map((range) => range.id);
	return {
		fileId,
		path,
		reviewId: agentTurnReviewId(fileId, rangeIds),
		mode: "agent-turn",
		beforeCommitId: firstRange.beforeCommitId,
		afterCommitId: lastRange.afterCommitId,
		agentTurnRangeIds: rangeIds,
	};
}

export async function getWorkingChangeExternalWriteReview(
	lix: Lix,
	fileId: string,
	path: string,
): Promise<ExternalWriteReview | null> {
	const [checkpoint, headResult] = await Promise.all([
		qb(lix)
			.selectFrom("lix_checkpoint")
			.select("commit_id")
			.orderBy("lixcol_depth", "asc")
			.limit(1)
			.executeTakeFirst(),
		lix.execute("SELECT lix_active_branch_commit_id() AS commit_id"),
	]);
	const headCommitId = headResult.rows[0]?.get("commit_id");
	if (
		!checkpoint?.commit_id ||
		typeof headCommitId !== "string" ||
		checkpoint.commit_id === headCommitId
	) {
		return null;
	}
	const data = await getRangeFileData(lix, fileId, {
		beforeCommitId: checkpoint.commit_id,
		afterCommitId: headCommitId,
	});
	if (!data) return null;
	if (data.beforeExists && fileBytesEqual(data.beforeData, data.afterData)) {
		return null;
	}
	const current = await qb(lix)
		.selectFrom("lix_file")
		.select("content")
		.where("id", "=", fileId)
		.limit(1)
		.executeTakeFirst();
	if (
		!current ||
		!fileBytesEqual(decodeFileDataToBytes(current.content), data.afterData)
	) {
		return null;
	}
	const rangeId = `checkpoint:${checkpoint.commit_id}:${headCommitId}`;
	return {
		fileId,
		path,
		reviewId: agentTurnReviewId(fileId, [rangeId]),
		mode: "working-changes",
		beforeCommitId: checkpoint.commit_id,
		afterCommitId: headCommitId,
		agentTurnRangeIds: [rangeId],
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
	_lix: Lix,
	ranges: readonly AgentTurnCommitRange[],
): Promise<AgentTurnCommitRange[]> {
	if (ranges.length < 2) return [...ranges];
	return [...ranges].sort((left, right) => {
		return (
			left.completedAt - right.completedAt ||
			left.beforeCommitId.localeCompare(right.beforeCommitId) ||
			left.afterCommitId.localeCompare(right.afterCommitId) ||
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

function relevantAgentTurnRanges(
	fileId: string,
	ranges: readonly AgentTurnCommitRange[],
	resolvedReviewIds: ReadonlySet<string>,
	snapshots: FileHistorySnapshots,
): AgentTurnCommitRange[] {
	const relevantRanges: AgentTurnCommitRange[] = [];
	const resolvedRangeIds = resolvedAgentTurnRangeIds(fileId, resolvedReviewIds);
	for (const range of ranges) {
		if (resolvedRangeIds.has(range.id)) continue;
		if (range.beforeCommitId === range.afterCommitId) continue;
		const data = getRangeFileDataFromSnapshots(fileId, range, snapshots);
		if (!data) continue;
		if (data.beforeExists && fileBytesEqual(data.beforeData, data.afterData)) {
			continue;
		}
		relevantRanges.push(range);
	}
	return relevantRanges;
}

function getRangeFileDataFromSnapshots(
	fileId: string,
	range: Pick<AgentTurnCommitRange, "beforeCommitId" | "afterCommitId">,
	snapshots: FileHistorySnapshots,
): AgentTurnFileData | null {
	const beforeSnapshot = snapshots.get(fileId)?.get(range.beforeCommitId);
	const afterSnapshot = snapshots.get(fileId)?.get(range.afterCommitId);
	if (!afterSnapshot) return null;
	const beforeData = beforeSnapshot
		? decodeFileDataToBytes(beforeSnapshot.content)
		: null;
	return {
		beforeData: beforeData ?? EMPTY_FILE_DATA,
		afterData: decodeFileDataToBytes(afterSnapshot.content),
		beforeExists: beforeData !== null,
	};
}

async function getFileHistorySnapshotsAtCommits(
	lix: Lix,
	fileIds: readonly string[],
	commitIds: readonly string[],
): Promise<FileHistorySnapshots> {
	const snapshots: FileHistorySnapshots = new Map();
	if (fileIds.length === 0 || commitIds.length === 0) return snapshots;
	for (const commitId of commitIds) {
		const fileIdBatchSize = Math.max(1, HISTORY_QUERY_MAX_PARAMETERS - 1);
		for (const fileIdBatch of chunkValues(fileIds, fileIdBatchSize)) {
			const rows = (await selectFileHistory(lix, commitId)
				.select([
					"id",
					"content",
					sql<string>`${commitId}`.as("commit_id"),
					"lixcol_depth as depth",
				])
				.where("id", "in", fileIdBatch)
				.execute()) as BatchedFileHistoryRow[];
			for (const row of rows) {
				const fileSnapshots = snapshots.get(row.id) ?? new Map();
				const existing = fileSnapshots.get(row.commit_id);
				if (!existing || row.depth < existing.depth) {
					fileSnapshots.set(row.commit_id, {
						content: row.content,
						depth: row.depth,
					});
				}
				snapshots.set(row.id, fileSnapshots);
			}
		}
	}
	return snapshots;
}

async function getCurrentFileData(
	lix: Lix,
	fileIds: readonly string[],
): Promise<Map<string, Uint8Array>> {
	const currentDataByFileId = new Map<string, Uint8Array>();
	for (const fileIdBatch of chunkValues(
		fileIds,
		HISTORY_QUERY_MAX_PARAMETERS,
	)) {
		const rows = (await qb(lix)
			.selectFrom("lix_file")
			.select(["id", "content"])
			.where("id", "in", fileIdBatch)
			.execute()) as CurrentFileRow[];
		for (const row of rows) {
			currentDataByFileId.set(row.id, decodeFileDataToBytes(row.content));
		}
	}
	return currentDataByFileId;
}

function uniqueStrings(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function* chunkValues<T>(
	values: readonly T[],
	chunkSize: number,
): Generator<readonly T[]> {
	for (let start = 0; start < values.length; start += chunkSize) {
		yield values.slice(start, start + chunkSize);
	}
}

function fileHistorySnapshotQuery(lix: Lix, fileId: string, commitId: string) {
	return selectFileHistory(lix, commitId)
		.select("content")
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
