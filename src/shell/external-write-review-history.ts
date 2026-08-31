import { useEffect, useState } from "react";
import type { Lix } from "@lix-js/sdk";
import type { AtelierDiffFile, AtelierDiffSession } from "@/extension-api";
import { useLix } from "@/lib/lix-react";
import { selectFilesStateAt, selectWorkingFileDiffContent } from "@/queries";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";

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
	| {
			readonly loading: false;
			readonly data: Uint8Array | null;
			readonly afterData?: Uint8Array | null;
			readonly error?: true;
	  };

export function useFileDataAtCommit(
	fileId: string | null | undefined,
	commitId: string | null | undefined,
): FileDataAtCommit {
	const lix = useLix();
	const key = fileId && commitId ? `${fileId}\u0000${commitId}` : null;
	const [resolved, setResolved] = useState<{
		readonly key: string;
		readonly data: Uint8Array | null;
		readonly error?: true;
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
				setResolved({ key, data: null, error: true });
			});
		return () => {
			cancelled = true;
		};
	}, [lix, fileId, commitId, key]);
	if (!key) return { loading: false, data: null };
	return resolved?.key === key
		? {
				loading: false,
				data: resolved.data,
				...(resolved.error ? { error: true as const } : {}),
			}
		: { loading: true };
}

/** Working bytes loaded lazily from the immutable commits of the opened epoch. */
export function useWorkingFileData(
	fileId: string | null | undefined,
	beforeCommitId: string | null | undefined,
	afterCommitId: string | null | undefined,
): FileDataAtCommit {
	const lix = useLix();
	const key =
		fileId && beforeCommitId && afterCommitId
			? `${fileId}\u0000${beforeCommitId}\u0000${afterCommitId}`
			: null;
	const [resolved, setResolved] = useState<{
		readonly key: string;
		readonly data: Uint8Array | null;
		readonly afterData: Uint8Array | null;
		readonly error?: true;
	} | null>(null);
	useEffect(() => {
		if (!key || !fileId || !beforeCommitId || !afterCommitId) return;
		let cancelled = false;
		void selectWorkingFileDiffContent(
			lix,
			fileId,
			beforeCommitId,
			afterCommitId,
		)
			.then((row) => {
				if (cancelled) return;
				setResolved({
					key,
					data:
						row.from_content === null
							? null
							: decodeFileDataToBytes(row.from_content),
					afterData:
						row.to_content === null
							? null
							: decodeFileDataToBytes(row.to_content),
				});
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				console.warn(
					"[external-write-review] failed to load working file snapshots",
					error,
				);
				setResolved({ key, data: null, afterData: null, error: true });
			});
		return () => {
			cancelled = true;
		};
	}, [lix, fileId, beforeCommitId, afterCommitId, key]);
	if (!key) return { loading: false, data: null };
	return resolved?.key === key
		? {
				loading: false,
				data: resolved.data,
				afterData: resolved.afterData,
				...(resolved.error ? { error: true as const } : {}),
			}
		: { loading: true };
}

/** The immutable file descriptor captured when a working review was opened. */
export function workingReviewFile(
	session: AtelierDiffSession | null | undefined,
	fileId: string,
): AtelierDiffFile | undefined {
	return session && "working" in session.target
		? session.files.find((file) => file.id === fileId)
		: undefined;
}

export async function getWorkingFileData(
	lix: Lix,
	fileId: string,
	beforeCommitId: string,
	afterCommitId: string,
): Promise<{
	readonly beforeData: Uint8Array | null;
	readonly afterData: Uint8Array | null;
} | null> {
	const row = await selectWorkingFileDiffContent(
		lix,
		fileId,
		beforeCommitId,
		afterCommitId,
	);
	return {
		beforeData:
			row.from_content === null
				? null
				: decodeFileDataToBytes(row.from_content),
		afterData:
			row.to_content === null ? null : decodeFileDataToBytes(row.to_content),
	};
}

export async function getFileDataAtCommit(
	lix: Lix,
	fileId: string,
	commitId: string,
): Promise<Uint8Array | null> {
	// Zero rows means the file did not exist at the commit.
	const row = (await selectFilesStateAt(lix, commitId)
		.select(["content"])
		.where("id", "=", fileId)
		.executeTakeFirst()) as { content: unknown } | undefined;
	if (row === undefined) return null;
	return decodeFileDataToBytes(row.content);
}
