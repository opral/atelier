import { Suspense, useEffect } from "react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { Check, FileText, Loader2 } from "lucide-react";
import {
	LixProvider,
	useLix,
	useQuery,
	useQueryTakeFirst,
} from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	type HistoricalFileSnapshot,
	useFileSnapshotsAtCommits,
} from "@/hooks/use-file-snapshots-at-commits";
import { isMarkdownFilePath } from "@/extension-runtime/file-handlers";
import { EditorProvider } from "@/extensions/markdown/editor/editor-context";
import {
	hydrateMarkdownEditorAuthoritativeMarkdown,
	TipTapEditor,
} from "@/extensions/markdown/editor/tip-tap-editor";
import { EditorContent } from "@tiptap/react";
import { createEditor } from "@/extensions/markdown/editor/create-editor";
import type { EmptyMarkdownDefaultBlock } from "@/extensions/markdown/editor/tiptap-markdown-bridge";
import { MarkdownReviewEditor } from "./review/review-editor";
import { MarkdownReviewExtensions } from "./review/review-extension";
import "./style.css";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import manifestJson from "./manifest.json";
import { FormattingToolbar } from "./components/formatting-toolbar";
import { SlashCommandMenu } from "./components/slash-command-menu";
import type { MarkdownBlockSnapshot, MarkdownReviewDiff } from "./review-diff";
import {
	historicalMarkdownNodeBlocks,
	type HistoricalMarkdownNodeRow,
} from "./review/markdown-node-history";
import {
	decodeFileDataToBytes,
	decodeFileDataToText,
} from "@/lib/decode-file-data";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
	ResolveExternalWriteReviewArgs,
} from "@/extension-runtime/external-write-review";
import { ExternalWriteReviewRegistration } from "@/extension-runtime/external-write-review-registration";
import type {
	CheckpointDiff,
	CheckpointDiffFile,
} from "@/extension-runtime/checkpoint-diff";
import {
	editorRevisionMode,
	editorRevisionReviewId,
	normalizeEditorRevisionState,
	type EditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import {
	useExternalWriteReview,
	useExternalWriteReviewData,
} from "@/shell/external-write-review-history";
import { AnimatedZap } from "@/components/animated-zap";
import type { MarkdownWorkspaceFileOpener } from "@/extensions/markdown/editor/markdown-asset";

type MarkdownViewProps = {
	readonly fileId: string;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly focusOnLoad?: boolean;
	readonly defaultBlock?: EmptyMarkdownDefaultBlock;
	readonly syncActiveFile?: boolean;
	readonly checkpointDiff?: CheckpointDiff | null;
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
	readonly beforeFileId?: string | null;
	readonly afterFileId?: string | null;
	readonly registerExternalWriteReview?: (
		review: ExternalWriteReview,
	) => () => void;
	readonly onAcceptReviewDiff?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
	readonly onRejectReviewDiff?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
	readonly onResolveReviewDiff?: (
		args: ResolveExternalWriteReviewArgs,
	) => Promise<void>;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	readonly onDocumentModified?: (filePath: string) => void;
};

type MarkdownFileRow = {
	readonly id: string;
	readonly path: string;
	readonly data: unknown;
};

type HistoricalMarkdownFile = {
	readonly fileRow: MarkdownFileRow;
	readonly review: ExternalWriteReview | null;
	readonly reviewData: ExternalWriteReviewData | null;
};

const EMPTY_FILE_DATA = new Uint8Array();

/**
 * Embeds the shared TipTap editor to render Markdown documents.
 *
 * @example
 * <MarkdownView fileId="file-123" filePath="/docs/guide.md" isActiveView />
 */
export function MarkdownView({
	fileId,
	filePath,
	isActiveView = true,
	isPanelFocused = true,
	focusOnLoad = false,
	defaultBlock,
	syncActiveFile = true,
	checkpointDiff,
	beforeCommitId,
	afterCommitId,
	beforeFileId,
	afterFileId,
	registerExternalWriteReview,
	onAcceptReviewDiff,
	onRejectReviewDiff,
	onResolveReviewDiff,
	openWorkspaceFile,
	onDocumentModified,
}: MarkdownViewProps) {
	return (
		<Suspense fallback={<MarkdownLoadingSpinner />}>
			<MarkdownViewContent
				fileId={fileId}
				filePath={filePath}
				isActiveView={isActiveView}
				isPanelFocused={isPanelFocused}
				focusOnLoad={focusOnLoad}
				defaultBlock={defaultBlock}
				syncActiveFile={syncActiveFile}
				checkpointDiff={checkpointDiff}
				beforeCommitId={beforeCommitId}
				afterCommitId={afterCommitId}
				beforeFileId={beforeFileId}
				afterFileId={afterFileId}
				registerExternalWriteReview={registerExternalWriteReview}
				onAcceptReviewDiff={onAcceptReviewDiff}
				onRejectReviewDiff={onRejectReviewDiff}
				onResolveReviewDiff={onResolveReviewDiff}
				openWorkspaceFile={openWorkspaceFile}
				onDocumentModified={onDocumentModified}
			/>
		</Suspense>
	);
}

function MarkdownViewContent({ fileId, ...props }: MarkdownViewProps) {
	assertFileId(fileId);

	const fileRow = useQueryTakeFirst<MarkdownFileRow>(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path", "data"])
				.where("id", "=", fileId)
				.limit(1),
		{ subscribe: false },
	);

	return <MarkdownViewLoaded fileId={fileId} fileRow={fileRow} {...props} />;
}

function MarkdownViewLoaded(
	props: MarkdownViewProps & {
		readonly fileRow: MarkdownFileRow | undefined;
	},
) {
	const {
		fileId,
		filePath,
		fileRow,
		isActiveView = true,
		isPanelFocused = true,
		syncActiveFile = true,
		checkpointDiff,
		beforeCommitId,
		afterCommitId,
		openWorkspaceFile,
	} = props;
	const editorRevision = normalizeEditorRevisionState({
		beforeCommitId,
		afterCommitId,
		beforeFileId: props.beforeFileId,
		afterFileId: props.afterFileId,
	});
	const revisionMode = editorRevisionMode(editorRevision);

	if (revisionMode !== "editor") {
		return (
			<MarkdownHistoricalViewLoaded
				fileId={fileId}
				filePath={filePath}
				fileRow={fileRow}
				isActiveView={isActiveView}
				isPanelFocused={isPanelFocused}
				syncActiveFile={syncActiveFile}
				checkpointDiff={checkpointDiff}
				editorRevision={editorRevision}
				openWorkspaceFile={openWorkspaceFile}
			/>
		);
	}

	return <MarkdownLiveViewLoaded {...props} />;
}

function MarkdownLiveViewLoaded({
	fileRow,
	isActiveView = true,
	isPanelFocused = true,
	focusOnLoad = false,
	defaultBlock,
	syncActiveFile = true,
	registerExternalWriteReview,
	onAcceptReviewDiff,
	onRejectReviewDiff,
	onResolveReviewDiff,
	openWorkspaceFile,
	onDocumentModified,
}: MarkdownViewProps & {
	readonly fileRow: MarkdownFileRow | undefined;
}) {
	const externalWriteReview = useExternalWriteReview({
		fileId: fileRow?.id,
		path: fileRow?.path,
	});
	const externalWriteReviewData =
		useExternalWriteReviewData(externalWriteReview);
	const effectiveFileRow = fileRow;
	const review = externalWriteReview;
	const isReviewing = review !== null;
	const reviewData: ExternalWriteReviewData | null = externalWriteReviewData;
	const reviewDiff: MarkdownReviewDiff | null = reviewData
		? {
				beforeMarkdown: decodeFileDataToText(reviewData.beforeData),
				afterMarkdown: decodeFileDataToText(reviewData.afterData),
			}
		: null;
	const reviewBlocks = useMarkdownBlocksAtCommitsWithoutSuspense(
		effectiveFileRow?.id ?? "",
		review?.beforeCommitId,
		review?.afterCommitId,
		reviewDiff?.beforeMarkdown,
		reviewDiff?.afterMarkdown,
	);
	const [liveEditorState, setLiveEditorState] = useState<{
		readonly fileId: string;
		readonly editor: Editor;
	} | null>(null);
	const liveEditor =
		liveEditorState && liveEditorState.fileId === effectiveFileRow?.id
			? liveEditorState.editor
			: null;
	const [finishingReview, setFinishingReview] = useState<{
		readonly fileId: string;
		readonly reviewId: string;
		readonly review: ExternalWriteReview;
	} | null>(null);
	const reviewLocked =
		isReviewing || finishingReview?.fileId === effectiveFileRow?.id;

	let content: ReactNode;

	if (!effectiveFileRow) {
		content = (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	} else if (!isMarkdownFilePath(effectiveFileRow.path)) {
		content = <UnsupportedFilePlaceholder filePath={effectiveFileRow.path} />;
	} else {
		content = (
			<EditorProvider>
				<div
					className={`markdown-view flex h-full flex-col bg-background ${
						reviewLocked ? "markdown-review" : ""
					}`}
				>
					<div className={reviewLocked ? "pointer-events-none" : undefined}>
						<FormattingToolbar disabled={reviewLocked} />
					</div>
					<div className="relative min-h-0 flex-1" data-attr="markdown-editor">
						<TipTapEditor
							className="h-full"
							fileId={effectiveFileRow.id}
							filePath={effectiveFileRow.path}
							isActiveView={isActiveView}
							focusOnLoad={focusOnLoad}
							defaultBlock={defaultBlock}
							readOnly={reviewLocked}
							suspendExternalSync={reviewLocked}
							additionalExtensions={MarkdownReviewExtensions}
							onReady={(editor) => {
								setLiveEditorState({ fileId: effectiveFileRow.id, editor });
							}}
							openWorkspaceFile={openWorkspaceFile}
							onPersist={({ filePath: persistedPath }) => {
								const resolvedPath = persistedPath ?? effectiveFileRow.path;
								onDocumentModified?.(resolvedPath);
							}}
						/>
						{review && reviewDiff && liveEditor ? (
							<MarkdownLiveReviewController
								fileId={effectiveFileRow.id}
								sourceFilePath={effectiveFileRow.path}
								editor={liveEditor}
								review={review}
								reviewDiff={reviewDiff}
								reviewId={review.reviewId}
								beforeCommitId={review.beforeCommitId}
								afterCommitId={review.afterCommitId}
								beforeBlocks={reviewBlocks?.beforeBlocks}
								afterBlocks={reviewBlocks?.afterBlocks}
								openWorkspaceFile={openWorkspaceFile}
								isActive={isActiveView && isPanelFocused}
								onAccept={onAcceptReviewDiff}
								onReject={onRejectReviewDiff}
								onResolve={onResolveReviewDiff}
								onCompletionStart={() => {
									setFinishingReview({
										fileId: effectiveFileRow.id,
										reviewId: review.reviewId,
										review,
									});
								}}
								onCompletionSuccess={(markdown) => {
									hydrateMarkdownEditorAuthoritativeMarkdown(
										liveEditor,
										markdown,
										defaultBlock,
									);
									setFinishingReview((current) =>
										current?.reviewId === review.reviewId ? null : current,
									);
								}}
								onCompletionFailure={() => {
									setFinishingReview((current) =>
										current?.reviewId === review.reviewId ? null : current,
									);
								}}
							/>
						) : null}
						{isActiveView && isPanelFocused && !reviewLocked ? (
							<MarkdownAutosaveHint />
						) : null}
					</div>
					{reviewLocked ? null : <SlashCommandMenu />}
				</div>
			</EditorProvider>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<ExternalWriteReviewRegistration
				review={externalWriteReview ?? finishingReview?.review ?? null}
				register={registerExternalWriteReview}
			/>
			{syncActiveFile && fileRow && isMarkdownFilePath(fileRow.path) ? (
				<ActiveFileSync fileId={fileRow?.id} isActiveView={isActiveView} />
			) : null}
			{content}
		</div>
	);
}

function MarkdownLiveReviewController({
	fileId,
	sourceFilePath,
	editor,
	review,
	reviewDiff,
	reviewId,
	beforeCommitId,
	afterCommitId,
	beforeBlocks,
	afterBlocks,
	isActive,
	openWorkspaceFile,
	onAccept,
	onReject,
	onResolve,
	onCompletionStart,
	onCompletionSuccess,
	onCompletionFailure,
}: MarkdownReviewOverlayProps & {
	readonly editor: Editor;
	readonly onCompletionStart: (markdown: string) => void;
	readonly onCompletionSuccess: (markdown: string) => void;
	readonly onCompletionFailure: () => void;
}) {
	const enrichedReviewDiff = enrichMarkdownReviewDiff(
		reviewDiff,
		beforeBlocks,
		afterBlocks,
	);
	const completeReview = createCompleteMarkdownReview({
		fileId,
		review,
		reviewDiff,
		reviewId,
		onAccept,
		onReject,
		onResolve,
	});

	return (
		<MarkdownReviewEditor
			key={`${reviewId}:${beforeCommitId}:${afterCommitId}`}
			externalEditor={editor}
			reviewDiff={enrichedReviewDiff}
			sourceFilePath={sourceFilePath}
			afterCommitId={afterCommitId}
			openWorkspaceFile={openWorkspaceFile}
			reviewEnabled
			isActive={isActive}
			onComplete={completeReview}
			onCompletionStart={onCompletionStart}
			onCompletionSuccess={onCompletionSuccess}
			onCompletionFailure={onCompletionFailure}
		/>
	);
}

function MarkdownHistoricalViewLoaded({
	fileId,
	filePath,
	fileRow,
	isActiveView,
	isPanelFocused,
	checkpointDiff,
	editorRevision,
	openWorkspaceFile,
}: {
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly fileRow: MarkdownFileRow | undefined;
	readonly isActiveView: boolean;
	readonly isPanelFocused: boolean;
	readonly syncActiveFile: boolean;
	readonly checkpointDiff: CheckpointDiff | null | undefined;
	readonly editorRevision: EditorRevisionState;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
}) {
	const revisionMode = editorRevisionMode(editorRevision);
	const checkpointDiffFile = useMemo(
		() => checkpointDiffFileForRevision(checkpointDiff, fileId, editorRevision),
		[checkpointDiff, editorRevision, fileId],
	);
	const { beforeSnapshot, afterSnapshot } = useFileSnapshotsAtCommits(
		fileId,
		checkpointDiffFile ? null : editorRevision.beforeCommitId,
		checkpointDiffFile ? null : editorRevision.afterCommitId,
		editorRevision.beforeFileId,
		editorRevision.afterFileId,
	);
	const historicalFile = useMemo(
		() =>
			buildHistoricalMarkdownFile({
				fileId,
				filePath,
				fileRow,
				revision: editorRevision,
				checkpointDiffFile,
				beforeSnapshot,
				afterSnapshot,
			}),
		[
			beforeSnapshot,
			checkpointDiffFile,
			editorRevision,
			fileId,
			filePath,
			fileRow,
			afterSnapshot,
		],
	);
	const effectiveFileRow = historicalFile?.fileRow;
	const review = historicalFile?.review ?? null;
	const reviewData = historicalFile?.reviewData ?? null;
	const reviewDiff: MarkdownReviewDiff | null = reviewData
		? {
				beforeMarkdown: decodeFileDataToText(reviewData.beforeData),
				afterMarkdown: decodeFileDataToText(reviewData.afterData),
			}
		: null;

	let content: ReactNode;
	if (!effectiveFileRow) {
		content = (
			<div className="flex h-full items-center justify-center text-sm text-[var(--color-text-tertiary)]">
				File not found in the workspace.
			</div>
		);
	} else if (!isMarkdownFilePath(effectiveFileRow.path)) {
		content = <UnsupportedFilePlaceholder filePath={effectiveFileRow.path} />;
	} else if (revisionMode === "snapshot") {
		content = (
			<MarkdownSnapshotView
				filePath={effectiveFileRow.path}
				markdown={decodeFileDataToText(effectiveFileRow.data)}
				sourceCommitId={
					checkpointDiffFile?.afterCommitId ??
					editorRevision.afterCommitId ??
					undefined
				}
				openWorkspaceFile={openWorkspaceFile}
			/>
		);
	} else {
		content = (
			<div className="markdown-view markdown-review flex h-full flex-col bg-background">
				<div className="relative min-h-0 flex-1" data-attr="markdown-editor">
					{reviewDiff && review ? (
						<Suspense fallback={<MarkdownReviewOverlayFallback />}>
							<MarkdownReviewOverlayWithBlockHistory
								fileId={effectiveFileRow.id}
								sourceFilePath={effectiveFileRow.path}
								review={review}
								reviewDiff={reviewDiff}
								reviewId={review.reviewId}
								beforeCommitId={review.beforeCommitId}
								afterCommitId={review.afterCommitId}
								openWorkspaceFile={openWorkspaceFile}
								isActive={isActiveView && isPanelFocused}
								controls="none"
							/>
						</Suspense>
					) : (
						<MarkdownReviewOverlayFallback />
					)}
				</div>
			</div>
		);
	}

	return <div className="flex min-h-0 flex-1 flex-col">{content}</div>;
}

function MarkdownAutosaveHint() {
	const [hintKey, setHintKey] = useState(0);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const usesPrimaryModifier = event.metaKey || event.ctrlKey;
			if (!usesPrimaryModifier || event.altKey || event.shiftKey) return;
			if (event.key.toLowerCase() !== "s") return;
			event.preventDefault();
			event.stopPropagation();
			setHintKey((current) => current + 1);
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, []);

	useEffect(() => {
		if (hintKey === 0) return;
		const timeoutId = window.setTimeout(() => setHintKey(0), 2400);
		return () => window.clearTimeout(timeoutId);
	}, [hintKey]);

	if (hintKey === 0) return null;

	return (
		<div
			key={hintKey}
			className="markdown-autosave-hint"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			<span className="markdown-autosave-hint-icon" aria-hidden="true">
				<Check aria-hidden />
			</span>
			<span>
				<strong>Auto-saved.</strong> No Cmd+S needed.
			</span>
		</div>
	);
}

function MarkdownSnapshotView({
	filePath,
	markdown,
	sourceCommitId,
	openWorkspaceFile,
}: {
	readonly filePath: string;
	readonly markdown: string;
	readonly sourceCommitId?: string;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
}) {
	const lix = useLix();
	const editor = useMemo(
		() =>
			createEditor({
				lix,
				initialMarkdown: markdown,
				sourceFilePath: filePath,
				sourceCommitId,
				openWorkspaceFile,
				editable: false,
				persistState: false,
			}),
		[filePath, lix, markdown, openWorkspaceFile, sourceCommitId],
	);
	useEffect(() => () => editor.destroy(), [editor]);

	return (
		<div className="markdown-view flex h-full flex-col bg-background">
			<div className="relative min-h-0 flex-1" data-attr="markdown-editor">
				<div className="ph-mask tiptap-container h-full w-full overflow-y-auto bg-background">
					<EditorContent editor={editor} className="tiptap mx-auto w-full" />
				</div>
			</div>
		</div>
	);
}

type MarkdownReviewOverlayProps = {
	readonly fileId: string;
	readonly sourceFilePath: string;
	readonly review: ExternalWriteReview;
	readonly reviewDiff: MarkdownReviewDiff;
	readonly reviewId: string;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly beforeBlocks?: MarkdownBlockSnapshot[];
	readonly afterBlocks?: MarkdownBlockSnapshot[];
	readonly isActive: boolean;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	readonly controls?: "review" | "none";
	readonly onAccept?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
	readonly onReject?: (args: {
		readonly fileId: string;
		readonly reviewId: string;
		readonly review?: ExternalWriteReview;
	}) => Promise<void>;
	readonly onResolve?: (args: ResolveExternalWriteReviewArgs) => Promise<void>;
};

function MarkdownReviewOverlay({
	fileId,
	sourceFilePath,
	review,
	reviewDiff,
	reviewId,
	beforeCommitId,
	afterCommitId,
	beforeBlocks,
	afterBlocks,
	isActive,
	openWorkspaceFile,
	controls = "review",
	onAccept,
	onReject,
	onResolve,
}: MarkdownReviewOverlayProps) {
	const enrichedReviewDiff = enrichMarkdownReviewDiff(
		reviewDiff,
		beforeBlocks,
		afterBlocks,
	);
	const completeReview = createCompleteMarkdownReview({
		fileId,
		review,
		reviewDiff,
		reviewId,
		onAccept,
		onReject,
		onResolve,
	});

	return (
		<div className="markdown-review-overlay">
			<div className="markdown-review-surface">
				<MarkdownReviewEditor
					key={`${reviewId}:${beforeCommitId}:${afterCommitId}`}
					reviewDiff={enrichedReviewDiff}
					sourceFilePath={sourceFilePath}
					afterCommitId={afterCommitId}
					openWorkspaceFile={openWorkspaceFile}
					reviewEnabled={controls === "review"}
					isActive={isActive}
					onComplete={completeReview}
				/>
			</div>
		</div>
	);
}

function createCompleteMarkdownReview({
	fileId,
	review,
	reviewDiff,
	reviewId,
	onAccept,
	onReject,
	onResolve,
}: Pick<
	MarkdownReviewOverlayProps,
	| "fileId"
	| "review"
	| "reviewDiff"
	| "reviewId"
	| "onAccept"
	| "onReject"
	| "onResolve"
>): (markdown: string) => Promise<void> {
	return async (markdown: string) => {
		if (onResolve) {
			await onResolve({
				fileId,
				reviewId,
				review,
				data: new TextEncoder().encode(markdown),
			});
			return;
		}
		if (markdown === reviewDiff.afterMarkdown) {
			await onAccept?.({ fileId, reviewId, review });
			return;
		}
		if (markdown === reviewDiff.beforeMarkdown) {
			await onReject?.({ fileId, reviewId, review });
			return;
		}
		throw new Error("Mixed review decisions require a review resolver.");
	};
}

function MarkdownReviewOverlayWithBlockHistory(
	props: Omit<MarkdownReviewOverlayProps, "beforeBlocks" | "afterBlocks">,
) {
	const { beforeBlocks, afterBlocks } = useMarkdownBlocksAtCommits(
		props.fileId,
		props.beforeCommitId,
		props.afterCommitId,
		props.reviewDiff.beforeMarkdown,
		props.reviewDiff.afterMarkdown,
	);
	return (
		<MarkdownReviewOverlay
			{...props}
			beforeBlocks={beforeBlocks}
			afterBlocks={afterBlocks}
		/>
	);
}

function enrichMarkdownReviewDiff(
	reviewDiff: MarkdownReviewDiff,
	beforeBlocks: MarkdownBlockSnapshot[] | undefined,
	afterBlocks: MarkdownBlockSnapshot[] | undefined,
): MarkdownReviewDiff {
	const beforeSnapshotsAvailable =
		beforeBlocks !== undefined &&
		(beforeBlocks.length > 0 || reviewDiff.beforeMarkdown.trim().length === 0);
	const afterSnapshotsAvailable =
		afterBlocks !== undefined &&
		(afterBlocks.length > 0 || reviewDiff.afterMarkdown.trim().length === 0);
	if (!beforeSnapshotsAvailable || !afterSnapshotsAvailable) {
		return reviewDiff;
	}
	return {
		...reviewDiff,
		beforeBlocks: beforeBlocks ?? [],
		afterBlocks: afterBlocks ?? [],
	};
}

function MarkdownReviewOverlayFallback() {
	return (
		<div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
			<div className="inline-flex items-center rounded-md border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)] shadow-sm">
				<Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
				<span>Loading review…</span>
			</div>
		</div>
	);
}

function useMarkdownBlocksAtCommits(
	fileId: string,
	beforeCommitId: string | undefined,
	afterCommitId: string | undefined,
	beforeMarkdown: string,
	afterMarkdown: string,
): {
	readonly beforeBlocks: MarkdownBlockSnapshot[] | undefined;
	readonly afterBlocks: MarkdownBlockSnapshot[] | undefined;
} {
	const rows = useQuery<HistoricalMarkdownNodeRow>(
		(lix) =>
			beforeCommitId && afterCommitId
				? historicalMarkdownBlocksQuery(lix, {
						beforeCommitId,
						afterCommitId,
						fileId,
					})
				: emptyMarkdownBlocksQuery(),
		{ subscribe: false },
	);
	if (!beforeCommitId || !afterCommitId) {
		return { beforeBlocks: undefined, afterBlocks: undefined };
	}
	return {
		beforeBlocks: historicalMarkdownNodeBlocks(
			rows,
			beforeCommitId,
			beforeMarkdown,
		),
		afterBlocks: historicalMarkdownNodeBlocks(
			rows,
			afterCommitId,
			afterMarkdown,
		),
	};
}

type ResolvedMarkdownBlocks = {
	readonly key: string;
	readonly beforeBlocks: MarkdownBlockSnapshot[] | undefined;
	readonly afterBlocks: MarkdownBlockSnapshot[] | undefined;
};

/**
 * Loads optional entity identity hints without suspending the visible editor.
 * Raw before/after snapshots remain authoritative if this query fails.
 */
function useMarkdownBlocksAtCommitsWithoutSuspense(
	fileId: string,
	beforeCommitId: string | undefined,
	afterCommitId: string | undefined,
	beforeMarkdown: string | undefined,
	afterMarkdown: string | undefined,
): ResolvedMarkdownBlocks | null {
	const lix = useLix();
	const key =
		fileId && beforeCommitId && afterCommitId
			? JSON.stringify([fileId, beforeCommitId, afterCommitId])
			: null;
	const [resolved, setResolved] = useState<ResolvedMarkdownBlocks | null>(null);

	useEffect(() => {
		if (
			!key ||
			!beforeCommitId ||
			!afterCommitId ||
			beforeMarkdown === undefined ||
			afterMarkdown === undefined
		)
			return;
		let cancelled = false;
		void historicalMarkdownBlocksQuery(lix, {
			fileId,
			beforeCommitId,
			afterCommitId,
		})
			.execute()
			.then((rows) => {
				if (cancelled) return;
				setResolved({
					key,
					beforeBlocks: historicalMarkdownNodeBlocks(
						rows,
						beforeCommitId,
						beforeMarkdown,
					),
					afterBlocks: historicalMarkdownNodeBlocks(
						rows,
						afterCommitId,
						afterMarkdown,
					),
				});
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				console.warn(
					"[markdown-review] entity identity hints could not be loaded; using raw snapshots",
					error,
				);
				setResolved({
					key,
					beforeBlocks: undefined,
					afterBlocks: undefined,
				});
			});
		return () => {
			cancelled = true;
		};
	}, [
		afterCommitId,
		afterMarkdown,
		beforeCommitId,
		beforeMarkdown,
		fileId,
		key,
		lix,
	]);

	if (!key || resolved?.key !== key) return null;
	return resolved;
}

function historicalMarkdownBlocksQuery(
	lix: ReturnType<typeof useLix>,
	args: {
		readonly beforeCommitId: string;
		readonly afterCommitId: string;
		readonly fileId: string;
	},
) {
	const sql = `
		WITH ranked AS (
			SELECT
				start_commit_id,
				entity_pk,
				snapshot_content,
				depth,
				ROW_NUMBER() OVER (
					PARTITION BY start_commit_id, entity_pk
					ORDER BY depth ASC
				) AS rn
			FROM lix_state_history
			WHERE start_commit_id IN (?, ?)
				AND file_id = ?
				AND schema_key = 'markdown_node'
		)
		SELECT start_commit_id, snapshot_content
		FROM ranked
		WHERE rn = 1
			AND snapshot_content IS NOT NULL
	`;
	const parameters = [args.beforeCommitId, args.afterCommitId, args.fileId];
	return {
		compile: () => ({ sql, parameters }),
		execute: async () => {
			const result = await lix.execute(sql, parameters);
			return result.rows.map(
				(row) => row.toObject() as HistoricalMarkdownNodeRow,
			);
		},
	};
}

function emptyMarkdownBlocksQuery() {
	return {
		compile: () => ({ sql: "SELECT 1 WHERE 0", parameters: [] }),
		execute: async () => [] as HistoricalMarkdownNodeRow[],
	};
}

function checkpointDiffFileForRevision(
	checkpointDiff: CheckpointDiff | null | undefined,
	fileId: string,
	revision: EditorRevisionState,
): CheckpointDiffFile | null {
	if (!checkpointDiff) return null;
	return (
		checkpointDiff.files.find((file) => {
			const afterCommitId = checkpointDiff.afterIsActiveHead
				? null
				: file.afterCommitId;
			return (
				file.fileId === fileId &&
				file.beforeCommitId === revision.beforeCommitId &&
				afterCommitId === revision.afterCommitId
			);
		}) ?? null
	);
}

function buildHistoricalMarkdownFile(args: {
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly fileRow: MarkdownFileRow | undefined;
	readonly revision: EditorRevisionState;
	readonly checkpointDiffFile: CheckpointDiffFile | null;
	readonly beforeSnapshot: HistoricalFileSnapshot | undefined;
	readonly afterSnapshot: HistoricalFileSnapshot | undefined;
}): HistoricalMarkdownFile | null {
	const mode = editorRevisionMode(args.revision);
	if (mode === "editor") return null;

	const path =
		args.checkpointDiffFile?.path ??
		args.afterSnapshot?.path ??
		args.beforeSnapshot?.path ??
		args.fileRow?.path ??
		args.filePath;
	if (!path) return null;

	if (mode === "snapshot") {
		const data = args.checkpointDiffFile
			? args.checkpointDiffFile.afterData
			: args.afterSnapshot
				? decodeFileDataToBytes(args.afterSnapshot.data)
				: null;
		if (!data) return null;
		return {
			fileRow: {
				id: args.fileId,
				path,
				data,
			},
			review: null,
			reviewData: null,
		};
	}

	const beforeData =
		args.checkpointDiffFile?.beforeData ??
		(args.beforeSnapshot
			? decodeFileDataToBytes(args.beforeSnapshot.data)
			: EMPTY_FILE_DATA);
	const afterData =
		args.checkpointDiffFile?.afterData ??
		(args.revision.afterCommitId
			? args.afterSnapshot
				? decodeFileDataToBytes(args.afterSnapshot.data)
				: EMPTY_FILE_DATA
			: args.fileRow
				? decodeFileDataToBytes(args.fileRow.data)
				: EMPTY_FILE_DATA);

	return {
		fileRow: {
			id: args.fileId,
			path,
			data: afterData,
		},
		review: {
			fileId: args.fileId,
			path,
			reviewId:
				args.checkpointDiffFile?.reviewId ??
				editorRevisionReviewId({
					fileId: args.fileId,
					path,
					beforeCommitId: args.revision.beforeCommitId,
					afterCommitId: args.revision.afterCommitId,
				}),
			beforeCommitId: args.revision.beforeCommitId ?? "",
			afterCommitId: args.revision.afterCommitId ?? "",
			agentTurnRangeIds: [],
		},
		reviewData: {
			beforeData,
			afterData,
		},
	};
}

function UnsupportedFilePlaceholder({
	filePath,
}: {
	readonly filePath: string;
}): ReactNode {
	return (
		<div className="flex h-full items-center justify-center px-6 py-8 text-center">
			<div className="max-w-sm space-y-2 text-sm text-[var(--color-text-secondary)]">
				<p className="font-medium text-[var(--color-text-primary)]">
					This file type is not supported yet.
				</p>
				<p>
					Atelier only opens markdown files in this editor, so{" "}
					<span className="font-mono text-xs text-[var(--color-text-secondary)]">
						{filePath}
					</span>{" "}
					was left blank to avoid damaging its formatting.
				</p>
			</div>
		</div>
	);
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("MarkdownView requires a non-empty fileId.");
	}
}

function ActiveFileSync({
	fileId,
	isActiveView,
}: {
	readonly fileId?: string;
	readonly isActiveView: boolean;
}) {
	const activeFile = useQueryTakeFirst<{ value: string }>((lix) =>
		qb(lix)
			.selectFrom("lix_key_value_by_branch")
			.where("lixcol_branch_id", "=", "global")
			.where("key", "=", "atelier_active_file_id")
			.select(["value"]),
	);

	return (
		<ActiveFileSyncEffect
			fileId={fileId}
			isActiveView={isActiveView}
			activeFileId={
				typeof activeFile?.value === "string" ? activeFile.value : null
			}
		/>
	);
}

function ActiveFileSyncEffect({
	fileId,
	isActiveView,
	activeFileId,
}: {
	readonly fileId?: string;
	readonly isActiveView: boolean;
	readonly activeFileId: string | null;
}) {
	const lix = useLix();

	useEffect(() => {
		if (!fileId) return;
		if (!isActiveView) return;
		if (activeFileId === fileId) return;
		void qb(lix)
			.insertInto("lix_key_value_by_branch")
			.values({
				key: "atelier_active_file_id",
				value: fileId,
				lixcol_branch_id: "global",
				lixcol_global: true,
				lixcol_untracked: true,
			})
			.onConflict((oc) =>
				oc.columns(["key", "lixcol_branch_id"]).doUpdateSet({ value: fileId }),
			)
			.execute();
	}, [lix, fileId, activeFileId, isActiveView]);

	return null;
}

function MarkdownLoadingSpinner(): ReactNode {
	return (
		<div className="flex h-full items-center justify-center px-3 py-2 text-muted-foreground">
			<div className="flex items-center gap-2 text-sm">
				<AnimatedZap size={13} tone="muted" className="shrink-0" />
				<span>Loading editor…</span>
			</div>
		</div>
	);
}

/**
 * Markdown content view definition used by the registry.
 *
 * @example
 * import { extension as markdownView } from "@/extensions/markdown";
 */
export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_file/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Display file contents.",
	icon: FileText,
	component: ({ atelier, view }) => (
		<LixProvider lix={atelier.lix}>
			<MarkdownView
				fileId={view.state.fileId as string}
				filePath={view.state.filePath as string | undefined}
				isActiveView={view.isActive}
				isPanelFocused={view.isFocused}
				focusOnLoad={Boolean(view.state.focusOnLoad)}
				defaultBlock={
					view.state.defaultBlock === "heading1" ? "heading1" : undefined
				}
				syncActiveFile={false}
				beforeCommitId={
					typeof view.state.beforeCommitId === "string"
						? view.state.beforeCommitId
						: null
				}
				afterCommitId={
					typeof view.state.afterCommitId === "string"
						? view.state.afterCommitId
						: null
				}
				beforeFileId={
					typeof view.state.beforeFileId === "string"
						? view.state.beforeFileId
						: null
				}
				afterFileId={
					typeof view.state.afterFileId === "string"
						? view.state.afterFileId
						: null
				}
				registerExternalWriteReview={atelier.reviews.register}
				onAcceptReviewDiff={atelier.reviews.accept}
				onRejectReviewDiff={atelier.reviews.reject}
				onResolveReviewDiff={atelier.reviews.resolve}
				openWorkspaceFile={(args) =>
					atelier.documents.open(args.filePath, {
						...(args.state ? { state: args.state } : {}),
						...(args.focus !== undefined ? { focus: args.focus } : {}),
					})
				}
				onDocumentModified={(filePath) =>
					atelier.events.emit({
						type: "document_modified",
						filePath,
						modifiedBy: "user",
					})
				}
			/>
		</LixProvider>
	),
});
