import type { ReactNode } from "react";
import type { AtelierDiffSession } from "../extension-api";
import { CheckpointAbsentFile } from "./checkpoint-absent-file";
import {
	editorRevisionMode,
	normalizeEditorRevisionState,
} from "./editor-revision-state";
import type {
	ExtensionDefinition,
	ExtensionRuntime,
	ExtensionState,
} from "./types";

/**
 * One side of a comparison. `commitId` is the commit the view is pinned to.
 * `exists` is false where the file has no version at all: an added file has
 * no before side, a removed one has no after side.
 */
export type ViewDiffSide = {
	readonly commitId: string | null;
	readonly exists: boolean;
};

export type ViewDiffSides = {
	readonly path: string;
	readonly before: ViewDiffSide;
	readonly after: ViewDiffSide;
};

export type ViewDiffSideKey = "before" | "after";

/**
 * A pane's host id is its view's, then the side. The separator never occurs
 * in a view instance id, so the registry can still find the view a pane
 * belongs to.
 */
export const VIEW_DIFF_SIDE_SEPARATOR = "#";

/**
 * The two sides a view instance has to show, or null when it has one side —
 * or renders the diff itself.
 *
 * Every view is asked. A view that declares `diff` gets both refs and draws
 * whatever it draws; every other view is compared by the shell, so a diff
 * never depends on the file type.
 */
export function viewDiffSides(args: {
	readonly definition: ExtensionDefinition;
	readonly session: AtelierDiffSession | null | undefined;
	readonly state: ExtensionState | null | undefined;
}): ViewDiffSides | null {
	if (args.definition.diff) return null;
	const state = args.state;
	const fileId = typeof state?.fileId === "string" ? state.fileId : null;
	if (!fileId) return null;
	const filePath = typeof state?.filePath === "string" ? state.filePath : "";
	const reviewed = workingReviewFile(args.session, fileId);
	if (reviewed?.epoch) {
		return {
			path: reviewed.path || filePath,
			before: {
				commitId: reviewed.epoch.beforeCommitId,
				exists: reviewed.changeKind !== "added",
			},
			after: {
				commitId: reviewed.epoch.afterCommitId,
				exists: reviewed.changeKind !== "removed",
			},
		};
	}
	const revision = normalizeEditorRevisionState(state);
	if (editorRevisionMode(revision) !== "diff") return null;
	return {
		path: filePath,
		before: {
			commitId: revision.beforeCommitId,
			exists: revision.beforeExists && revision.beforeCommitId !== null,
		},
		after: {
			commitId: revision.afterCommitId,
			exists: revision.afterExists && revision.afterCommitId !== null,
		},
	};
}

/** The file's pending entry in a working review, with its certified epoch. */
function workingReviewFile(
	session: AtelierDiffSession | null | undefined,
	fileId: string,
) {
	if (!session || !("working" in session.target)) return null;
	const file = session.files.find((entry) => entry.id === fileId);
	if (!file || file.review?.status !== "pending") return null;
	return {
		path: file.path,
		changeKind: file.changeKind,
		epoch: file.workingEpoch,
	};
}

/** A pane shows one commit, read-only, and never reviews anything itself. */
export function viewDiffSideState(args: {
	readonly state: ExtensionState | null | undefined;
	readonly path: string;
	readonly commitId: string;
}): ExtensionState {
	const {
		beforeCommitId: _before,
		afterCommitId: _after,
		beforeExists: _beforeExists,
		afterExists: _afterExists,
		...rest
	} = (args.state ?? {}) as Record<string, unknown>;
	return {
		...rest,
		filePath: args.path || (rest.filePath as string | undefined) || "",
		sourceCommitId: args.commitId,
	} as ExtensionState;
}

/** The runtime a pane runs under: no review session of its own, read-only. */
export function viewDiffSideRuntime(
	atelier: ExtensionRuntime,
): ExtensionRuntime {
	return {
		...atelier,
		readOnly: true,
		diff: { ...atelier.diff, session: null },
	};
}

/**
 * Atelier's diff of last resort: the same view twice, the older commit on the
 * left and the newer on the right. A view that cannot diff its own file type
 * still shows what a write did.
 */
export function ViewDiffCompare({
	sides,
	renderSide,
}: {
	readonly sides: ViewDiffSides;
	readonly renderSide: (side: {
		readonly key: ViewDiffSideKey;
		readonly commitId: string;
	}) => ReactNode;
}) {
	return (
		<div
			className="flex min-h-0 flex-1 flex-row"
			data-testid="view-diff-compare"
		>
			<ComparePane
				sideKey="before"
				label="Before"
				side={sides.before}
				path={sides.path}
				renderSide={renderSide}
			/>
			<ComparePane
				sideKey="after"
				label="After"
				side={sides.after}
				path={sides.path}
				renderSide={renderSide}
			/>
		</div>
	);
}

function ComparePane({
	sideKey,
	label,
	side,
	path,
	renderSide,
}: {
	readonly sideKey: ViewDiffSideKey;
	readonly label: string;
	readonly side: ViewDiffSide;
	readonly path: string;
	readonly renderSide: (side: {
		readonly key: ViewDiffSideKey;
		readonly commitId: string;
	}) => ReactNode;
}) {
	const fileName = path.split("/").filter(Boolean).at(-1);
	return (
		<section
			aria-label={fileName ? `${label}: ${fileName}` : label}
			data-diff-side={sideKey}
			className="flex min-h-0 min-w-0 flex-1 flex-col border-[var(--color-border-subtle)] not-last:border-r"
		>
			<header className="flex h-7 flex-none items-center px-3 text-[11px] font-medium tracking-wide text-[var(--color-text-tertiary)] uppercase">
				{label}
			</header>
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				{side.exists && side.commitId ? (
					renderSide({ key: sideKey, commitId: side.commitId })
				) : (
					<CheckpointAbsentFile filePath={path} commitId={side.commitId} />
				)}
			</div>
		</section>
	);
}
