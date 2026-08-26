import { createElement, type ReactNode } from "react";
import { useQueryTakeFirst } from "@/lib/lix-react";
import { selectFilesStateAt } from "@/queries";

export type HistoricalFileSnapshot = {
	readonly id: string;
	readonly path: string;
	readonly content: unknown;
};

type HistoricalFileSnapshotRow = {
	readonly id: string;
	readonly path: string | null;
	readonly content: unknown | null;
};

/**
 * Loads the shallowest visible file revision on each side of a historical
 * comparison. Historical snapshots are immutable, so neither query keeps a
 * live observer open.
 */
type FileSnapshotsAtCommitsProps = {
	readonly fileId: string;
	readonly beforeCommitId: string | null;
	readonly afterCommitId: string | null;
	readonly beforeFileId?: string | null;
	readonly afterFileId?: string | null;
	readonly beforeExists?: boolean;
	readonly afterExists?: boolean;
	readonly children: (snapshots: {
		readonly beforeSnapshot: HistoricalFileSnapshot | undefined;
		readonly afterSnapshot: HistoricalFileSnapshot | undefined;
	}) => ReactNode;
};

/**
 * Suspense boundary adapter for the two independent historical reads.
 * Each query owns a component boundary so resolving one read cannot change the
 * hook sequence of the component that starts the other.
 */
export function FileSnapshotsAtCommits({
	fileId,
	beforeCommitId,
	afterCommitId,
	beforeFileId = null,
	afterFileId = null,
	beforeExists = true,
	afterExists = true,
	children,
}: FileSnapshotsAtCommitsProps) {
	const beforeSnapshot = useFileSnapshotAtCommit(
		fileId,
		beforeCommitId,
		beforeFileId,
		beforeExists,
	);
	return createElement(AfterFileSnapshotAtCommit, {
		fileId,
		afterCommitId,
		afterFileId,
		afterExists,
		beforeSnapshot,
		children,
	});
}

function AfterFileSnapshotAtCommit({
	fileId,
	afterCommitId,
	afterFileId,
	afterExists,
	beforeSnapshot,
	children,
}: Pick<
	FileSnapshotsAtCommitsProps,
	"fileId" | "afterCommitId" | "afterFileId" | "afterExists" | "children"
> & {
	readonly beforeSnapshot: HistoricalFileSnapshot | undefined;
}) {
	const afterSnapshot = useFileSnapshotAtCommit(
		fileId,
		afterCommitId,
		afterFileId ?? null,
		afterExists ?? true,
	);
	return children({ beforeSnapshot, afterSnapshot });
}

function useFileSnapshotAtCommit(
	fileId: string,
	commitId: string | null,
	explicitFileId: string | null,
	exists: boolean,
): HistoricalFileSnapshot | undefined {
	const snapshotFileId = explicitFileId ?? fileId;
	// lix_state_at: a file absent at the commit produces no row, so absence
	// needs no null-interpretation — zero rows already means "did not exist".
	const row = useQueryTakeFirst<HistoricalFileSnapshotRow>(
		(lix) =>
			selectFilesStateAt(lix, commitId ?? "")
				.select(["id", "path", "content"])
				.where("id", "=", snapshotFileId),
		{
			subscribe: false,
			enabled: fileId.length > 0 && commitId !== null && exists,
		},
	);
	if (!row || typeof row.path !== "string") return undefined;
	return { id: row.id, path: row.path, content: row.content };
}
