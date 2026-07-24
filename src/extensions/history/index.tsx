import { History } from "lucide-react";
import { LixProvider, useQuery } from "@/lib/lix-react";
import { selectCheckpointsWithFileCounts, type CheckpointRow } from "@/queries";
import { createReactExtensionDefinition } from "@/extension-runtime/react-extension";
import { parseExtensionManifest } from "@/extension-runtime/extension-manifest";
import { formatCheckpointRelativeTime } from "@/lib/checkpoint-format";
import manifestJson from "./manifest.json";

export function HistoryView() {
	return (
		<section
			aria-label="Checkpoint history"
			className="min-h-0 flex-1 overflow-y-auto p-2"
		>
			<CheckpointList />
		</section>
	);
}

function CheckpointList() {
	const checkpoints = useQuery((lix) => selectCheckpointsWithFileCounts(lix));

	return (
		<ol aria-label="Checkpoints" className="space-y-0">
			{checkpoints.map((checkpoint, index) => (
				<CheckpointItem
					key={checkpoint.commit_id}
					checkpoint={checkpoint}
					fileCount={checkpoint.file_count}
					index={index}
					count={checkpoints.length}
				/>
			))}
		</ol>
	);
}

function CheckpointItem({
	checkpoint,
	fileCount,
	index,
	count,
}: {
	readonly checkpoint: CheckpointRow;
	readonly fileCount: number;
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

	return (
		<li
			aria-current={index === 0 ? "true" : undefined}
			className={`flex min-h-10 gap-2 rounded-[8px] border px-2 py-1.5 ${
				index === 0
					? "border-[var(--color-border-brand-soft)] bg-[var(--color-bg-brand-soft)]"
					: "border-transparent"
			}`}
		>
			<span
				className={`flex h-5 w-5 shrink-0 items-center justify-center ${
					index === 0
						? "text-[var(--color-icon-brand)]"
						: "text-[var(--color-icon-quaternary)]"
				}`}
			>
				<FilledFlag />
			</span>
			<div className="min-w-0">
				<p className="truncate text-[13px] leading-4 font-semibold text-[var(--color-text-primary)]">
					{label}
				</p>
				<p className="text-[11.5px] leading-4 text-[var(--color-text-tertiary)]">
					<time dateTime={checkpoint.created_at} title={checkpoint.created_at}>
						{formatCheckpointRelativeTime(checkpoint.created_at)}
					</time>
					<span aria-hidden="true"> · </span>
					<span>
						{fileCount} {fileCount === 1 ? "file" : "files"}
					</span>
				</p>
			</div>
		</li>
	);
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
	description: "Browse workspace checkpoints.",
	icon: History,
	component: ({ atelier }) => (
		<LixProvider lix={atelier.lix}>
			<HistoryView />
		</LixProvider>
	),
});
