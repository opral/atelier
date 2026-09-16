import { useRef, type ReactNode } from "react";
import type { AtelierDiffSession } from "../extension-api";
import type { ExtensionState } from "./types";
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
 *
 * A `pending` comparison is one whose sides are still being read: the frame
 * — both columns and their headers — is drawn with quiet bodies, so a view
 * that steps from one file's comparison to the next keeps its shape while
 * the sides arrive, instead of collapsing to a spinner and back.
 */
export function DiffSides(
	props: {
		readonly filePath: string;
		readonly beforeCommitId?: string | null;
		readonly afterCommitId?: string | null;
	} & (
		| {
				readonly pending: true;
				readonly before?: undefined;
				readonly after?: undefined;
		  }
		| {
				readonly pending?: false;
				readonly before: ReactNode | null;
				readonly after: ReactNode | null;
		  }
	),
) {
	const { filePath, beforeCommitId = null, afterCommitId = null } = props;
	const pending = props.pending === true;
	return (
		<div
			className="atelier-diff-sides"
			data-testid="diff-sides"
			data-atelier-diff-pending={pending || undefined}
			aria-busy={pending || undefined}
		>
			<DiffSide
				side="before"
				label="Before"
				filePath={filePath}
				commitId={beforeCommitId}
				pending={pending}
			>
				{pending ? null : props.before}
			</DiffSide>
			<DiffSide
				side="after"
				label="After"
				filePath={filePath}
				commitId={afterCommitId}
				pending={pending}
			>
				{pending ? null : props.after}
			</DiffSide>
		</div>
	);
}

function DiffSide({
	side,
	label,
	filePath,
	commitId,
	pending,
	children,
}: {
	readonly side: "before" | "after";
	readonly label: string;
	readonly filePath: string;
	readonly commitId: string | null;
	readonly pending: boolean;
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
				{pending
					? null
					: (children ?? (
							<CheckpointAbsentFile filePath={filePath} commitId={commitId} />
						))}
			</div>
		</section>
	);
}

/**
 * Whether this document arrived in the view while its review was already
 * open — a reviewer stepped to it for its comparison — as opposed to a
 * document that was on screen when its review opened.
 *
 * The two wait differently for the comparison's sides. A document opened
 * for its review must never paint as its live self, so it waits in the
 * comparison's empty frame; a document that was already on screen keeps
 * its live revision until the comparison replaces it, so nothing
 * disappears only to come back. The answer is fixed when the document
 * arrives and holds for as long as the view shows it.
 */
export function useOpenedUnderReview(
	fileId: string,
	reviewing: boolean,
): boolean {
	const opened = useRef<{ readonly fileId: string; readonly value: boolean }>({
		fileId,
		value: reviewing,
	});
	if (opened.current.fileId !== fileId) {
		opened.current = { fileId, value: reviewing };
	}
	return opened.current.value;
}

/**
 * Whether this view instance shows a comparison rather than one revision: a
 * file under review, or a file opened at both ends of a checkpoint's span.
 *
 * The prepared surface asks before it paints. A single revision would be the
 * wrong picture, and swapping it for the comparison a moment later reads as a
 * flicker.
 */
export function viewShowsDiff(args: {
	readonly session: AtelierDiffSession | null | undefined;
	readonly state: ExtensionState | null | undefined;
}): boolean {
	const fileId =
		typeof args.state?.fileId === "string" ? args.state.fileId : null;
	if (!fileId) return false;
	const reviewed = workingReviewFile(args.session, fileId);
	if (reviewed?.review?.status === "pending" && reviewed.workingEpoch) {
		return true;
	}
	return Boolean(args.state?.beforeCommitId && args.state?.afterCommitId);
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
