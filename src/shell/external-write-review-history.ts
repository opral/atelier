import { useEffect, useState } from "react";
import type { Lix } from "@lix-js/sdk";
import { useLix } from "@/lib/lix-react";
import { selectFilesStateAt } from "@/queries";
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
