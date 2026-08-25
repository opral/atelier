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
	FileSnapshotsAtCommits,
	type HistoricalFileSnapshot,
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
} from "@/extension-runtime/external-write-review";
import type { AtelierDiffSession } from "@/extension-api";
import {
	editorRevisionMode,
	editorRevisionReviewId,
	normalizeEditorRevisionState,
	type EditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import { useFileDataAtCommit } from "@/shell/external-write-review-history";
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
	readonly diffSession?: AtelierDiffSession | null;
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
	readonly beforeFileId?: string | null;
	readonly afterFileId?: string | null;
	readonly beforeExists?: boolean;
	readonly afterExists?: boolean;
	readonly onDiffAccept?: (path: string) => Promise<void>;
	readonly onDiffReject?: (path: string) => Promise<void>;
	readonly onDiffResolve?: (path: string, data: Uint8Array) => Promise<void>;
	readonly autoAcceptReviews?: boolean;
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
	diffSession,
	beforeCommitId,
	afterCommitId,
	beforeFileId,
	afterFileId,
	beforeExists,
	afterExists,
	onDiffAccept,
	onDiffReject,
	onDiffResolve,
	autoAcceptReviews,

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
				diffSession={diffSession}
				beforeCommitId={beforeCommitId}
				afterCommitId={afterCommitId}
				beforeFileId={beforeFileId}
				afterFileId={afterFileId}
				beforeExists={beforeExists}
				afterExists={afterExists}
				onDiffAccept={onDiffAccept}
				onDiffReject={onDiffReject}
				onDiffResolve={onDiffResolve}
				autoAcceptReviews={autoAcceptReviews}

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
		beforeExists: props.beforeExists,
		afterExists: props.afterExists,
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
		beforeExists: props.beforeExists,
		afterExists: props.afterExists,
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
	diffSession,
	onDiffAccept,
	onDiffReject,
	onDiffResolve,
	autoAcceptReviews,
	openWorkspaceFile,
	onDocumentModified,
}: MarkdownViewProps & {
	readonly fileRow: MarkdownFileRow | undefined;
}) {
	// The shell owns review detection: this document is under review when the
	// working diff session marks it pending and it is the revealed file.
	const session = diffSession ?? null;
	const sessionReview =
		fileRow && session && "working" in session.target
			? session.files.find((file) => file.id === fileRow.id)?.review
			: undefined;
	const reviewing = Boolean(
		fileRow &&
			session &&
			sessionReview?.status === "pending" &&
			session.activePath === fileRow.path,
	);
	const reviewBaseCommitId =
		reviewing && session?.base && "commitId" in session.base
			? session.base.commitId
			: null;
	const reviewBase = useFileDataAtCommit(
		reviewing ? fileRow?.id : null,
		reviewBaseCommitId,
	);
	const effectiveFileRow = fileRow;
	const review: ExternalWriteReview | null =
		reviewing && fileRow && sessionReview
			? {
					fileId: fileRow.id,
					path: fileRow.path,
					reviewId: sessionReview.id,
					beforeCommitId: reviewBaseCommitId ?? "",
					afterCommitId: "",
				}
			: null;
	const isReviewing = review !== null;
	// The review's after side is the live document; only the base is fetched.
	const reviewDiff: MarkdownReviewDiff | null =
		review && fileRow && !reviewBase.loading
			? {
					beforeMarkdown: reviewBase.data
						? decodeFileDataToText(reviewBase.data)
						: "",
					afterMarkdown: decodeFileDataToText(fileRow.content),
				}
			: null;
	const [liveEditorState, setLiveEditorState] = useState<{
		readonly fileId: string;
		readonly editor: Editor;
	} | null>(null);
	const liveEditor =
		liveEditorState &&
		liveEditorState.fileId === effectiveFileRow?.id &&
		!liveEditorState.editor.isDestroyed
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
							onDispose={(editor) => {
								setLiveEditorState((current) =>
									current?.editor === editor ? null : current,
								);
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
								onDiffAccept={onDiffAccept}
								onDiffReject={onDiffReject}
								onDiffResolve={onDiffResolve}
								autoAccept={autoAcceptReviews}
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

	return <div className="flex min-h-0 flex-1 flex-col">{content}</div>;
}

function MarkdownLiveReviewController({
	sourceFilePath,
	editor,
	reviewDiff,
	reviewId,
	beforeCommitId,
	afterCommitId,
	isActive,
	openWorkspaceFile,
	onDiffAccept,
	onDiffReject,
	onDiffResolve,
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
		path: sourceFilePath,
		reviewDiff,
		onDiffAccept,
		onDiffReject,
		onDiffResolve,
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
	editorRevision,
	...props
}: {
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly fileRow: MarkdownFileRow | undefined;
	readonly isActiveView: boolean;
	readonly isPanelFocused: boolean;
	readonly editorRevision: EditorRevisionState;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
}) {
	return (
		<FileSnapshotsAtCommits
			fileId={fileId}
			beforeCommitId={editorRevision.beforeCommitId}
			afterCommitId={editorRevision.afterCommitId}
			beforeFileId={editorRevision.beforeFileId}
			afterFileId={editorRevision.afterFileId}
			beforeExists={editorRevision.beforeExists}
			afterExists={editorRevision.afterExists}
		>
			{({ beforeSnapshot, afterSnapshot }) => (
				<MarkdownHistoricalViewResolved
					{...props}
					fileId={fileId}
					editorRevision={editorRevision}
					beforeSnapshot={beforeSnapshot}
					afterSnapshot={afterSnapshot}
				/>
			)}
		</FileSnapshotsAtCommits>
	);
}

function MarkdownHistoricalViewResolved({
	fileId,
	filePath,
	fileRow,
	isActiveView,
	isPanelFocused,
	editorRevision,
	openWorkspaceFile,
	beforeSnapshot,
	afterSnapshot,
}: {
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly fileRow: MarkdownFileRow | undefined;
	readonly isActiveView: boolean;
	readonly isPanelFocused: boolean;
	readonly editorRevision: EditorRevisionState;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	readonly beforeSnapshot: HistoricalFileSnapshot | undefined;
	readonly afterSnapshot: HistoricalFileSnapshot | undefined;
}) {
	const revisionMode = editorRevisionMode(editorRevision);
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
	readonly onDiffAccept?: (path: string) => Promise<void>;
	readonly onDiffReject?: (path: string) => Promise<void>;
	readonly onDiffResolve?: (path: string, data: Uint8Array) => Promise<void>;
	readonly autoAccept?: boolean;
};

function MarkdownReviewOverlay({
	sourceFilePath,
	reviewDiff,
	reviewId,
	beforeCommitId,
	afterCommitId,
	isActive,
	openWorkspaceFile,
	controls = "review",
	onDiffAccept,
	onDiffReject,
	onDiffResolve,
}: MarkdownReviewOverlayProps) {
	const completeReview = createCompleteMarkdownReview({
		path: sourceFilePath,
		reviewDiff,
		onDiffAccept,
		onDiffReject,
		onDiffResolve,
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
	path,
	reviewDiff,
	onDiffAccept,
	onDiffReject,
	onDiffResolve,
}: Pick<
	MarkdownReviewOverlayProps,
	"reviewDiff" | "onDiffAccept" | "onDiffReject" | "onDiffResolve"
> & { readonly path: string }): (markdown: string) => Promise<void> {
	return async (markdown: string) => {
		if (onDiffResolve) {
			await onDiffResolve(path, new TextEncoder().encode(markdown));
			return;
		}
		if (markdown === reviewDiff.afterMarkdown) {
			await onDiffAccept?.(path);
			return;
		}
		if (markdown === reviewDiff.beforeMarkdown) {
			await onDiffReject?.(path);
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
			diffSession={atelier.diff.session}
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
			beforeExists={view.state.beforeExists !== false}
			afterExists={view.state.afterExists !== false}
			afterFileId={
				typeof view.state.afterFileId === "string"
					? view.state.afterFileId
					: null
			}
			onDiffAccept={atelier.diff.accept}
			onDiffReject={atelier.diff.reject}
			onDiffResolve={atelier.diff.resolve}
			autoAcceptReviews={
				(atelier.diff.session !== null &&
					"working" in atelier.diff.session.target) ||
				atelier.diff.autoAccept
			}
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
