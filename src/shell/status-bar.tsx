import { useState, type JSX, type ReactNode } from "react";
import { Flag, RefreshCw } from "lucide-react";
import { WorkingDot } from "@/components/diff-glyph";
import { useQueryResult } from "@/lib/lix-react";
import { selectWorkingChangeCount, selectWorkingReviewEpoch } from "@/queries";
import {
	reviewIsBehindWorkspace,
	type WorkingReviewEpoch,
} from "./working-review-epoch";

// Checkpoint titles are not exposed by Lix yet. Keep the placeholder isolated so
// the status bar can consume the real title without changing its presentation.
const LATEST_CHECKPOINT_TITLE = "Latest checkpoint";

/**
 * Bottom status ribbon. Left carries workspace status and right carries
 * document info.
 *
 * @example
 * <StatusBar right={<span>1,240 words</span>} />
 */
export function StatusBar({
	left,
	right,
}: {
	readonly left?: ReactNode;
	readonly right?: ReactNode;
}): JSX.Element {
	return (
		<footer className="atw:flex atw:h-6 atw:shrink-0 atw:items-center atw:justify-between atw:px-3 atw:text-[11.5px] atw:text-fg-subtle">
			<div className="atw:flex atw:min-w-0 atw:items-center atw:gap-1.5">
				{left}
			</div>
			<div className="atw:flex atw:min-w-0 atw:items-center atw:gap-1.5">
				{right}
			</div>
		</footer>
	);
}

export function CheckpointStatusBar({
	readOnly = false,
	autoAcceptAgentChanges = false,
	onAutoAcceptAgentChangesChange,
	onReviewLatestCheckpoint,
	onReviewWorkingChanges,
	onRefreshWorkingReview,
	reviewedEpoch = null,
	reviewingWorkingChanges = false,
	reviewingLatestCheckpoint = false,
}: {
	readonly readOnly?: boolean;
	readonly autoAcceptAgentChanges?: boolean;
	readonly onAutoAcceptAgentChangesChange?: (enabled: boolean) => void;
	/** With nothing to review since the checkpoint, the pill reviews the checkpoint itself. */
	readonly onReviewLatestCheckpoint?: () => void;
	readonly onReviewWorkingChanges?: () => void;
	/** Reopens the working review at the epoch the workspace is on now. */
	readonly onRefreshWorkingReview?: () => void;
	/** The epoch an open working review holds, if one is open. */
	readonly reviewedEpoch?: WorkingReviewEpoch | null;
	/** The working review is open; the same control now closes it. */
	readonly reviewingWorkingChanges?: boolean;
	/** A checkpoint review is open; the same control now closes it. */
	readonly reviewingLatestCheckpoint?: boolean;
}): JSX.Element {
	const [retryKey, setRetryKey] = useState(0);
	const workingChangeCount = useQueryResult(
		(queryLix) => selectWorkingChangeCount(queryLix),
		{ retryKey },
	);
	const workingRow = workingChangeCount.rows[0];
	const fileCount = workingRow?.file_count ?? 0;
	const workingCountLabel = `${fileCount} ${fileCount === 1 ? "file" : "files"} changed`;
	const liveEpoch = useQueryResult(
		(queryLix) => selectWorkingReviewEpoch(queryLix),
		{ enabled: reviewingWorkingChanges, retryKey },
	);
	const liveEpochRow = liveEpoch.rows[0];
	// The diff on screen is a past state of the file once somebody else has
	// written, and every decision the review offers is refused against the
	// epoch it was taken on — so say so here rather than letting Checkpoint be
	// the one to break the news.
	const reviewIsBehind =
		reviewingWorkingChanges &&
		reviewedEpoch !== null &&
		liveEpoch.status === "success" &&
		liveEpochRow !== undefined &&
		reviewIsBehindWorkspace(reviewedEpoch, {
			beforeCommitId: liveEpochRow.before_commit_id,
			afterCommitId: liveEpochRow.after_commit_id,
		});

	const historyStatus =
		workingChangeCount.status === "pending" ? (
			<span role="status">Loading changes…</span>
		) : workingChangeCount.status === "error" ? (
			<button type="button" onClick={() => setRetryKey((key) => key + 1)}>
				Changes unavailable · Retry
			</button>
		) : fileCount === 0 ? (
			<CheckpointStatus
				statusLabel={LATEST_CHECKPOINT_TITLE}
				reviewing={reviewingLatestCheckpoint}
				onActivate={onReviewLatestCheckpoint}
			/>
		) : (
			<CheckpointStatus
				statusLabel={`${workingCountLabel} since checkpoint`}
				hasWorkingChanges
				reviewing={reviewingWorkingChanges}
				onActivate={onReviewWorkingChanges}
			/>
		);

	return (
		<StatusBar
			left={
				<>
					{historyStatus}
					{liveEpoch.status === "error" && (
						<button type="button" onClick={() => setRetryKey((key) => key + 1)}>
							Review status unavailable · Retry
						</button>
					)}
					{reviewIsBehind ? (
						<ReviewBehindNotice onRefresh={onRefreshWorkingReview} />
					) : null}
				</>
			}
			right={
				readOnly ? undefined : (
					<div className="atw:flex atw:items-center atw:gap-2">
						<AutoAcceptToggle
							checked={autoAcceptAgentChanges}
							onCheckedChange={onAutoAcceptAgentChangesChange}
						/>
					</div>
				)
			}
		/>
	);
}

/**
 * The file changed again while its review was open. The review keeps showing
 * the change it was opened on — refreshing reopens it on the current one.
 */
function ReviewBehindNotice({
	onRefresh,
}: {
	readonly onRefresh?: () => void;
}): JSX.Element {
	const label = "This review is behind the file";
	return onRefresh ? (
		<button
			type="button"
			data-attr="review-behind-refresh"
			aria-label={`${label}. Refresh the review`}
			onClick={onRefresh}
			onMouseDown={(event) => event.preventDefault()}
			className="atw:inline-flex atw:h-5 atw:items-center atw:gap-1.5 atw:rounded-[5px] atw:px-1.5 atw:text-accent atw:transition-colors atw:hover:bg-bg-hover-strong atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring"
		>
			<RefreshCw aria-hidden="true" className="atw:h-3 atw:w-3" />
			<span>{label} · Refresh</span>
		</button>
	) : (
		<span
			data-attr="review-behind-refresh"
			className="atw:inline-flex atw:h-5 atw:items-center atw:gap-1.5 atw:px-1.5 atw:text-accent"
		>
			<RefreshCw aria-hidden="true" className="atw:h-3 atw:w-3" />
			<span>{label}</span>
		</span>
	);
}

function AutoAcceptToggle({
	checked,
	onCheckedChange,
}: {
	readonly checked: boolean;
	readonly onCheckedChange?: (enabled: boolean) => void;
}) {
	return (
		<label
			className={`atw:inline-flex atw:h-5 atw:cursor-pointer atw:select-none atw:items-center atw:gap-1.5 atw:font-semibold atw:transition-colors ${
				checked ? "atw:text-accent" : "atw:text-fg-subtle"
			}`}
		>
			<span>Auto-accept</span>
			<input
				type="checkbox"
				role="switch"
				aria-label="Auto-accept agent changes"
				aria-checked={checked}
				checked={checked}
				onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
				className="atw:peer atw:sr-only"
			/>
			<span
				aria-hidden="true"
				className={`atw:relative atw:h-3 atw:w-5 atw:shrink-0 atw:rounded-full atw:border atw:transition-colors atw:peer-focus-visible:ring-2 atw:peer-focus-visible:ring-ring atw:peer-focus-visible:ring-offset-1 ${
					checked
						? "atw:border-link atw:bg-link"
						: "atw:border-border atw:bg-border-strong"
				}`}
			>
				<span
					aria-hidden="true"
					className={`atw:absolute atw:top-px atw:left-px atw:size-2 atw:rounded-full atw:bg-panel atw:shadow-sm atw:transition-transform ${
						checked ? "atw:translate-x-2" : "atw:translate-x-0"
					}`}
				/>
			</span>
		</label>
	);
}

function CheckpointStatus({
	statusLabel,
	hasWorkingChanges = false,
	reviewing = false,
	onActivate,
}: {
	readonly statusLabel: string;
	readonly hasWorkingChanges?: boolean;
	readonly reviewing?: boolean;
	readonly onActivate?: () => void;
}): JSX.Element {
	const actionLabel = reviewing
		? "Close review"
		: hasWorkingChanges
			? "Review working changes"
			: "Review latest checkpoint";

	return onActivate ? (
		<button
			type="button"
			aria-label={`${statusLabel}. ${actionLabel}`}
			aria-pressed={reviewing}
			onClick={onActivate}
			onMouseDown={(event) => event.preventDefault()}
			className="atw:inline-flex atw:h-5 atw:items-center atw:gap-1.5 atw:rounded-[5px] atw:px-1.5 atw:transition-colors atw:hover:bg-bg-hover-strong atw:hover:text-fg atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring"
		>
			{hasWorkingChanges ? null : (
				<Flag aria-hidden="true" className="atw:h-3 atw:w-3" />
			)}
			{hasWorkingChanges ? <WorkingDot /> : null}
			<span>{statusLabel}</span>
		</button>
	) : (
		<span className="atw:inline-flex atw:items-center atw:gap-1.5">
			{hasWorkingChanges ? null : (
				<Flag aria-hidden="true" className="atw:h-3 atw:w-3" />
			)}
			{hasWorkingChanges ? <WorkingDot /> : null}
			<span>{statusLabel}</span>
		</span>
	);
}
