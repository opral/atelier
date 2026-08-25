import { useEffect, useState, type ReactNode } from "react";
import { History } from "lucide-react";
import type { ExtensionRuntime } from "@/extension-runtime/types";
import { useQuery } from "@/lib/lix-react";
import {
	selectCheckpoints,
	selectWorkingChangeCount,
	type CheckpointRow,
} from "@/queries";
import { createReactExtensionDefinition } from "@/extension-runtime/react-extension";
import { parseExtensionManifest } from "@/extension-runtime/extension-manifest";
import { formatCheckpointRelativeTime } from "@/lib/checkpoint-format";
import manifestJson from "./manifest.json";

/**
 * The History tab lists workspace moments: working changes first, then
 * checkpoints. One click on a checkpoint opens a read-only comparison from its
 * immediate predecessor to that checkpoint — it never restores anything.
 */
export function HistoryView({
	atelier,
}: {
	readonly atelier: ExtensionRuntime;
}) {
	return (
		<section
			aria-label="Checkpoint history"
			className="min-h-0 flex-1 overflow-y-auto p-2"
		>
			<WorkingChangesRow atelier={atelier} />
			<CheckpointList atelier={atelier} />
		</section>
	);
}

function WorkingChangesRow({
	atelier,
}: {
	readonly atelier: ExtensionRuntime;
}) {
	const workingChangeCount = useQuery((queryLix) =>
		selectWorkingChangeCount(queryLix),
	);
	const changeCount = workingChangeCount[0]?.change_count ?? 0;
	const fileCount = workingChangeCount[0]?.file_count ?? 0;
	const workingCountLabel =
		fileCount > 0
			? `${fileCount} ${fileCount === 1 ? "file" : "files"} changed`
			: `${changeCount} ${changeCount === 1 ? "change" : "changes"}`;
	const isViewing =
		atelier.diff.session !== null &&
		"working" in atelier.diff.session.target;
	// Pressing the active entry again leaves review mode — the row toggles.
	const toggleWorkingChanges = () =>
		isViewing
			? atelier.diff.exit()
			: void atelier.diff.open({ target: { working: true } });

	return (
		<div
			aria-current={isViewing ? "true" : undefined}
			className={`rounded-[8px] border transition-colors duration-200 motion-reduce:transition-none ${
				isViewing
					? "border-[var(--color-border-brand-soft)] bg-[var(--color-bg-brand-soft)]"
					: "border-transparent"
			}`}
		>
			<button
				type="button"
				aria-label="Working changes"
				disabled={changeCount === 0}
				onClick={toggleWorkingChanges}
				onMouseDown={(event) => event.preventDefault()}
				data-attr="history-working-changes"
				className={`flex w-full min-h-10 items-start gap-0.5 rounded-[8px] py-1.5 text-left ${
					changeCount === 0
						? "opacity-55"
						: isViewing
							? "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
							: "hover:bg-[var(--color-bg-hover-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
				}`}
			>
				<span className="flex h-5 w-4 shrink-0 items-center justify-center">
					<span
						aria-hidden="true"
						className="h-2 w-2 rounded-full bg-[var(--color-icon-brand)] ring-3 ring-[var(--color-bg-brand-soft)]"
					/>
				</span>
				<span className="min-w-0">
					<span className="block truncate text-[13px] leading-4 font-semibold text-[var(--color-text-primary)]">
						Working changes
					</span>
					<span className="block text-[11.5px] leading-4 text-[var(--color-text-tertiary)]">
						{changeCount === 0
							? "now · nothing new"
							: `now · ${workingCountLabel}`}
					</span>
				</span>
			</button>
			<AnimatedHistoryDisclosure open={isViewing}>
				<WorkingChangeFileList atelier={atelier} />
			</AnimatedHistoryDisclosure>
		</div>
	);
}

function WorkingChangeFileList({
	atelier,
}: {
	readonly atelier: ExtensionRuntime;
}) {
	const session = atelier.diff.session;
	const files = session && "working" in session.target ? session.files : [];
	const openWorkingChangeFile = atelier.diff.openFile;
	if (files.length === 0) return null;

	return (
		<ul aria-label="Files in working changes" className="px-2 pb-2 pl-7">
			{files.map((file) => (
				<li key={file.id}>
					<button
						type="button"
						disabled={!openWorkingChangeFile}
						onClick={(event) => {
							event.stopPropagation();
							openWorkingChangeFile?.(file.path);
						}}
						data-attr="history-open-working-change-file"
						onMouseDown={(event) => event.preventDefault()}
						className="flex h-6.5 w-full items-center gap-1.5 rounded-[6px] px-1.5 text-left text-[11.5px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
					>
						<img
							src={atelier.icons.fileUrl(file.path)}
							alt=""
							className="h-3.5 w-3.5 shrink-0"
						/>
						<span className="truncate">
							{fileNameFromHistoryPath(file.path)}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

function CheckpointList({ atelier }: { readonly atelier: ExtensionRuntime }) {
	const checkpoints = useQuery((lix) => selectCheckpoints(lix));

	return (
		<ol aria-label="Checkpoints" className="space-y-0">
			{checkpoints.map((checkpoint, index) => (
				<CheckpointItem
					key={checkpoint.commit_id}
					atelier={atelier}
					checkpoint={checkpoint}
					previousCommitId={checkpoints[index + 1]?.commit_id}
					index={index}
					count={checkpoints.length}
				/>
			))}
		</ol>
	);
}

function CheckpointItem({
	atelier,
	checkpoint,
	previousCommitId,
	index,
	count,
}: {
	readonly atelier: ExtensionRuntime;
	readonly checkpoint: CheckpointRow;
	readonly previousCommitId: string | undefined;
	readonly index: number;
	readonly count: number;
}) {
	const isInitial = index === count - 1;
	const label =
		count === 1 || isInitial
			? "Initial checkpoint"
			: index === 0
				? "Latest checkpoint"
				: "Checkpoint";
	const session = atelier.diff.session;
	const isViewing =
		session !== null &&
		"commitId" in session.target &&
		session.target.commitId === checkpoint.commit_id;

	return (
		<li
			aria-current={isViewing ? "true" : undefined}
			className={`rounded-[8px] border transition-colors duration-200 motion-reduce:transition-none ${
				isViewing
					? "border-[var(--color-border-brand-soft)] bg-[var(--color-bg-brand-soft)]"
					: "border-transparent"
			}`}
		>
			<button
				type="button"
				disabled={!previousCommitId}
				onClick={() => {
					if (!previousCommitId) return;
					// Pressing the viewed checkpoint again leaves review mode.
					if (isViewing) {
						atelier.diff.exit();
						return;
					}
					void atelier.diff.open({
						base: { commitId: previousCommitId },
						target: { commitId: checkpoint.commit_id },
					});
				}}
				onMouseDown={(event) => event.preventDefault()}
				data-attr="history-view-checkpoint"
				className={`flex w-full min-h-10 items-start gap-0.5 rounded-[8px] py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] ${
					isViewing ? "" : "hover:bg-[var(--color-bg-hover-canvas)]"
				}`}
			>
				<span
					className={`flex h-5 w-4 shrink-0 items-center justify-center ${
						isViewing
							? "text-[var(--color-icon-brand)]"
							: "text-[var(--color-icon-quaternary)]"
					}`}
				>
					<FilledFlag />
				</span>
				<span className="min-w-0">
					<span className="block truncate text-[13px] leading-4 font-semibold text-[var(--color-text-primary)]">
						{label}
					</span>
					<span className="block text-[11.5px] leading-4 text-[var(--color-text-tertiary)]">
						<time
							dateTime={checkpoint.created_at}
							title={checkpoint.created_at}
						>
							{formatCheckpointRelativeTime(checkpoint.created_at)}
						</time>
					</span>
				</span>
			</button>
			<AnimatedHistoryDisclosure open={isViewing}>
				<CheckpointFileList atelier={atelier} commitId={checkpoint.commit_id} />
			</AnimatedHistoryDisclosure>
		</li>
	);
}

const HISTORY_DISCLOSURE_DURATION_MS = 200;

function AnimatedHistoryDisclosure({
	open,
	children,
}: {
	readonly open: boolean;
	readonly children: ReactNode;
}) {
	const [isMounted, setIsMounted] = useState(open);
	const [isExpanded, setIsExpanded] = useState(open);

	useEffect(() => {
		let firstFrame: number | undefined;
		let secondFrame: number | undefined;
		let unmountTimer: ReturnType<typeof setTimeout> | undefined;

		if (open) {
			setIsMounted(true);
			firstFrame = window.requestAnimationFrame(() => {
				secondFrame = window.requestAnimationFrame(() => {
					setIsExpanded(true);
				});
			});
		} else {
			setIsExpanded(false);
			unmountTimer = setTimeout(
				() => setIsMounted(false),
				HISTORY_DISCLOSURE_DURATION_MS,
			);
		}

		return () => {
			if (firstFrame !== undefined) window.cancelAnimationFrame(firstFrame);
			if (secondFrame !== undefined) window.cancelAnimationFrame(secondFrame);
			if (unmountTimer !== undefined) clearTimeout(unmountTimer);
		};
	}, [open]);

	return (
		<div
			aria-hidden={!open}
			data-attr="history-disclosure"
			data-state={open ? "open" : "closed"}
			inert={open ? undefined : true}
			className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${
				isExpanded
					? "grid-rows-[1fr] opacity-100"
					: "pointer-events-none grid-rows-[0fr] opacity-0"
			}`}
		>
			<div className="min-h-0 overflow-hidden">
				{isMounted ? children : null}
			</div>
		</div>
	);
}

function CheckpointFileList({
	atelier,
	commitId,
}: {
	readonly atelier: ExtensionRuntime;
	readonly commitId: string;
}) {
	const session = atelier.diff.session;
	const files =
		session !== null &&
		"commitId" in session.target &&
		session.target.commitId === commitId
			? session.files
			: [];
	const openCheckpointFile = atelier.diff.openFile;

	if (files.length === 0) return null;
	return (
		<ul aria-label="Files at this checkpoint" className="px-2 pb-2 pl-7">
			{files.map((file) => (
				<li key={file.id}>
					<button
						type="button"
						disabled={!openCheckpointFile}
						onClick={(event) => {
							event.stopPropagation();
							openCheckpointFile?.(file.path);
						}}
						data-attr="history-open-checkpoint-file"
						onMouseDown={(event) => event.preventDefault()}
						className="flex h-6.5 w-full items-center gap-1.5 rounded-[6px] px-1.5 text-left text-[11.5px] font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover-canvas)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
					>
						<img
							src={atelier.icons.fileUrl(file.path)}
							alt=""
							className="h-3.5 w-3.5 shrink-0"
						/>
						<span className="truncate">
							{fileNameFromHistoryPath(file.path)}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

function fileNameFromHistoryPath(path: string): string {
	const segments = path.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? path;
}

function FilledFlag() {
	return (
		<svg
			aria-hidden="true"
			data-checkpoint-flag=""
			className="h-3 w-3"
			viewBox="0 0 16 16"
			fill="none"
		>
			<path
				fill="currentColor"
				d="M3 1.25a.75.75 0 0 1 1.5 0v.5h7.1a.75.75 0 0 1 .62 1.17L10.83 5l1.39 2.08a.75.75 0 0 1-.62 1.17H4.5v6.5a.75.75 0 0 1-1.5 0V1.25Z"
			/>
		</svg>
	);
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_history/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Browse repository checkpoints.",
	icon: History,
	component: ({ atelier }) => <HistoryView atelier={atelier} />,
});
