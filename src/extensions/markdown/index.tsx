import { Suspense, useEffect } from "react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { Check, FileText, Loader2 } from "lucide-react";
import {
	useLix,
	useQueryTakeFirst,
	useResolvedActiveBranchId,
} from "@/lib/lix-react";
import {
	type HistoricalFileSnapshot,
	useFileSnapshotsAtCommits,
} from "@/hooks/use-file-snapshots-at-commits";
import { isMarkdownFilePath } from "@/extension-runtime/file-handlers";
import {
	EditorProvider,
	useEditorCtx,
} from "@/extensions/markdown/editor/editor-context";
import {
	hydrateMarkdownEditorAuthoritativeMarkdown,
	selectMarkdownFileDelivery,
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
import { EmojiPickerMenu } from "./components/emoji-picker-menu";
import { EmbedFilePickerMenu } from "./components/embed-file-picker-menu";
import type { MarkdownReviewDiff } from "./review-diff";
import {
	decodeFileDataToBytes,
	decodeFileDataToText,
} from "@/lib/decode-file-data";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
	ExternalWriteReviewNavigation,
	ResolveExternalWriteReviewArgs,
} from "@/extension-runtime/external-write-review";
import { ExternalWriteReviewRegistration } from "@/extension-runtime/external-write-review-registration";
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
	readonly readOnly?: boolean;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly focusOnLoad?: boolean;
	readonly defaultBlock?: EmptyMarkdownDefaultBlock;
	readonly activeBranchId?: string;
	readonly resolvedReviewIds?: readonly string[];
	readonly reviewRangeSessionId?: string;
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
	readonly autoAcceptReviews?: boolean;
	readonly reviewEnabled?: boolean;
	readonly reviewMode?: "agent-turn" | "working-changes";
	readonly reviewNavigation?: ExternalWriteReviewNavigation;
	readonly onExitReview?: () => void;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	readonly onDocumentModified?: (filePath: string) => void;
};

type MarkdownFileRow = {
	readonly id: string;
	readonly path: string;
	readonly content: unknown;
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
	readOnly,
	isActiveView = true,
	isPanelFocused = true,
	focusOnLoad = false,
	defaultBlock,
	activeBranchId,
	resolvedReviewIds,
	reviewRangeSessionId,
	beforeCommitId,
	afterCommitId,
	beforeFileId,
	afterFileId,
	registerExternalWriteReview,
	onAcceptReviewDiff,
	onRejectReviewDiff,
	onResolveReviewDiff,
	autoAcceptReviews,
	reviewEnabled,
	reviewMode,
	reviewNavigation,
	onExitReview,
	openWorkspaceFile,
	onDocumentModified,
}: MarkdownViewProps) {
	assertFileId(fileId);
	const resolvedActiveBranchId = useResolvedActiveBranchId(activeBranchId);
	if (!resolvedActiveBranchId) return <MarkdownLoadingSpinner />;
	return (
		<Suspense fallback={<MarkdownLoadingSpinner />}>
			<MarkdownViewContent
				fileId={fileId}
				filePath={filePath}
				readOnly={readOnly}
				isActiveView={isActiveView}
				isPanelFocused={isPanelFocused}
				focusOnLoad={focusOnLoad}
				defaultBlock={defaultBlock}
				activeBranchId={resolvedActiveBranchId}
				resolvedReviewIds={resolvedReviewIds}
				reviewRangeSessionId={reviewRangeSessionId}
				beforeCommitId={beforeCommitId}
				afterCommitId={afterCommitId}
				beforeFileId={beforeFileId}
				afterFileId={afterFileId}
				registerExternalWriteReview={registerExternalWriteReview}
				onAcceptReviewDiff={onAcceptReviewDiff}
				onRejectReviewDiff={onRejectReviewDiff}
				onResolveReviewDiff={onResolveReviewDiff}
				autoAcceptReviews={autoAcceptReviews}
				reviewEnabled={reviewEnabled}
				reviewMode={reviewMode}
				reviewNavigation={reviewNavigation}
				onExitReview={onExitReview}
				openWorkspaceFile={openWorkspaceFile}
				onDocumentModified={onDocumentModified}
			/>
		</Suspense>
	);
}

function MarkdownViewContent({ fileId, ...props }: MarkdownViewProps) {
	assertFileId(fileId);
	const editorRevision = normalizeEditorRevisionState({
		beforeCommitId: props.beforeCommitId,
		afterCommitId: props.afterCommitId,
		beforeFileId: props.beforeFileId,
		afterFileId: props.afterFileId,
	});
	const comparesAgainstCurrentFile =
		editorRevision.beforeCommitId !== null &&
		editorRevision.afterCommitId === null;

	const ownsLiveFileDelivery = editorRevisionMode(editorRevision) === "editor";
	const fileRow = useQueryTakeFirst<MarkdownFileRow>(
		(lix) =>
			selectMarkdownFileDelivery(lix, props.activeBranchId ?? "", fileId),
		{
			subscribe: ownsLiveFileDelivery || comparesAgainstCurrentFile,
		},
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
				editorRevision={editorRevision}
				openWorkspaceFile={openWorkspaceFile}
			/>
		);
	}

	return <MarkdownLiveViewLoaded {...props} />;
}

function MarkdownLiveViewLoaded({
	fileRow,
	readOnly = false,
	isActiveView = true,
	isPanelFocused = true,
	focusOnLoad = false,
	defaultBlock,
	activeBranchId = "",
	resolvedReviewIds,
	reviewRangeSessionId,
	registerExternalWriteReview,
	onAcceptReviewDiff,
	onRejectReviewDiff,
	onResolveReviewDiff,
	autoAcceptReviews,
	reviewEnabled = true,
	reviewMode,
	reviewNavigation,
	onExitReview,
	openWorkspaceFile,
	onDocumentModified,
}: MarkdownViewProps & {
	readonly fileRow: MarkdownFileRow | undefined;
}) {
	const externalWriteReview = useExternalWriteReview({
		fileId: fileRow?.id,
		path: fileRow?.path,
		activeBranchId,
		resolvedReviewIds,
		reviewRangeSessionId,
		enabled: reviewEnabled,
		reviewMode:
			reviewMode ?? (autoAcceptReviews ? "working-changes" : "agent-turn"),
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
	const editorReadOnly = readOnly || reviewLocked;

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
					<FormattingToolbar disabled={editorReadOnly} />
					<div className="relative min-h-0 flex-1" data-attr="markdown-editor">
						<TipTapEditor
							className="h-full"
							fileId={effectiveFileRow.id}
							activeBranchId={activeBranchId}
							filePath={effectiveFileRow.path}
							isActiveView={isActiveView}
							focusOnLoad={focusOnLoad}
							defaultBlock={defaultBlock}
							readOnly={editorReadOnly}
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
						{!readOnly && review && reviewDiff && liveEditor ? (
							<MarkdownLiveReviewController
								fileId={effectiveFileRow.id}
								sourceFilePath={effectiveFileRow.path}
								editor={liveEditor}
								review={review}
								reviewDiff={reviewDiff}
								reviewId={review.reviewId}
								beforeCommitId={review.beforeCommitId}
								afterCommitId={review.afterCommitId}
								openWorkspaceFile={openWorkspaceFile}
								isActive={isActiveView && isPanelFocused}
								onAccept={onAcceptReviewDiff}
								onReject={onRejectReviewDiff}
								onResolve={onResolveReviewDiff}
								autoAccept={autoAcceptReviews}
								navigation={reviewNavigation}
								onExit={onExitReview}
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
						{isActiveView && isPanelFocused && !editorReadOnly ? (
							<MarkdownAutosaveHint />
						) : null}
					</div>
					{editorReadOnly ? null : (
						<>
							<SlashCommandMenu />
							<EmojiPickerMenu />
							<EmbedFilePickerMenu sourceFilePath={effectiveFileRow.path} />
						</>
					)}
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
	isActive,
	openWorkspaceFile,
	onAccept,
	onReject,
	onResolve,
	onCompletionStart,
	onCompletionSuccess,
	onCompletionFailure,
	autoAccept = false,
}: MarkdownReviewOverlayProps & {
	readonly editor: Editor;
	readonly onCompletionStart: (markdown: string) => void;
	readonly onCompletionSuccess: (markdown: string) => void;
	readonly onCompletionFailure: () => void;
}) {
	// The diff-mode float is shell-owned (one float, workspace scope). A no-op
	// diff renders no overlay at all: the float alone carries the actions.
	if (reviewDiff.beforeMarkdown === reviewDiff.afterMarkdown) {
		return null;
	}
	const completeReview = createCompleteMarkdownReview({
		fileId,
		review,
		reviewDiff,
		reviewId,
		onAccept,
		onReject,
		onResolve,
	});
	if (autoAccept) {
		return (
			<MarkdownReviewEditor
				key={`${reviewId}:${beforeCommitId}:${afterCommitId}:accepted`}
				externalEditor={editor}
				reviewDiff={reviewDiff}
				sourceFilePath={sourceFilePath}
				afterCommitId={afterCommitId}
				openWorkspaceFile={openWorkspaceFile}
				isActive={isActive}
			/>
		);
	}

	return (
		<MarkdownReviewEditor
			key={`${reviewId}:${beforeCommitId}:${afterCommitId}`}
			externalEditor={editor}
			reviewDiff={reviewDiff}
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
	editorRevision,
	openWorkspaceFile,
}: {
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly fileRow: MarkdownFileRow | undefined;
	readonly isActiveView: boolean;
	readonly isPanelFocused: boolean;
	readonly editorRevision: EditorRevisionState;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
}) {
	const revisionMode = editorRevisionMode(editorRevision);
	const { beforeSnapshot, afterSnapshot } = useFileSnapshotsAtCommits(
		fileId,
		editorRevision.beforeCommitId,
		editorRevision.afterCommitId,
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
				beforeSnapshot,
				afterSnapshot,
			}),
		[beforeSnapshot, editorRevision, fileId, filePath, fileRow, afterSnapshot],
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
				markdown={decodeFileDataToText(effectiveFileRow.content)}
				sourceCommitId={editorRevision.afterCommitId ?? undefined}
				openWorkspaceFile={openWorkspaceFile}
			/>
		);
	} else {
		content = (
			<EditorProvider>
				<div className="markdown-view markdown-review flex h-full flex-col bg-background">
					<FormattingToolbar disabled />
					<div className="relative min-h-0 flex-1" data-attr="markdown-editor">
						{reviewDiff && review ? (
							<MarkdownReviewOverlay
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
						) : (
							<MarkdownReviewOverlayFallback />
						)}
					</div>
				</div>
			</EditorProvider>
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
		<EditorProvider>
			<MarkdownSnapshotEditor editor={editor} />
		</EditorProvider>
	);
}

function MarkdownSnapshotEditor({ editor }: { readonly editor: Editor }) {
	const { setEditor } = useEditorCtx();
	useEffect(() => {
		setEditor(editor);
		return () => {
			setEditor((current) => (current === editor ? null : current));
		};
	}, [editor, setEditor]);

	return (
		<div className="markdown-view flex h-full flex-col bg-background">
			<FormattingToolbar disabled />
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
	readonly autoAccept?: boolean;
	readonly navigation?: ExternalWriteReviewNavigation;
	readonly onExit?: () => void;
};

function MarkdownReviewOverlay({
	fileId,
	sourceFilePath,
	review,
	reviewDiff,
	reviewId,
	beforeCommitId,
	afterCommitId,
	isActive,
	openWorkspaceFile,
	controls = "review",
	onAccept,
	onReject,
	onResolve,
}: MarkdownReviewOverlayProps) {
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
					reviewDiff={reviewDiff}
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

function buildHistoricalMarkdownFile(args: {
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly fileRow: MarkdownFileRow | undefined;
	readonly revision: EditorRevisionState;
	readonly beforeSnapshot: HistoricalFileSnapshot | undefined;
	readonly afterSnapshot: HistoricalFileSnapshot | undefined;
}): HistoricalMarkdownFile | null {
	const mode = editorRevisionMode(args.revision);
	if (mode === "editor") return null;

	const path =
		args.afterSnapshot?.path ??
		args.beforeSnapshot?.path ??
		args.fileRow?.path ??
		args.filePath;
	if (!path) return null;

	if (mode === "snapshot") {
		const data = args.afterSnapshot
			? decodeFileDataToBytes(args.afterSnapshot.content)
			: null;
		if (!data) return null;
		return {
			fileRow: {
				id: args.fileId,
				path,
				content: data,
			},
			review: null,
			reviewData: null,
		};
	}

	const beforeData = args.beforeSnapshot
		? decodeFileDataToBytes(args.beforeSnapshot.content)
		: EMPTY_FILE_DATA;
	const afterData = args.revision.afterCommitId
		? args.afterSnapshot
			? decodeFileDataToBytes(args.afterSnapshot.content)
			: EMPTY_FILE_DATA
		: args.fileRow
			? decodeFileDataToBytes(args.fileRow.content)
			: EMPTY_FILE_DATA;

	return {
		fileRow: {
			id: args.fileId,
			path,
			content: afterData,
		},
		review: {
			fileId: args.fileId,
			path,
			reviewId: editorRevisionReviewId({
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
		<MarkdownView
			fileId={view.state.fileId as string}
			filePath={view.state.filePath as string | undefined}
			readOnly={atelier.readOnly}
			isActiveView={view.isActive}
			isPanelFocused={view.isFocused}
			focusOnLoad={Boolean(view.state.focusOnLoad)}
			defaultBlock={
				view.state.defaultBlock === "heading1" ? "heading1" : undefined
			}
			activeBranchId={atelier.branches.activeId}
			resolvedReviewIds={atelier.reviews.resolvedReviewIds}
			reviewRangeSessionId={atelier.reviews.rangeSessionId}
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
			autoAcceptReviews={
				atelier.reviews.mode === "working-changes" || atelier.reviews.autoAccept
			}
			reviewEnabled={atelier.reviews.isOpen}
			reviewMode={atelier.reviews.mode}
			reviewNavigation={atelier.reviews.navigation}
			onExitReview={atelier.reviews.exit}
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
	),
});
