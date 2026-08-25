import { useEffect, useMemo, useState } from "react";
import type { Lix } from "@lix-js/sdk";
import { useLix, useQuery } from "@/lib/lix-react";
import { selectFileHistory } from "@/lib/lix-file-history";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import { selectWorkingChanges } from "@/queries";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
} from "@/extension-runtime/external-write-review";

type FileHistoryRow = {
	readonly content: unknown;
	readonly path: string | null;
};

type ResolvedExternalWriteReview = {
	readonly key: string;
	readonly review: ExternalWriteReview | null;
};

type ResolvedExternalWriteReviewData = {
	readonly key: string;
	readonly data: ExternalWriteReviewData | null;
};

type RangeFileData = ExternalWriteReviewData & {
	readonly beforeExists: boolean;
	readonly afterExists: boolean;
};

const EMPTY_FILE_DATA = new Uint8Array();

export type ExternalWriteReviewFile = {
	readonly fileId: string;
	readonly path: string;
};

/**
 * Stable identity for one file's pending review of the commit span it covers.
 * The JSON shape predates the diff-session unification and is kept so
 * persisted review resolutions (AtelierReviewStatusStore) stay valid.
 */
export function externalWriteReviewId(
	fileId: string,
	beforeCommitId: string,
	afterCommitId: string,
): string {
	return JSON.stringify([
		fileId,
		[`checkpoint:${beforeCommitId}:${afterCommitId}`],
	]);
}

/**
 * The pending review for one open document: the file's state now versus the
 * latest checkpoint. Null when the file is unchanged since that checkpoint.
 */
export function useExternalWriteReview(args: {
	readonly fileId?: string | null;
	readonly path?: string | null;
	readonly activeBranchId: string;
	readonly resolvedReviewIds?: readonly string[];
	readonly enabled?: boolean;
}): ExternalWriteReview | null {
	const lix = useLix();
	const reviewEnabled = args.enabled === true;
	const workingChanges = useQuery(
		(queryLix) => selectWorkingChanges(queryLix),
		{ enabled: reviewEnabled },
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
		reviewEnabled && args.fileId && args.path
			? JSON.stringify([
					args.activeBranchId,
					args.fileId,
					args.path,
					fileWorkingChangesKey,
					resolvedReviewKey,
				])
			: null;
	const [resolvedReview, setResolvedReview] =
		useState<ResolvedExternalWriteReview | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (!reviewKey || !args.fileId || !args.path) return;
		const loadReview =
			fileWorkingChangesKey === "[]"
				? Promise.resolve(null)
				: getWorkingChangeExternalWriteReview(lix, args.fileId, args.path);
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
					console.warn("[external-write-review] failed to load review", error);
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
		resolvedReviewIdSet,
		reviewKey,
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
				console.warn(
					"[external-write-review] failed to load review data",
					error,
				);
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
	return {
		fileId,
		path,
		reviewId: externalWriteReviewId(
			fileId,
			checkpoint.commit_id,
			headCommitId,
		),
		beforeCommitId: checkpoint.commit_id,
		afterCommitId: headCommitId,
	};
}

async function getRangeFileData(
	lix: Lix,
	fileId: string,
	range: { readonly beforeCommitId: string; readonly afterCommitId: string },
): Promise<RangeFileData | null> {
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
