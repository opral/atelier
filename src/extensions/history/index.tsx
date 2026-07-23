import { Bookmark, History } from "lucide-react";
import { LixProvider, useQuery } from "@/lib/lix-react";
import {
	selectCheckpoints,
	selectWorkingChangeCount,
	type CheckpointRow,
} from "@/queries";
import { createReactExtensionDefinition } from "@/extension-runtime/react-extension";
import { parseExtensionManifest } from "@/extension-runtime/extension-manifest";
import {
	formatCheckpointCreatedAt,
	shortCheckpointId,
} from "@/lib/checkpoint-format";
import manifestJson from "./manifest.json";

export function HistoryView() {
	return (
		<section
			aria-label="Checkpoint history"
			className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
		>
			<WorkingChangesSummary />

			<h2 className="px-0.5 pb-2 text-[11px] font-semibold tracking-[0.04em] text-[var(--color-text-tertiary)] uppercase">
				Checkpoints
			</h2>
			<CheckpointList />
		</section>
	);
}

function WorkingChangesSummary() {
	const workingChangeCount = useQuery((lix) => selectWorkingChangeCount(lix));
	const changeCount = workingChangeCount[0]?.change_count ?? 0;

	return (
		<div
			data-testid="working-changes-summary"
			className="mb-3 flex items-start gap-2.5 rounded-[8px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-panel-muted)] px-2.5 py-2.5"
		>
			<span
				aria-hidden="true"
				className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
					changeCount > 0
						? "bg-[var(--color-icon-brand)]"
						: "bg-[var(--color-icon-quaternary)]"
				}`}
			/>
			<div className="min-w-0">
				<p className="text-[12.5px] leading-4 font-semibold text-[var(--color-text-primary)]">
					{changeCount > 0 ? "Working changes" : "No working changes"}
				</p>
				<p className="mt-0.5 text-[11.5px] leading-4 text-[var(--color-text-tertiary)]">
					{changeCount > 0
						? `${formatChangeCount(changeCount)} since the latest checkpoint`
						: "At the latest checkpoint"}
				</p>
			</div>
		</div>
	);
}

function CheckpointList() {
	const checkpoints = useQuery((lix) => selectCheckpoints(lix));

	return (
		<ol aria-label="Checkpoints" className="space-y-0">
			{checkpoints.map((checkpoint, index) => (
				<CheckpointItem
					key={checkpoint.commit_id}
					checkpoint={checkpoint}
					index={index}
					count={checkpoints.length}
				/>
			))}
		</ol>
	);
}

function CheckpointItem({
	checkpoint,
	index,
	count,
}: {
	readonly checkpoint: CheckpointRow;
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
		<li className="relative flex min-h-14 gap-2.5 px-0.5 pb-3">
			{index < count - 1 ? (
				<span
					aria-hidden="true"
					className="absolute top-6 bottom-0 left-[11px] w-px bg-[var(--color-border-panel)]"
				/>
			) : null}
			<span className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] text-[var(--color-icon-secondary)]">
				<Bookmark aria-hidden="true" className="h-3 w-3" />
			</span>
			<div className="min-w-0 pt-px">
				<p className="text-[12.5px] leading-4 font-medium text-[var(--color-text-primary)]">
					{label}
				</p>
				<p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] leading-4 text-[var(--color-text-tertiary)]">
					<time
						dateTime={checkpoint.created_at}
						title={checkpoint.created_at}
						className="truncate"
					>
						{formatCheckpointCreatedAt(checkpoint.created_at)}
					</time>
					<span aria-hidden="true">·</span>
					<code
						title={checkpoint.commit_id}
						className="shrink-0 font-mono text-[10.5px] text-[var(--color-text-quaternary)]"
					>
						{shortCheckpointId(checkpoint.commit_id)}
					</code>
				</p>
			</div>
		</li>
	);
}

function formatChangeCount(count: number): string {
	return `${count} ${count === 1 ? "change" : "changes"}`;
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
