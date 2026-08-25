import { useEffect, useState } from "react";
import type { Lix } from "@lix-js/sdk";
import { useLix } from "@/lib/lix-react";
import { selectFileHistory } from "@/lib/lix-file-history";
import { qb } from "@/lib/lix-kysely";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
} from "@/extension-runtime/external-write-review";

type FileHistoryRow = {
	readonly content: unknown;
	readonly path: string | null;
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
 * The file's bytes at one commit, for diff rendering against live content.
 * Null while loading or when the file did not exist at that commit.
 */
export type FileDataAtCommit =
	| { readonly loading: true }
	| { readonly loading: false; readonly data: Uint8Array | null };

export function useFileDataAtCommit(
	fileId: string | null | undefined,
	commitId: string | null | undefined,
): FileDataAtCommit {
	const lix = useLix();
	const key = fileId && commitId ? `${fileId}\u0000${commitId}` : null;
	const [resolved, setResolved] = useState<{
		readonly key: string;
		readonly data: Uint8Array | null;
	} | null>(null);
	useEffect(() => {
		if (!key || !fileId || !commitId) return;
		let cancelled = false;
		void getFileDataAtCommit(lix, fileId, commitId)
			.then((data) => {
				if (!cancelled) setResolved({ key, data });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				console.warn(
					"[external-write-review] failed to load file data at commit",
					error,
				);
				setResolved({ key, data: null });
			});
		return () => {
			cancelled = true;
		};
	}, [lix, fileId, commitId, key]);
	if (!key) return { loading: false, data: null };
	return resolved?.key === key
		? { loading: false, data: resolved.data }
		: { loading: true };
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
