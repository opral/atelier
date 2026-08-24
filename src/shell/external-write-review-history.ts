import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { Lix } from "@lix-js/sdk";
import { useLix, useQuery } from "@/lib/lix-react";
import {
	openLixBranchSession,
	withLixBranchSession,
} from "@/lib/lix-branch-session";
import { selectFileHistory } from "@/lib/lix-file-history";
import { selectFileHistorySnapshotsAtCommits } from "@/lib/lix-file-history-snapshots";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { selectWorkingChanges } from "@/queries";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
} from "@/extension-runtime/external-write-review";
import {
	AGENT_TURN_COMMIT_RANGE_KEY,
	AGENT_TURN_COMMIT_RANGE_KEY_UPPER_BOUND,
	agentTurnCommitRangesFromValues,
	agentTurnReviewId,
	agentTurnReviewRangeIds,
	readAgentTurnCommitRangeValues,
	readAgentTurnCommitRanges,
	type AgentTurnCommitRange,
} from "./agent-turn-review-range";

type FileHistoryRow = {
	readonly content: unknown;
	readonly path: string | null;
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
	readonly afterExists: boolean;
};

type PendingFileReviewCandidate = {
	readonly file: ExternalWriteReviewFile;
	readonly orderedRanges: readonly AgentTurnCommitRange[];
	readonly data: AgentTurnFileData;
};

type FileHistorySnapshots = Map<
	string,
	Map<
		string,
		{
			readonly content: unknown;
			readonly depth: number;
			readonly exists: boolean;
		}
	>
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
	const load = async (branchLix: Lix) => {
		const ranges = agentTurnCommitRangesFromValues(
			await readAgentTurnCommitRangeValues(branchLix),
		);
		const review = await getAgentTurnExternalWriteReview(
			branchLix,
			fileId,
			path,
			ranges,
			options?.resolvedReviewIds,
		);
		return review && !options?.resolvedReviewIds?.has(review.reviewId)
			? review
			: null;
	};
	const targetBranchId = options?.branchId ?? (await lix.activeBranchId());
	return withLixBranchSession(lix, targetBranchId, load);
}

export async function getPendingExternalWriteReviewPaths(
	lix: Lix,
	files: readonly ExternalWriteReviewFile[],
	ranges?: readonly AgentTurnCommitRange[],
	resolvedReviewIds: ReadonlySet<string> = new Set(),
): Promise<Set<string>> {
	const reviews = await getPendingExternalWriteReviews(
		lix,
		files,
		ranges,
		resolvedReviewIds,
	);
	return new Set(reviews.map((review) => review.path));
}

export async function getPendingExternalWriteReviews(
	lix: Lix,
	files: readonly ExternalWriteReviewFile[],
	ranges?: readonly AgentTurnCommitRange[],
	resolvedReviewIds: ReadonlySet<string> = new Set(),
): Promise<readonly ExternalWriteReview[]> {
	const resolvedRanges = ranges ?? (await readAgentTurnCommitRanges(lix));
	if (files.length === 0 || resolvedRanges.length === 0) {
		return [];
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
			(data.beforeExists === data.afterExists &&
				fileBytesEqual(data.beforeData, data.afterData))
		) {
			continue;
		}
		candidates.push({ file, orderedRanges, data });
	}
	if (candidates.length === 0) return [];

	const candidateFileIds = uniqueStrings(
		candidates.map(({ file }) => file.fileId),
	);
	const currentDataByFileId = await getCurrentFileData(lix, candidateFileIds);
	const reviews: ExternalWriteReview[] = [];
	for (const { file, orderedRanges, data } of candidates) {
		const currentData = currentDataByFileId.get(file.fileId);
		const reviewId = agentTurnReviewId(
			file.fileId,
			orderedRanges.map((range) => range.id),
		);
		if (
			currentDataByFileId.has(file.fileId) === data.afterExists &&
			fileBytesEqual(currentData ?? EMPTY_FILE_DATA, data.afterData) &&
			!resolvedReviewIds.has(reviewId)
		) {
			const firstRange = orderedRanges[0];
			const lastRange = orderedRanges[orderedRanges.length - 1];
			if (!firstRange || !lastRange) continue;
			reviews.push({
				fileId: file.fileId,
				path: file.path,
				reviewId,
				mode: "agent-turn",
				beforeCommitId: firstRange.beforeCommitId,
				afterCommitId: lastRange.afterCommitId,
				agentTurnRangeIds: orderedRanges.map((range) => range.id),
			});
		}
	}
	return reviews;
}

export function useAgentTurnCommitRanges(
	activeBranchId: string,
	reviewRangeSessionId?: string,
	enabled = true,
): {
	readonly rangeValues: readonly unknown[];
	readonly ranges: readonly AgentTurnCommitRange[];
	readonly ready: boolean;
} {
	const resultRef = useRef<{
		readonly key: string;
		readonly value: {
			readonly rangeValues: readonly unknown[];
			readonly ranges: readonly AgentTurnCommitRange[];
			readonly ready: boolean;
		};
	} | null>(null);
	const lix = useLix();
	const store =
		enabled && activeBranchId.length > 0
			? getAgentTurnRangeStore(lix, activeBranchId)
			: DISABLED_AGENT_TURN_RANGE_STORE;
	const observedRanges = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);

	// The branch key prevents the previous session's cache from being rendered
	// while a replacement observation is opening.
	const storedRangeValues = observedRanges.values;
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
		observedRanges.ready,
		rangeValues,
	]);
	if (resultRef.current?.key !== key) {
		resultRef.current = {
			key,
			value: { rangeValues, ranges, ready: observedRanges.ready },
		};
	}
	return resultRef.current.value;
}

type AgentTurnRangeStoreSnapshot = {
	readonly values: readonly unknown[];
	readonly ready: boolean;
};

type AgentTurnRangeStore = {
	readonly subscribe: (listener: () => void) => () => void;
	readonly getSnapshot: () => AgentTurnRangeStoreSnapshot;
};

const EMPTY_AGENT_TURN_RANGE_SNAPSHOT: AgentTurnRangeStoreSnapshot = {
	values: [],
	ready: false,
};
const DISABLED_AGENT_TURN_RANGE_STORE: AgentTurnRangeStore = {
	subscribe: () => () => {},
	getSnapshot: () => EMPTY_AGENT_TURN_RANGE_SNAPSHOT,
};
const agentTurnRangeStores = new WeakMap<
	Lix,
	Map<string, AgentTurnRangeStore>
>();

function getAgentTurnRangeStore(
	lix: Lix,
	branchId: string,
): AgentTurnRangeStore {
	let byBranch = agentTurnRangeStores.get(lix);
	if (!byBranch) {
		byBranch = new Map();
		agentTurnRangeStores.set(lix, byBranch);
	}
	const cached = byBranch.get(branchId);
	if (cached) return cached;

	let snapshot = EMPTY_AGENT_TURN_RANGE_SNAPSHOT;
	const listeners = new Set<() => void>();
	let releaseGeneration = 0;
	let current: { readonly stop: () => void } | undefined;
	const publish = (values: readonly unknown[]) => {
		snapshot = { values, ready: true };
		for (const listener of listeners) listener();
	};
	const start = () => {
		if (current) return;
		let cancelled = false;
		let closeObservation: (() => void) | undefined;
		let closeSession: (() => Promise<void>) | undefined;
		const closeObservationSafely = () => {
			try {
				closeObservation?.();
			} catch (error) {
				console.warn("[agent-turn-review] failed to close observation", error);
			}
		};
		const closeSessionSafely = async () => {
			try {
				await closeSession?.();
			} catch (error) {
				console.warn("[agent-turn-review] failed to close session", error);
			}
		};
		const lifecycle = {
			stop: () => {
				if (cancelled) return;
				cancelled = true;
				closeObservationSafely();
				void closeSessionSafely();
			},
		};
		current = lifecycle;
		void (async () => {
			try {
				const session = await openLixBranchSession(lix, branchId);
				let sessionOpen = session.owned;
				closeSession = async () => {
					if (!sessionOpen) return;
					sessionOpen = false;
					await session.lix.close();
				};
				if (cancelled) return;
				const events = session.lix.observe(
					"SELECT value FROM lix_key_value WHERE lixcol_file_id IS NULL AND key >= $1 AND key < $2",
					[
						AGENT_TURN_COMMIT_RANGE_KEY,
						AGENT_TURN_COMMIT_RANGE_KEY_UPPER_BOUND,
					],
				);
				let observationOpen = true;
				closeObservation = () => {
					if (!observationOpen) return;
					observationOpen = false;
					events.close();
				};
				for (;;) {
					const event = await events.next();
					if (cancelled || event === undefined) {
						break;
					}
					publish(event.result.rows.map((row) => row.get("value")));
				}
			} catch (error) {
				if (!cancelled) {
					console.warn("[agent-turn-review] failed to observe ranges", error);
				}
			} finally {
				closeObservationSafely();
				await closeSessionSafely();
				if (current === lifecycle) current = undefined;
			}
		})();
	};
	const store: AgentTurnRangeStore = {
		subscribe: (listener) => {
			releaseGeneration += 1;
			listeners.add(listener);
			start();
			return () => {
				listeners.delete(listener);
				if (listeners.size !== 0) return;
				const pendingRelease = ++releaseGeneration;
				queueMicrotask(() => {
					if (listeners.size !== 0 || releaseGeneration !== pendingRelease) {
						return;
					}
					current?.stop();
					current = undefined;
				});
			};
		},
		getSnapshot: () => snapshot,
	};
	byBranch.set(branchId, store);
	return store;
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
		args.enabled !== false && reviewMode === "agent-turn",
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
				change.row_pk,
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
					: withLixBranchSession(lix, args.activeBranchId, (branchLix) =>
							getAgentTurnExternalWriteReview(
								branchLix,
								args.fileId!,
								args.path!,
								ranges,
								resolvedReviewIdSet,
							),
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
		args.activeBranchId,
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
	if (!snapshot || snapshot.path === null) return null;
	return decodeFileDataToBytes(snapshot.content);
}

export async function getAgentTurnExternalWriteReview(
	lix: Lix,
	fileId: string,
	path: string,
	ranges: readonly AgentTurnCommitRange[],
	resolvedReviewIds: ReadonlySet<string> = new Set(),
): Promise<ExternalWriteReview | null> {
	const resolvedRangeIds = resolvedAgentTurnRangeIds(fileId, resolvedReviewIds);
	const candidateRanges = ranges.filter(
		(range) =>
			!resolvedRangeIds.has(range.id) &&
			range.beforeCommitId !== range.afterCommitId,
	);
	const snapshots = await getFileHistorySnapshotsAtCommits(
		lix,
		[fileId],
		uniqueStrings(
			candidateRanges.flatMap((range) => [
				range.beforeCommitId,
				range.afterCommitId,
			]),
		),
	);
	const relevantRanges = relevantAgentTurnRanges(
		fileId,
		candidateRanges,
		resolvedReviewIds,
		snapshots,
	);
	if (relevantRanges.length === 0) return null;
	const orderedRanges = await orderAgentTurnRangesByCommitAncestry(
		lix,
		relevantRanges,
	);
	const firstRange = orderedRanges[0];
	const lastRange = orderedRanges[orderedRanges.length - 1];
	if (!firstRange || !lastRange) return null;
	const data = getRangeFileDataFromSnapshots(
		fileId,
		{
			beforeCommitId: firstRange.beforeCommitId,
			afterCommitId: lastRange.afterCommitId,
		},
		snapshots,
	);
	if (!data) return null;
	if (
		data.beforeExists === data.afterExists &&
		fileBytesEqual(data.beforeData, data.afterData)
	) {
		return null;
	}
	const current = await qb(lix)
		.selectFrom("lix_file")
		.select("content")
		.where("id", "=", fileId)
		.limit(1)
		.executeTakeFirst();
	if (
		(current !== undefined) !== data.afterExists ||
		!fileBytesEqual(
			current ? decodeFileDataToBytes(current.content) : EMPTY_FILE_DATA,
			data.afterData,
		)
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
			.orderBy("lixcol_created_at", "desc")
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
	if (
		data.beforeExists === data.afterExists &&
		fileBytesEqual(data.beforeData, data.afterData)
	) {
		return null;
	}
	const current = await qb(lix)
		.selectFrom("lix_file")
		.select("content")
		.where("id", "=", fileId)
		.limit(1)
		.executeTakeFirst();
	if (
		(current !== undefined) !== data.afterExists ||
		!fileBytesEqual(
			current ? decodeFileDataToBytes(current.content) : EMPTY_FILE_DATA,
			data.afterData,
		)
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
	const beforeExists = beforeData !== null;
	const afterExists = afterData !== null;
	if (!beforeExists && !afterExists) return null;
	return {
		beforeData: beforeData ?? EMPTY_FILE_DATA,
		afterData: afterData ?? EMPTY_FILE_DATA,
		beforeExists,
		afterExists,
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
		if (
			data.beforeExists === data.afterExists &&
			fileBytesEqual(data.beforeData, data.afterData)
		) {
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
	if (!beforeSnapshot && !afterSnapshot) return null;
	const beforeData = beforeSnapshot?.exists
		? decodeFileDataToBytes(beforeSnapshot.content)
		: null;
	const afterData = afterSnapshot?.exists
		? decodeFileDataToBytes(afterSnapshot.content)
		: null;
	return {
		beforeData: beforeData ?? EMPTY_FILE_DATA,
		afterData: afterData ?? EMPTY_FILE_DATA,
		beforeExists: beforeSnapshot?.exists ?? false,
		afterExists: afterSnapshot?.exists ?? false,
	};
}

async function getFileHistorySnapshotsAtCommits(
	lix: Lix,
	fileIds: readonly string[],
	commitIds: readonly string[],
): Promise<FileHistorySnapshots> {
	const snapshots: FileHistorySnapshots = new Map();
	if (fileIds.length === 0 || commitIds.length === 0) return snapshots;
	const requests = fileIds.flatMap((fileId) =>
		commitIds.map((commitId) => ({ fileId, commitId })),
	);
	for (const row of await selectFileHistorySnapshotsAtCommits(lix, requests, {
		includeContent: true,
	})) {
		const fileSnapshots = snapshots.get(row.id) ?? new Map();
		const existing = fileSnapshots.get(row.commitId);
		if (!existing || row.depth < existing.depth) {
			fileSnapshots.set(row.commitId, {
				content: row.content,
				depth: row.depth,
				exists: row.path !== null,
			});
		}
		snapshots.set(row.id, fileSnapshots);
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
		.select(["path", "content"])
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
