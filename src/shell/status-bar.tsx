import { Suspense, useState, type JSX, type ReactNode } from "react";
import {
	BookmarkCheck,
	BookmarkPlus,
	History,
	LoaderCircle,
} from "lucide-react";
import { useLix, useQuery } from "@/lib/lix-react";
import { selectLatestCheckpoint, selectWorkingChangeCount } from "@/queries";
import { formatCheckpointCreatedAt } from "@/lib/checkpoint-format";

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
	onOpenHistory,
}: {
	readonly readOnly?: boolean;
	readonly onOpenHistory?: () => void;
}): JSX.Element {
	const lix = useLix();
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const workingChangeCount = useQuery((queryLix) =>
		selectWorkingChangeCount(queryLix),
	);
	const changeCount = workingChangeCount[0]?.change_count ?? 0;

	const handleCreateCheckpoint = async () => {
		if (isCreating || changeCount === 0) return;
		setError(null);
		setIsCreating(true);
		try {
			await lix.createCheckpoint();
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : "Checkpoint creation failed",
			);
		} finally {
			setIsCreating(false);
		}
	};

	const historyStatus =
		changeCount === 0 ? (
			<Suspense
				fallback={
					<CheckpointHistoryStatus
						statusLabel="Checkpointed"
						onOpenHistory={onOpenHistory}
					/>
				}
			>
				<CleanCheckpointStatus onOpenHistory={onOpenHistory} />
			</Suspense>
		) : (
			<CheckpointHistoryStatus
				statusLabel={`${changeCount} working ${
					changeCount === 1 ? "change" : "changes"
				}`}
				hasWorkingChanges
				onOpenHistory={onOpenHistory}
			/>
		);

	return (
		<StatusBar
			left={
				<>
					{historyStatus}
					{error ? (
						<span
							role="alert"
							title={error}
							className="truncate text-[var(--color-text-status-danger)]"
						>
							Couldn&apos;t create checkpoint
						</span>
					) : null}
				</>
			}
			right={
				readOnly || changeCount === 0 ? undefined : (
					<button
						type="button"
						onClick={() => void handleCreateCheckpoint()}
						disabled={isCreating}
						className="inline-flex h-5 items-center gap-1 rounded-[5px] border border-[var(--color-border-brand-soft)] bg-[var(--color-bg-brand-soft)] px-2 font-semibold text-[var(--color-text-link)] transition-colors hover:border-[var(--color-border-selection-current)] hover:text-[var(--color-text-link-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] disabled:cursor-default disabled:text-[var(--color-text-quaternary)]"
					>
						{isCreating ? (
							<LoaderCircle
								aria-hidden="true"
								className="h-3 w-3 animate-spin"
							/>
						) : (
							<BookmarkPlus aria-hidden="true" className="h-3 w-3" />
						)}
						{isCreating ? "Checkpointing…" : "Checkpoint"}
					</button>
				)
			}
		/>
	);
}

function CleanCheckpointStatus({
	onOpenHistory,
}: {
	readonly onOpenHistory?: () => void;
}): JSX.Element {
	const checkpoints = useQuery((lix) => selectLatestCheckpoint(lix));
	const latestCheckpoint = checkpoints[0];
	const statusLabel = latestCheckpoint
		? `Checkpointed · ${formatCheckpointCreatedAt(latestCheckpoint.created_at)}`
		: "Checkpointed";

	return (
		<CheckpointHistoryStatus
			statusLabel={statusLabel}
			onOpenHistory={onOpenHistory}
		/>
	);
}

function CheckpointHistoryStatus({
	statusLabel,
	hasWorkingChanges = false,
	onOpenHistory,
}: {
	readonly statusLabel: string;
	readonly hasWorkingChanges?: boolean;
	readonly onOpenHistory?: () => void;
}): JSX.Element {
	const StatusIcon = hasWorkingChanges ? History : BookmarkCheck;

	return onOpenHistory ? (
		<button
			type="button"
			aria-label={`${statusLabel}. Open checkpoint history`}
			onClick={onOpenHistory}
			className="inline-flex h-5 items-center gap-1.5 rounded-[5px] px-1.5 transition-colors hover:bg-[var(--color-bg-hover-canvas)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
		>
			<StatusIcon aria-hidden="true" className="h-3 w-3" />
			{hasWorkingChanges ? (
				<span
					aria-hidden="true"
					className="h-1.5 w-1.5 rounded-full bg-[var(--color-icon-brand)]"
				/>
			) : null}
			<span>{statusLabel}</span>
		</button>
	) : (
		<span className="inline-flex items-center gap-1.5">
			<StatusIcon aria-hidden="true" className="h-3 w-3" />
			<span>{statusLabel}</span>
		</span>
	);
}
