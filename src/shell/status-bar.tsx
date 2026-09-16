import { type JSX, type ReactNode } from "react";
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
		<footer className="flex h-6 shrink-0 items-center justify-between px-3 text-[11.5px] text-[var(--color-icon-tertiary)]">
			<div className="flex min-w-0 items-center gap-1.5">{left}</div>
			<div className="flex min-w-0 items-center gap-1.5">{right}</div>
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
	const workingChangeCount = useQueryResult((queryLix) =>
		selectWorkingChangeCount(queryLix),
	);
	if (workingChangeCount.status === "error") throw workingChangeCount.error;
	const workingRow = workingChangeCount.rows[0];
	const fileCount = workingRow?.file_count ?? 0;
	const workingCountLabel = `${fileCount} ${fileCount === 1 ? "file" : "files"} changed`;
	const liveEpoch = useQueryResult((queryLix) =>
		selectWorkingReviewEpoch(queryLix),
	);
	if (liveEpoch.status === "error") throw liveEpoch.error;
	const liveEpochRow = liveEpoch.rows[0];
	// The diff on screen is a past state of the file once somebody else has
	// written, and every decision the review offers is refused against the
	// epoch it was taken on — so say so here rather than letting Checkpoint be
	// the one to break the news.
	const reviewIsBehind =
		reviewingWorkingChanges &&
		reviewedEpoch !== null &&
		liveEpoch.status !== "pending" &&
		liveEpochRow !== undefined &&
		reviewIsBehindWorkspace(reviewedEpoch, {
			beforeCommitId: liveEpochRow.before_commit_id,
			afterCommitId: liveEpochRow.after_commit_id,
		});

	const historyStatus =
		workingChangeCount.status === "pending" ? null : fileCount === 0 ? (
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
					{reviewIsBehind ? (
						<ReviewBehindNotice onRefresh={onRefreshWorkingReview} />
					) : null}
				</>
			}
			right={
				readOnly ? undefined : (
					<div className="flex items-center gap-2">
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
			className="inline-flex h-5 items-center gap-1.5 rounded-[5px] px-1.5 text-[var(--color-text-brand)] transition-colors hover:bg-[var(--color-bg-hover-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
		>
			<RefreshCw aria-hidden="true" className="h-3 w-3" />
			<span>{label} · Refresh</span>
		</button>
	) : (
		<span
			data-attr="review-behind-refresh"
			className="inline-flex h-5 items-center gap-1.5 px-1.5 text-[var(--color-text-brand)]"
		>
			<RefreshCw aria-hidden="true" className="h-3 w-3" />
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
			className={`inline-flex h-5 cursor-pointer select-none items-center gap-1.5 font-semibold transition-colors ${
				checked
					? "text-[var(--color-text-brand)]"
					: "text-[var(--color-text-tertiary)]"
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
				className="peer sr-only"
			/>
			<span
				aria-hidden="true"
				className={`relative h-3 w-5 shrink-0 rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-ring-focus-visible)] peer-focus-visible:ring-offset-1 ${
					checked
						? "border-[var(--color-bg-control-checked)] bg-[var(--color-bg-control-checked)]"
						: "border-[var(--color-border-panel)] bg-[var(--color-bg-control)]"
				}`}
			>
				<span
					aria-hidden="true"
					className={`absolute top-px left-px size-2 rounded-full bg-white shadow-sm transition-transform ${
						checked ? "translate-x-2" : "translate-x-0"
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
			className="inline-flex h-5 items-center gap-1.5 rounded-[5px] px-1.5 transition-colors hover:bg-[var(--color-bg-hover-canvas)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
		>
			{hasWorkingChanges ? null : (
				<Flag aria-hidden="true" className="h-3 w-3" />
			)}
			{hasWorkingChanges ? <WorkingDot /> : null}
			<span>{statusLabel}</span>
		</button>
	) : (
		<span className="inline-flex items-center gap-1.5">
			{hasWorkingChanges ? null : (
				<Flag aria-hidden="true" className="h-3 w-3" />
			)}
			{hasWorkingChanges ? <WorkingDot /> : null}
			<span>{statusLabel}</span>
		</span>
	);
}
