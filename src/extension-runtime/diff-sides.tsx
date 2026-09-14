import type { ReactNode } from "react";
import type { AtelierDiffSession } from "../extension-api";
import {
	useWorkingFileData,
	workingReviewFile,
} from "@/shell/external-write-review-history";
import { CheckpointAbsentFile } from "./checkpoint-absent-file";
import "./diff-sides.css";

/**
 * Before beside after: the layout a view uses when it shows two revisions of
 * a file it cannot diff in place — an image, a video, a PDF, a scene.
 *
 * A side is `null` where the file has no version at all: a created file has
 * no before, a deleted one has no after.
 */
export function DiffSides({
	filePath,
	before,
	after,
	beforeCommitId = null,
	afterCommitId = null,
}: {
	readonly filePath: string;
	readonly before: ReactNode | null;
	readonly after: ReactNode | null;
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
}) {
	return (
		<div className="atelier-diff-sides" data-testid="diff-sides">
			<DiffSide
				side="before"
				label="Before"
				filePath={filePath}
				commitId={beforeCommitId}
			>
				{before}
			</DiffSide>
			<DiffSide
				side="after"
				label="After"
				filePath={filePath}
				commitId={afterCommitId}
			>
				{after}
			</DiffSide>
		</div>
	);
}

function DiffSide({
	side,
	label,
	filePath,
	commitId,
	children,
}: {
	readonly side: "before" | "after";
	readonly label: string;
	readonly filePath: string;
	readonly commitId: string | null;
	readonly children: ReactNode | null;
}) {
	const fileName = filePath.split("/").filter(Boolean).at(-1);
	return (
		<section
			aria-label={fileName ? `${label}: ${fileName}` : label}
			className="atelier-diff-side"
			data-diff-side={side}
		>
			<header className="atelier-diff-side-header">{label}</header>
			<div className="atelier-diff-side-body">
				{children ?? (
					<CheckpointAbsentFile filePath={filePath} commitId={commitId} />
				)}
			</div>
		</section>
	);
}

/**
 * The file's two sides in a working review, as bytes.
 *
 * Views read the review the same way: the shell marks the file pending, the
 * certified epoch names the two commits, and both sides come from the diff
 * between them.
 */
export type WorkingDiffSides =
	| { readonly reviewing: false }
	| { readonly reviewing: true; readonly status: "loading" }
	| { readonly reviewing: true; readonly status: "unavailable" }
	| {
			readonly reviewing: true;
			readonly status: "ready";
			readonly path: string;
			readonly beforeCommitId: string;
			readonly afterCommitId: string;
			readonly beforeData: Uint8Array | null;
			readonly afterData: Uint8Array | null;
	  };

export function useWorkingDiffSides(
	fileId: string,
	session: AtelierDiffSession | null | undefined,
): WorkingDiffSides {
	const reviewFile = workingReviewFile(session, fileId);
	const epoch =
		reviewFile?.review?.status === "pending"
			? reviewFile.workingEpoch
			: undefined;
	const data = useWorkingFileData(
		epoch ? fileId : null,
		epoch?.beforeCommitId,
		epoch?.afterCommitId,
	);
	if (!epoch) return { reviewing: false };
	if (data.loading) return { reviewing: true, status: "loading" };
	if (data.error) return { reviewing: true, status: "unavailable" };
	return {
		reviewing: true,
		status: "ready",
		path: reviewFile?.path ?? "",
		beforeCommitId: epoch.beforeCommitId,
		afterCommitId: epoch.afterCommitId,
		beforeData: data.data,
		afterData: data.afterData ?? null,
	};
}
