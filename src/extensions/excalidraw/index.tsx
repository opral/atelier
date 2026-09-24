import { SceneContent } from "./scene-content";
import {
	loadTextFile,
	preparedFile,
	PreparedFileSurface,
} from "../../extension-runtime/prepared-file";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { AtelierExtensionPreferences } from "@/extension-api";
import { PenTool, TriangleAlert } from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import type { ExtensionRuntime } from "@/extension-runtime/types";
import {
	editorRevisionMode,
	normalizeEditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import { useSyncedTextFile } from "@/extension-runtime/use-synced-text-file";
import { CheckpointAbsentFile } from "@/extension-runtime/checkpoint-absent-file";
import { fileNameFromPath } from "@/extension-runtime/extension-instance-helpers";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { useLix, useQueryResult } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	getFileDataAtCommit,
	workingReviewFile,
} from "@/shell/external-write-review-history";
import { DiffSides, viewShowsDiff } from "@/extension-runtime/diff-sides";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import { parseExcalidrawScene } from "./scene";
import { useRememberedViewport } from "./viewport";
import manifestJson from "./manifest.json";
import "./style.css";

const ExcalidrawCanvas = lazy(() => import("./excalidraw-canvas"));

type ExcalidrawFileRow = {
	readonly id: string;
	readonly path: string;
	readonly content: unknown;
};

type ExcalidrawViewProps = {
	readonly atelier: ExtensionRuntime;
	readonly fileId: string;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
	/**
	 * The extension's private preferences (`view.preferences`), where the
	 * viewport of each file is remembered across reloads.
	 */
	readonly preferences?: AtelierExtensionPreferences;
};

export function ExcalidrawView(props: ExcalidrawViewProps) {
	return (
		<Suspense fallback={<ExcalidrawLoadingState />}>
			<ExcalidrawViewContent {...props} />
		</Suspense>
	);
}

function ExcalidrawViewContent({ fileId, ...props }: ExcalidrawViewProps) {
	assertFileId(fileId);
	const revision = normalizeEditorRevisionState(props);
	// A scene cannot be diffed in place, so both revisions are drawn: the
	// checkpoint on the left, the working file on the right.
	const reviewFile = workingReviewFile(props.atelier.diff.session, fileId);
	const epoch =
		reviewFile?.review?.status === "pending"
			? reviewFile.workingEpoch
			: undefined;
	if (epoch) {
		return (
			<ExcalidrawDiffSides
				{...props}
				fileId={fileId}
				filePath={reviewFile?.path ?? props.filePath}
				beforeCommitId={epoch.beforeCommitId}
				afterCommitId={epoch.afterCommitId}
			/>
		);
	}
	if (revision.beforeCommitId && revision.afterCommitId) {
		return (
			<ExcalidrawDiffSides
				{...props}
				fileId={fileId}
				beforeCommitId={revision.beforeCommitId}
				afterCommitId={revision.afterCommitId}
			/>
		);
	}
	if (editorRevisionMode(revision) !== "editor") {
		return (
			<HistoricalExcalidrawView
				{...props}
				fileRow={undefined}
				fileId={fileId}
				commitId={revision.afterCommitId ?? revision.beforeCommitId}
			/>
		);
	}
	return <LiveExcalidrawViewContent fileId={fileId} {...props} />;
}

/** The scene at each end of a comparison, drawn side by side. */
function ExcalidrawDiffSides({
	fileId,
	filePath,
	beforeCommitId,
	afterCommitId,
	...props
}: ExcalidrawViewProps & {
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
}) {
	const path = filePath || `/${fileId}.excalidraw`;
	return (
		<DiffSides
			filePath={path}
			beforeCommitId={beforeCommitId}
			afterCommitId={afterCommitId}
			before={
				<HistoricalExcalidrawView
					{...props}
					fileRow={undefined}
					fileId={fileId}
					filePath={path}
					commitId={beforeCommitId}
				/>
			}
			after={
				<HistoricalExcalidrawView
					{...props}
					fileRow={undefined}
					fileId={fileId}
					filePath={path}
					commitId={afterCommitId}
				/>
			}
		/>
	);
}

function LiveExcalidrawViewContent({ fileId, ...props }: ExcalidrawViewProps) {
	// Subscribed (unlike the text view) so a reopened view never mounts from
	// a stale cached row: the canvas seeds itself from this snapshot.
	const fileResult = useQueryResult<ExcalidrawFileRow>((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "content"])
			.where("id", "=", fileId)
			.limit(1),
	);
	// Once the file has been read, a re-read never takes the canvas down: the
	// last row is held while the query is pending again, so the canvas (and
	// the viewport it is at) stays mounted. Only the first read shows the
	// loading state.
	const [held, setHeld] = useState<{
		readonly fileId: string;
		readonly rows: readonly ExcalidrawFileRow[];
	} | null>(null);
	if (
		fileResult.status === "success" &&
		(held?.fileId !== fileId || held.rows !== fileResult.rows)
	) {
		setHeld({ fileId, rows: fileResult.rows });
	}
	if (fileResult.status === "error") throw fileResult.error;
	const rows =
		fileResult.status === "success"
			? fileResult.rows
			: held?.fileId === fileId
				? held.rows
				: undefined;
	if (!rows) return <ExcalidrawLoadingState />;
	const fileRow = rows[0];

	if (!fileRow) {
		if (workingReviewFile(props.atelier.diff.session, fileId)) {
			return <ExcalidrawReviewUnavailable />;
		}
		return (
			<div className="flex h-full items-center justify-center text-sm text-fg-subtle">
				File not found in the workspace.
			</div>
		);
	}

	// A file under review never reaches the editor: the comparison above
	// replaces it while the review is open.
	return (
		<EditableExcalidrawView
			key={fileId}
			{...props}
			fileId={fileId}
			fileRow={fileRow}
		/>
	);
}

function EditableExcalidrawView({
	atelier,
	fileId,
	filePath,
	fileRow,
	preferences,
}: Omit<ExcalidrawViewProps, "beforeCommitId" | "afterCommitId"> & {
	readonly fileRow: ExcalidrawFileRow;
}) {
	const resolvedPath = fileRow.path || filePath || `/${fileId}.excalidraw`;
	const fileText = useMemo(
		() => decodeFileDataToText(fileRow.content),
		[fileRow.content],
	);

	const originKey = useMemo(() => createExcalidrawOriginKey(), []);
	const {
		text: documentText,
		saveError,
		persist: persistUserEdit,
	} = useSyncedTextFile({
		fileId,
		initialText: fileText,
		reviewText: null,
		reviewing: false,
		readOnly: atelier.readOnly,
		originKey,
	});

	const viewport = useRememberedViewport(fileId, preferences);

	const parsed = useMemo(
		() => parseExcalidrawScene(documentText),
		[documentText],
	);
	if (!parsed.ok) {
		return <InvalidSceneState filePath={resolvedPath} message={parsed.error} />;
	}

	return (
		<div
			className="atelier-excalidraw-view ph-mask ph-no-capture"
			data-testid="excalidraw-view"
		>
			<Suspense fallback={<ExcalidrawLoadingState />}>
				<ExcalidrawCanvas
					key={fileId}
					sceneJson={documentText}
					readOnly={atelier.readOnly}
					onSceneChange={persistUserEdit}
					viewport={viewport.viewport}
					onViewportChange={viewport.record}
				/>
			</Suspense>
			{saveError ? (
				<div className="atelier-excalidraw-save-error" role="alert">
					<TriangleAlert aria-hidden="true" size={13} />
					<span>Save failed: {saveError}</span>
				</div>
			) : null}
		</div>
	);
}

function ExcalidrawReviewUnavailable() {
	return (
		<div
			className="flex h-full items-center justify-center px-6 text-center text-sm text-fg-subtle"
			role="alert"
		>
			The working diff changed while it was being reviewed. Reopen the review.
		</div>
	);
}

function HistoricalExcalidrawView({
	fileRow,
	fileId,
	filePath,
	commitId,
}: Omit<ExcalidrawViewProps, "atelier"> & {
	readonly fileRow: ExcalidrawFileRow | undefined;
	readonly commitId: string | null;
}) {
	const lix = useLix();
	const [snapshotText, setSnapshotText] = useState<string | null>(null);
	const [absentAtCommit, setAbsentAtCommit] = useState(false);
	const [loadError, setLoadError] = useState(false);
	const liveContent = fileRow?.content;
	useEffect(() => {
		let cancelled = false;
		// The previous snapshot stays visible while the next commit loads, so
		// retargeting between checkpoints never flashes the loading state.
		setAbsentAtCommit(false);
		setLoadError(false);
		if (!commitId) {
			setSnapshotText(liveContent ? decodeFileDataToText(liveContent) : "");
			return;
		}
		void getFileDataAtCommit(lix, fileId, commitId)
			.then((data) => {
				if (cancelled) return;
				// No data at the commit means the file does not exist there yet;
				// the absence is temporal, not an empty document.
				if (data) setSnapshotText(decodeFileDataToText(data));
				else setAbsentAtCommit(true);
			})
			.catch(() => {
				if (!cancelled) setLoadError(true);
			});
		return () => {
			cancelled = true;
		};
	}, [commitId, fileId, liveContent, lix]);

	if (loadError) {
		return (
			<div
				className="flex h-full items-center justify-center text-sm text-fg-subtle"
				role="alert"
			>
				Could not load this file revision.
			</div>
		);
	}
	if (absentAtCommit) {
		return (
			<CheckpointAbsentFile
				filePath={fileRow?.path || filePath}
				commitId={commitId}
			/>
		);
	}
	if (snapshotText === null) return <ExcalidrawLoadingState />;
	const parsed = parseExcalidrawScene(snapshotText);
	if (!parsed.ok) {
		return (
			<InvalidSceneState
				filePath={fileRow?.path || filePath || `/${fileId}.excalidraw`}
				message={parsed.error}
			/>
		);
	}
	return (
		<div
			className="atelier-excalidraw-view ph-mask ph-no-capture"
			data-testid="excalidraw-view"
		>
			<Suspense fallback={<ExcalidrawLoadingState />}>
				<ExcalidrawCanvas
					key={`${fileId}:${commitId ?? "head"}`}
					sceneJson={snapshotText}
					readOnly
				/>
			</Suspense>
		</div>
	);
}

function InvalidSceneState({
	filePath,
	message,
}: {
	readonly filePath: string;
	readonly message: string;
}) {
	return (
		<div className="flex h-full min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
			<PenTool
				aria-hidden="true"
				className="size-7 text-fg-subtle"
				strokeWidth={1.5}
			/>
			<p className="mt-3 text-sm font-medium text-fg">
				This file cannot be opened as an Excalidraw scene.
			</p>
			<p className="mt-1 max-w-sm text-xs leading-relaxed text-fg-subtle">
				<span className="ph-mask">
					{fileNameFromPath(filePath) ?? filePath}
				</span>
				: {message}
			</p>
		</div>
	);
}

function ExcalidrawLoadingState() {
	return (
		<div
			aria-live="polite"
			className="flex h-full min-h-48 items-center justify-center px-3 py-2 text-fg-subtle"
			role="status"
		>
			<div className="flex items-center gap-2 text-sm">
				<AnimatedZap size={13} tone="muted" className="shrink-0" />
				<span>Loading drawing…</span>
			</div>
		</div>
	);
}

function createExcalidrawOriginKey(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return `atelier.excalidraw-editor:${crypto.randomUUID()}`;
	}
	return `atelier.excalidraw-editor:${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("ExcalidrawView requires a non-empty fileId.");
	}
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_excalidraw/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Draw and edit Excalidraw scenes.",
	icon: PenTool,
	load: loadTextFile,
	component: ({ atelier, view, data }) => {
		const file = preparedFile(data);
		return (
			<PreparedFileSurface
				key={file?.id ?? view.instanceId}
				readySelector="canvas, .atelier-diff-sides"
				diff={viewShowsDiff({
					session: atelier.diff.session,
					state: view.state,
				})}
				initial={
					file ? (
						<SceneContent content={file.content} />
					) : (
						<p>File not found in the workspace.</p>
					)
				}
			>
				<ExcalidrawView
					atelier={atelier}
					fileId={view.state.fileId as string}
					filePath={view.state.filePath as string | undefined}
					isActiveView={view.isActive}
					isPanelFocused={view.isFocused}
					beforeCommitId={
						view.state.beforeCommitId as string | null | undefined
					}
					afterCommitId={view.state.afterCommitId as string | null | undefined}
					preferences={view.preferences}
				/>
			</PreparedFileSurface>
		);
	},
});
