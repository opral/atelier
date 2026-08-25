import { type JSX, type ReactNode } from "react";
import { Flag } from "lucide-react";
import { useQueryResult } from "@/lib/lix-react";
import { selectWorkingChangeCount } from "@/queries";

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
	onOpenWorkingChanges,
	onOpenHistory,
}: {
	readonly readOnly?: boolean;
	readonly autoAcceptAgentChanges?: boolean;
	readonly onAutoAcceptAgentChangesChange?: (enabled: boolean) => void;
	readonly onOpenWorkingChanges?: () => void;
	readonly onOpenHistory?: () => void;
}): JSX.Element {
	const workingChangeCount = useQueryResult((queryLix) =>
		selectWorkingChangeCount(queryLix),
	);
	if (workingChangeCount.status === "error") throw workingChangeCount.error;
	const workingRow = workingChangeCount.rows[0];
	const changeCount = workingRow?.change_count ?? 0;
	const fileCount = workingRow?.file_count ?? 0;
	const workingCountLabel =
		fileCount > 0
			? `${fileCount} ${fileCount === 1 ? "file" : "files"} changed`
			: `${changeCount} ${changeCount === 1 ? "change" : "changes"}`;

	const historyStatus =
		workingChangeCount.status === "pending" ? null : changeCount === 0 ? (
			<CheckpointStatus
				statusLabel={LATEST_CHECKPOINT_TITLE}
				onActivate={onOpenHistory}
			/>
		) : (
			<CheckpointStatus
				statusLabel={`${workingCountLabel} since checkpoint`}
				hasWorkingChanges
				onActivate={onOpenWorkingChanges}
			/>
		);

	return (
		<StatusBar
			left={historyStatus}
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
					? "text-[var(--color-brand-700)]"
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
						? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)]"
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
	onActivate,
}: {
	readonly statusLabel: string;
	readonly hasWorkingChanges?: boolean;
	readonly onActivate?: () => void;
}): JSX.Element {
	const actionLabel = hasWorkingChanges
		? "Open changes review"
		: "Open checkpoint history";

	return onActivate ? (
		<button
			type="button"
			aria-label={`${statusLabel}. ${actionLabel}`}
			onClick={onActivate}
			onMouseDown={(event) => event.preventDefault()}
			className="inline-flex h-5 items-center gap-1.5 rounded-[5px] px-1.5 transition-colors hover:bg-[var(--color-bg-hover-canvas)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
		>
			{hasWorkingChanges ? null : (
				<Flag aria-hidden="true" className="h-3 w-3" />
			)}
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
			{hasWorkingChanges ? null : (
				<Flag aria-hidden="true" className="h-3 w-3" />
			)}
			{hasWorkingChanges ? (
				<span
					aria-hidden="true"
					className="h-1.5 w-1.5 rounded-full bg-[var(--color-icon-brand)]"
				/>
			) : null}
			<span>{statusLabel}</span>
		</span>
	);
}
