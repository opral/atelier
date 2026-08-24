import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { PenTool, TriangleAlert } from "lucide-react";
import { AnimatedZap } from "@/components/animated-zap";
import type { ExtensionRuntime } from "@/extension-runtime/types";
import {
	editorRevisionMode,
	normalizeEditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import { useSyncedTextFile } from "@/extension-runtime/use-synced-text-file";
import { fileNameFromPath } from "@/extension-runtime/extension-instance-helpers";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	getFileDataAtCommit,
	useExternalWriteReview,
	useExternalWriteReviewData,
} from "@/shell/external-write-review-history";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import { parseExcalidrawScene } from "./scene";
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
};

function ExcalidrawView(props: ExcalidrawViewProps) {
	return (
		<Suspense fallback={<ExcalidrawLoadingState />}>
			<ExcalidrawViewContent {...props} />
		</Suspense>
	);
}

function ExcalidrawViewContent({ fileId, ...props }: ExcalidrawViewProps) {
	assertFileId(fileId);
	// Subscribed (unlike the text view) so a reopened view never mounts from
	// a stale cached row: the canvas seeds itself from this snapshot.
	const fileRow = useQueryTakeFirst<ExcalidrawFileRow>((lix) =>
		qb(lix)
			.selectFrom("lix_file")
			.select(["id", "path", "content"])
			.where("id", "=", fileId)
			.limit(1),
	);

	if (!fileRow) {
		return (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	}

	const revision = normalizeEditorRevisionState(props);
	if (editorRevisionMode(revision) !== "editor") {
		return (
			<HistoricalExcalidrawView
				{...props}
				fileRow={fileRow}
				fileId={fileId}
				commitId={revision.afterCommitId ?? revision.beforeCommitId}
			/>
		);
	}

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
}: Omit<ExcalidrawViewProps, "beforeCommitId" | "afterCommitId"> & {
	readonly fileRow: ExcalidrawFileRow;
}) {
	const resolvedPath = fileRow.path || filePath || `/${fileId}.excalidraw`;
	const fileText = useMemo(
		() => decodeFileDataToText(fileRow.content),
		[fileRow.content],
	);
	const review = useExternalWriteReview({
		fileId,
		path: resolvedPath,
		activeBranchId: atelier.branches.activeId,
		resolvedReviewIds: atelier.reviews.resolvedReviewIds,
		reviewRangeSessionId: atelier.reviews.rangeSessionId,
		enabled: atelier.reviews.isOpen,
		reviewMode:
			atelier.reviews.mode ??
			(atelier.reviews.autoAccept ? "working-changes" : "agent-turn"),
	});
	const reviewData = useExternalWriteReviewData(review);
	const reviewText = reviewData
		? decodeFileDataToText(reviewData.afterData)
		: null;
	const isReviewing = Boolean(review);

	useEffect(() => {
		if (!review) return;
		return atelier.reviews.register(review);
	}, [atelier.reviews, review]);

	const originKey = useMemo(() => createExcalidrawOriginKey(), []);
	const {
		text: documentText,
		saveError,
		persist: persistUserEdit,
	} = useSyncedTextFile({
		fileId,
		initialText: fileText,
		reviewText,
		reviewing: isReviewing,
		readOnly: atelier.readOnly,
		originKey,
	});

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
					readOnly={isReviewing || atelier.readOnly}
					onSceneChange={persistUserEdit}
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

function HistoricalExcalidrawView({
	fileRow,
	fileId,
	filePath,
	commitId,
}: Omit<ExcalidrawViewProps, "atelier"> & {
	readonly fileRow: ExcalidrawFileRow;
	readonly commitId: string | null;
}) {
	const lix = useLix();
	const [snapshotText, setSnapshotText] = useState<string | null>(null);
	const [loadError, setLoadError] = useState(false);
	useEffect(() => {
		let cancelled = false;
		setSnapshotText(null);
		setLoadError(false);
		if (!commitId) {
			setSnapshotText(decodeFileDataToText(fileRow.content));
			return;
		}
		void getFileDataAtCommit(lix, fileId, commitId)
			.then((data) => {
				if (!cancelled) {
					setSnapshotText(data ? decodeFileDataToText(data) : "");
				}
			})
			.catch(() => {
				if (!cancelled) setLoadError(true);
			});
		return () => {
			cancelled = true;
		};
	}, [commitId, fileId, fileRow.content, lix]);

	if (loadError) {
		return (
			<div
				className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]"
				role="alert"
			>
				Could not load this file revision.
			</div>
		);
	}
	if (snapshotText === null) return <ExcalidrawLoadingState />;
	const parsed = parseExcalidrawScene(snapshotText);
	if (!parsed.ok) {
		return (
			<InvalidSceneState
				filePath={fileRow.path || filePath || `/${fileId}.excalidraw`}
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
				className="size-7 text-[var(--color-icon-tertiary)]"
				strokeWidth={1.5}
			/>
			<p className="mt-3 text-sm font-medium text-[var(--color-text-primary)]">
				This file cannot be opened as an Excalidraw scene.
			</p>
			<p className="mt-1 max-w-sm text-xs leading-relaxed text-[var(--color-text-tertiary)]">
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
			className="flex h-full min-h-48 items-center justify-center px-3 py-2 text-[var(--color-text-tertiary)]"
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
	component: ({ atelier, view }) => (
		<ExcalidrawView
			atelier={atelier}
			fileId={view.state.fileId as string}
			filePath={view.state.filePath as string | undefined}
			isActiveView={view.isActive}
			isPanelFocused={view.isFocused}
			beforeCommitId={view.state.beforeCommitId as string | null | undefined}
			afterCommitId={view.state.afterCommitId as string | null | undefined}
		/>
	),
});
