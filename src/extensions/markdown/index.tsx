import { DocumentLoading } from "../../components/document-loading";
import { RepositoryMarkdownContent } from "./repository-markdown-content";
import {
	loadTextFile,
	preparedFile,
	PreparedFileSurface,
} from "../../extension-runtime/prepared-file";
import { Suspense, useEffect } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/core";
import { FileText, Loader2 } from "lucide-react";
import {
	useLix,
	useQueryResult,
	useResolvedActiveBranchId,
} from "@/lib/lix-react";
import {
	FileSnapshotsAtCommits,
	type HistoricalFileSnapshot,
} from "@/hooks/use-file-snapshots-at-commits";
import { isMarkdownFilePath } from "@/extension-runtime/file-handlers";
import { CheckpointAbsentFile } from "@/extension-runtime/checkpoint-absent-file";
import { useDeferredRevisionProps } from "@/extension-runtime/use-deferred-revision-props";
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
import {
	createEditor,
	createMarkdownEditorOriginKey,
} from "@/extensions/markdown/editor/create-editor";
import {
	createMarkdownFrontmatterWriter,
	differsOnlyInFrontmatter,
} from "@/extensions/markdown/editor/frontmatter-file";
import {
	MarkdownFrontmatterEditingContext,
	type MarkdownFrontmatterEditing,
} from "@/extensions/markdown/editor/frontmatter-editing-context";
import { useTitleDrivenFileRename } from "@/extensions/markdown/editor/use-title-driven-rename";
import type { EmptyMarkdownDefaultBlock } from "@/extensions/markdown/editor/tiptap-markdown-bridge";
import { MarkdownReviewEditor } from "./review/review-editor";
import { MarkdownReviewExtensions } from "./review/review-extension";
import "./style.css";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import manifestJson from "./manifest.json";
import { FormattingToolbar } from "./components/formatting-toolbar";
import { SlashCommandMenu } from "./components/slash-command-menu";
import { SelectionToolbar } from "./components/selection-toolbar";
import { EmojiPickerMenu } from "./components/emoji-picker-menu";
import { EmbedFilePickerMenu } from "./components/embed-file-picker-menu";
import { MentionMenu } from "./components/mention-menu";
import { DocumentLinksContext } from "./editor/document-links-context";
import type { MarkdownReviewDiff } from "./review-diff";
import {
	decodeFileDataToBytes,
	decodeFileDataToText,
} from "@/lib/decode-file-data";
import type {
	ExternalWriteReview,
	ExternalWriteReviewData,
} from "@/extension-runtime/external-write-review";
import type { CommitSpan } from "@lix-js/sdk";
import type { AtelierDiffFile, AtelierDiffSession } from "@/extension-api";
import {
	editorRevisionMode,
	editorRevisionReviewId,
	hasHistoricalEditorRevisionState,
	normalizeEditorRevisionState,
	type EditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import {
	useWorkingFileData,
	workingReviewFile,
} from "@/shell/external-write-review-history";
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
	readonly onDocumentModified?: (
		filePath: string,
		commit?: CommitSpan | null,
	) => void;
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

const PAST_REVISION_FRONTMATTER: MarkdownFrontmatterEditing = {
	kind: "readOnly",
	reason: "Past revision — read-only",
};

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
	// Deferred so revision switches keep the previous document mounted while
	// the next revision's reads suspend, instead of flashing the fallback.
	const revision = useDeferredRevisionProps({
		beforeCommitId,
		afterCommitId,
		beforeFileId,
		afterFileId,
		beforeExists,
		afterExists,
	});
	if (!resolvedActiveBranchId) {
		return <MarkdownLoadingSpinner readOnly={readOnly ?? false} />;
	}
	return (
		<Suspense
			fallback={<MarkdownLoadingSpinner readOnly={readOnly ?? false} />}
		>
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
				beforeCommitId={revision.beforeCommitId}
				afterCommitId={revision.afterCommitId}
				beforeFileId={revision.beforeFileId}
				afterFileId={revision.afterFileId}
				beforeExists={revision.beforeExists}
				afterExists={revision.afterExists}
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
	const workingFile = workingReviewFile(props.diffSession, fileId);
	if (
		editorRevisionMode(editorRevision) !== "editor" &&
		(editorRevision.afterCommitId !== null || workingFile?.workingEpoch)
	) {
		return (
			<MarkdownHistoricalViewLoaded
				fileId={fileId}
				filePath={props.filePath}
				fileRow={undefined}
				readOnly={props.readOnly ?? false}
				isActiveView={props.isActiveView ?? true}
				isPanelFocused={props.isPanelFocused ?? true}
				editorRevision={editorRevision}
				openWorkspaceFile={props.openWorkspaceFile}
				diffSession={props.diffSession}
			/>
		);
	}
	return (
		<MarkdownLiveDelivery
			fileId={fileId}
			comparesAgainstCurrentFile={comparesAgainstCurrentFile}
			{...props}
		/>
	);
}

function MarkdownLiveDelivery({
	fileId,
	comparesAgainstCurrentFile,
	...props
}: MarkdownViewProps & { readonly comparesAgainstCurrentFile: boolean }) {
	const editorRevision = normalizeEditorRevisionState({
		beforeCommitId: props.beforeCommitId,
		afterCommitId: props.afterCommitId,
		beforeFileId: props.beforeFileId,
		afterFileId: props.afterFileId,
		beforeExists: props.beforeExists,
		afterExists: props.afterExists,
	});
	const ownsLiveFileDelivery = editorRevisionMode(editorRevision) === "editor";
	const fileResult = useQueryResult<MarkdownFileRow>(
		(lix) =>
			selectMarkdownFileDelivery(lix, props.activeBranchId ?? "", fileId),
		{
			subscribe: ownsLiveFileDelivery || comparesAgainstCurrentFile,
		},
	);
	// The last document delivered. A view handed another document — a review
	// stepping from one file to the next — keeps showing this one, toolbar
	// and editor in place, until the next one's row lands; only a view that
	// has shown nothing yet waits in its frame.
	const delivered = useRef<{
		readonly fileId: string;
		readonly filePath: string | undefined;
		readonly fileRow: MarkdownFileRow | undefined;
	} | null>(null);
	if (fileResult.status === "success") {
		delivered.current = {
			fileId,
			filePath: props.filePath,
			fileRow: fileResult.rows[0],
		};
	}
	if (fileResult.status === "error") throw fileResult.error;
	if (fileResult.status === "pending") {
		if (!delivered.current) {
			return <MarkdownLoadingSpinner readOnly={props.readOnly ?? false} />;
		}
		return (
			<MarkdownViewLoaded
				{...props}
				fileId={delivered.current.fileId}
				filePath={delivered.current.filePath}
				fileRow={delivered.current.fileRow}
			/>
		);
	}
	const fileRow = fileResult.rows[0];

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
		readOnly = false,
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
				readOnly={readOnly}
				isActiveView={isActiveView}
				isPanelFocused={isPanelFocused}
				editorRevision={editorRevision}
				openWorkspaceFile={openWorkspaceFile}
				diffSession={props.diffSession}
			/>
		);
	}

	return <MarkdownLiveViewLoaded {...props} />;
}

function MarkdownLiveViewLoaded({
	fileId,
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
	// The shell owns review detection: this document is under review whenever
	// the working diff session marks it pending — diff mode covers every open
	// surface, not just the revealed file.
	const session = diffSession ?? null;
	const sessionFile = workingReviewFile(session, fileId);
	const sessionReview = sessionFile?.review;
	const reviewing = sessionReview?.status === "pending";
	// An added file has no base to fetch: its history is absent, so its before
	// side is empty by definition.
	const workingEpoch = reviewing ? sessionFile?.workingEpoch : undefined;
	const reviewBase = useWorkingFileData(
		workingEpoch ? fileId : null,
		workingEpoch?.beforeCommitId,
		workingEpoch?.afterCommitId,
	);
	const reviewUnavailableMessage =
		!reviewBase.loading && reviewBase.error
			? "The working diff changed while it was being reviewed. Reopen the review."
			: reviewing && !fileRow
				? "This file changed or was removed after the review opened. Reopen the review."
				: null;
	const effectiveFileRow =
		reviewing && fileRow && sessionFile && !reviewBase.loading
			? {
					id: fileId,
					path: sessionFile.path,
					content: reviewBase.afterData ?? EMPTY_FILE_DATA,
				}
			: fileRow;
	const review: ExternalWriteReview | null =
		reviewing && effectiveFileRow && sessionReview
			? {
					fileId,
					path: sessionFile?.path ?? effectiveFileRow.path,
					reviewId: sessionReview.id,
					beforeCommitId: workingEpoch?.beforeCommitId ?? "",
					afterCommitId: workingEpoch?.afterCommitId ?? "",
				}
			: null;
	const isReviewing = review !== null;
	const epochAfterMarkdown =
		!reviewBase.loading && reviewBase.afterData
			? decodeFileDataToText(reviewBase.afterData)
			: "";
	const liveMarkdown =
		reviewing && fileRow ? decodeFileDataToText(fileRow.content) : "";
	// Both sides come from the certified working epoch, never from a newer live
	// row — except in the frontmatter, which this surface writes to the file
	// while the review is open. The epoch froze the property the panel has
	// since replaced, and a diff must never show a value no revision holds.
	const afterMarkdown = useMemo(
		() =>
			differsOnlyInFrontmatter(epochAfterMarkdown, liveMarkdown)
				? liveMarkdown
				: epochAfterMarkdown,
		[epochAfterMarkdown, liveMarkdown],
	);
	const reviewDiff: MarkdownReviewDiff | null =
		review && effectiveFileRow && !reviewBase.loading && !reviewBase.error
			? {
					beforeMarkdown: reviewBase.data
						? decodeFileDataToText(reviewBase.data)
						: "",
					afterMarkdown,
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
	// A document opened while its review is active must never paint as its
	// live self: the reviewer stepped to it for the diff. The editor mounts
	// out of sight and shows on the frame the review document lands in it.
	// A document that was already on screen when its review opened keeps its
	// live frame instead — the marks arrive on it in place — so nothing
	// disappears only to come back.
	const openedUnderReviewRef = useRef<{
		readonly fileId: string;
		readonly value: boolean;
	} | null>(null);
	if (openedUnderReviewRef.current?.fileId !== fileId) {
		openedUnderReviewRef.current = { fileId, value: reviewing };
	}
	const reviewKey = review
		? `${review.reviewId}:${review.beforeCommitId}:${review.afterCommitId}`
		: null;
	const [appliedReviewKey, setAppliedReviewKey] = useState<string | null>(null);
	const reviewPending =
		openedUnderReviewRef.current.value &&
		reviewing &&
		!readOnly &&
		// A no-op diff has nothing to land: the document is its own review.
		!(
			reviewDiff !== null &&
			reviewDiff.beforeMarkdown === reviewDiff.afterMarkdown
		) &&
		(reviewKey === null || appliedReviewKey !== reviewKey);
	const lix = useLix();
	// The editor recreates when its source path prop changes, which would drop
	// the caret on every title-driven rename. Only a directory change (a real
	// move, where relative asset resolution shifts) refreshes the prop; plain
	// renames keep the mounted editor.
	const editorPathRef = useRef<{ fileId?: string; path?: string }>({});
	const parentDirOf = (path?: string) =>
		path?.slice(0, path.lastIndexOf("/") + 1);
	if (
		editorPathRef.current.fileId !== effectiveFileRow?.id ||
		parentDirOf(editorPathRef.current.path) !==
			parentDirOf(effectiveFileRow?.path)
	) {
		editorPathRef.current = {
			fileId: effectiveFileRow?.id,
			path: effectiveFileRow?.path,
		};
	}
	const editorSourcePath = editorPathRef.current.path;
	const frontmatterOriginKey = useMemo(
		() => createMarkdownEditorOriginKey(),
		[],
	);
	const writeFrontmatterToFile = useMemo(
		() =>
			createMarkdownFrontmatterWriter({
				lix,
				fileId,
				originKey: frontmatterOriginKey,
			}),
		[fileId, frontmatterOriginKey, lix],
	);
	// A property written from here is an edit to the document like any other,
	// and the surfaces watching for one — the review the panel may be sitting
	// inside — are told so. Without it the reviewer's own edit read as someone
	// else moving the file underneath them.
	const writeFrontmatter = useCallback(
		async (source: string, baseSource: string) => {
			const commit = await writeFrontmatterToFile(source, baseSource);
			if (effectiveFileRow?.path) {
				onDocumentModified?.(effectiveFileRow.path, commit);
			}
		},
		[effectiveFileRow?.path, onDocumentModified, writeFrontmatterToFile],
	);
	// Frontmatter is a property panel, and a property panel keeps what it is
	// given. Under a review the document on screen is a diff projection that
	// cannot be serialized back, so the property goes to the file directly.
	const frontmatterEditing = useMemo<MarkdownFrontmatterEditing>(() => {
		if (readOnly) return { kind: "readOnly", reason: "Read-only" };
		if (!reviewLocked) return { kind: "document" };
		return { kind: "file", write: writeFrontmatter };
	}, [readOnly, reviewLocked, writeFrontmatter]);
	useTitleDrivenFileRename({
		lix,
		fileId: effectiveFileRow?.id,
		filePath: effectiveFileRow?.path,
		editor: liveEditor,
		enabled:
			!editorReadOnly &&
			Boolean(effectiveFileRow && isMarkdownFilePath(effectiveFileRow.path)),
	});

	let content: ReactNode;

	if (reviewUnavailableMessage) {
		content = (
			<WorkingMarkdownReviewUnavailable message={reviewUnavailableMessage} />
		);
	} else if (!effectiveFileRow) {
		content = (
			<div className="flex h-full items-center justify-center text-sm text-fg-subtle">
				File not found in the workspace.
			</div>
		);
	} else if (!isMarkdownFilePath(effectiveFileRow.path)) {
		content = <UnsupportedFilePlaceholder filePath={effectiveFileRow.path} />;
	} else {
		content = (
			<MarkdownFrontmatterEditingContext.Provider value={frontmatterEditing}>
				<EditorProvider>
					<div
						className={`markdown-view flex h-full flex-col bg-panel ${
							reviewLocked ? "markdown-review" : ""
						}`}
					>
						{!readOnly && <FormattingToolbar disabled={editorReadOnly} />}
						<div
							className={`relative min-h-0 flex-1 ${
								reviewPending ? "invisible" : ""
							}`}
							data-attr="markdown-editor"
							data-review-pending={reviewPending || undefined}
						>
							<TipTapEditor
								className="h-full"
								fileId={effectiveFileRow.id}
								activeBranchId={activeBranchId}
								filePath={editorSourcePath ?? effectiveFileRow.path}
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
								onPersist={({ filePath: persistedPath, commit }) => {
									const resolvedPath = persistedPath ?? effectiveFileRow.path;
									onDocumentModified?.(resolvedPath, commit);
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
									onDocumentApplied={() => setAppliedReviewKey(reviewKey)}
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
						</div>
						{editorReadOnly ? null : (
							<>
								<SelectionToolbar />
								<SlashCommandMenu />
								<EmojiPickerMenu />
								<EmbedFilePickerMenu sourceFilePath={effectiveFileRow.path} />
								<MentionMenu sourceFilePath={effectiveFileRow.path} />
							</>
						)}
					</div>
				</EditorProvider>
			</MarkdownFrontmatterEditingContext.Provider>
		);
	}

	return <div className="flex min-h-0 flex-1 flex-col">{content}</div>;
}

function WorkingMarkdownReviewUnavailable({
	message,
}: {
	readonly message: string;
}) {
	return (
		<div
			className="flex h-full items-center justify-center px-6 text-center text-sm text-fg-subtle"
			role="alert"
		>
			{message}
		</div>
	);
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
	onDocumentApplied,
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
				onDocumentApplied={onDocumentApplied}
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
			onDocumentApplied={onDocumentApplied}
		/>
	);
}

function MarkdownHistoricalViewLoaded({
	fileId,
	editorRevision,
	diffSession,
	...props
}: {
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly fileRow: MarkdownFileRow | undefined;
	/** The host allows no editing at all; only then is there no toolbar. */
	readonly readOnly: boolean;
	readonly isActiveView: boolean;
	readonly isPanelFocused: boolean;
	readonly editorRevision: EditorRevisionState;
	readonly diffSession?: AtelierDiffSession | null;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
}) {
	const workingFile =
		diffSession && "working" in diffSession.target
			? diffSession.files.find((file) => file.id === fileId)
			: undefined;
	if (workingFile?.workingEpoch) {
		return (
			<MarkdownWorkingHistoricalView
				{...props}
				fileId={fileId}
				editorRevision={editorRevision}
				workingFile={workingFile}
			/>
		);
	}
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

function MarkdownWorkingHistoricalView({
	fileId,
	editorRevision,
	workingFile,
	...props
}: {
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly fileRow: MarkdownFileRow | undefined;
	readonly readOnly: boolean;
	readonly isActiveView: boolean;
	readonly isPanelFocused: boolean;
	readonly editorRevision: EditorRevisionState;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	readonly workingFile: AtelierDiffFile;
}) {
	const epoch = workingFile.workingEpoch!;
	const before = useWorkingFileData(
		fileId,
		epoch.beforeCommitId,
		epoch.afterCommitId,
	);
	if (!before.loading && before.error) {
		return (
			<WorkingMarkdownReviewUnavailable message="The working diff changed while it was being reviewed. Reopen the review." />
		);
	}
	if (before.loading) {
		return <MarkdownLoadingSpinner readOnly={props.readOnly} />;
	}
	const beforeSnapshot = before.data
		? { id: fileId, path: workingFile.path, content: before.data }
		: undefined;
	return (
		<MarkdownHistoricalViewResolved
			{...props}
			fileId={fileId}
			editorRevision={editorRevision}
			beforeSnapshot={beforeSnapshot}
			afterSnapshot={undefined}
		/>
	);
}

function MarkdownHistoricalViewResolved({
	fileId,
	filePath,
	fileRow,
	readOnly,
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
	readonly readOnly: boolean;
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
		// No version at either side of the span: the absence is temporal.
		content = (
			<CheckpointAbsentFile
				filePath={filePath}
				commitId={editorRevision.afterCommitId ?? editorRevision.beforeCommitId}
			/>
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
				readOnly={readOnly}
			/>
		);
	} else {
		content = (
			<EditorProvider>
				<div className="markdown-view markdown-review flex h-full flex-col bg-panel">
					{/* The same toolbar the editor has, only disabled: a past
					    revision takes no formatting, but the page must not move
					    when the review opens over the document. */}
					{!readOnly && <FormattingToolbar disabled />}
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

	// Every document here is a past commit: a property panel that took an edit
	// would be writing to a revision nothing can write.
	return (
		<MarkdownFrontmatterEditingContext.Provider
			value={PAST_REVISION_FRONTMATTER}
		>
			<div className="flex min-h-0 flex-1 flex-col">{content}</div>
		</MarkdownFrontmatterEditingContext.Provider>
	);
}

function MarkdownSnapshotView({
	filePath,
	markdown,
	sourceCommitId,
	openWorkspaceFile,
	readOnly,
}: {
	readonly filePath: string;
	readonly markdown: string;
	readonly sourceCommitId?: string;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	readonly readOnly: boolean;
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
			<MarkdownSnapshotEditor editor={editor} readOnly={readOnly} />
		</EditorProvider>
	);
}

function MarkdownSnapshotEditor({
	editor,
	readOnly,
}: {
	readonly editor: Editor;
	readonly readOnly: boolean;
}) {
	const { setEditor } = useEditorCtx();
	useEffect(() => {
		setEditor(editor);
		return () => {
			setEditor((current) => (current === editor ? null : current));
		};
	}, [editor, setEditor]);

	return (
		<div className="markdown-view flex h-full flex-col bg-panel">
			{!readOnly && <FormattingToolbar disabled />}
			<div className="relative min-h-0 flex-1" data-attr="markdown-editor">
				<div className="ph-mask tiptap-container h-full w-full overflow-y-auto bg-panel">
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
	readonly onDocumentApplied?: () => void;
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
			<div className="inline-flex items-center rounded-md border border-border bg-panel px-2.5 py-1.5 text-xs text-fg-muted shadow-sm">
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

	// A pinned span with no snapshot on either side means the file does not
	// exist anywhere in the compared range — that renders as the temporal
	// absent state, not as an empty document diff.
	if (
		!args.beforeSnapshot &&
		!args.afterSnapshot &&
		args.revision.afterCommitId !== null
	) {
		return null;
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
			<div className="max-w-sm space-y-2 text-sm text-fg-muted">
				<p className="font-medium text-fg">
					This file type is not supported yet.
				</p>
				<p>
					Atelier only opens markdown files in this editor, so{" "}
					<span className="font-mono text-xs text-fg-muted">{filePath}</span>{" "}
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

/**
 * While a document's rows are on their way the view shows the same white
 * surface the editor paints, with the same toolbar above it — disabled, it
 * has no editor yet — so opening a file never flashes a spinner between two
 * pages and nothing moves when the document lands. The toolbar is the
 * host's call, not the document's, so it is known before any row is.
 */
function MarkdownLoadingSpinner({
	readOnly,
}: {
	readonly readOnly: boolean;
}): ReactNode {
	return (
		<EditorProvider>
			<div className="markdown-view flex h-full flex-col bg-panel">
				{!readOnly && <FormattingToolbar disabled />}
				<DocumentLoading />
			</div>
		</EditorProvider>
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
	load: loadTextFile,
	component: ({ atelier, view, data }) => {
		const file = preparedFile(data);
		// The runtime folds "this is a past revision" into `readOnly`. The
		// toolbar is the host's call, not the revision's: over a checkpoint or
		// a review it stays where it is, disabled, so nothing on the page moves
		// when a review opens or closes.
		const hostReadOnly =
			atelier.readOnly && !hasHistoricalEditorRevisionState(view.state);
		// A file under review is opened for its diff. The placeholder keeps the
		// frame — toolbar strip, column — and paints no live document in it.
		const underReview =
			file !== null &&
			workingReviewFile(atelier.diff.session, file.id)?.review?.status ===
				"pending";
		return (
			<PreparedFileSurface
				documentKey={file?.id ?? view.instanceId}
				readySelector=".tiptap.ProseMirror"
				initial={
					file ? (
						// Laid out exactly like the editor that replaces it (toolbar
						// strip, container, the ProseMirror column with the
						// document's type), so the swap to the live editor moves
						// nothing on screen.
						<div className="markdown-view flex h-full flex-col bg-panel">
							{hostReadOnly ? null : (
								<div
									aria-hidden="true"
									className="h-10 shrink-0 border-b border-border-subtle"
								/>
							)}
							<div className="tiptap-container relative h-full min-h-0 w-full overflow-y-auto bg-panel">
								{underReview ? null : (
									<RepositoryMarkdownContent
										className="ProseMirror atelier-document"
										content={file.content}
										path={file.path}
										branchId={atelier.branches.activeId}
										commitId={[
											view.state.sourceCommitId,
											view.state.afterCommitId,
											view.state.beforeCommitId,
										].find(
											(value): value is string => typeof value === "string",
										)}
									/>
								)}
							</div>
						</div>
					) : (
						<p>File not found in the workspace.</p>
					)
				}
			>
				<DocumentLinksContext.Provider value={atelier.documentLinks}>
					<MarkdownView
						fileId={view.state.fileId as string}
						filePath={view.state.filePath as string | undefined}
						readOnly={hostReadOnly}
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
								...(args.newTab !== undefined ? { newTab: args.newTab } : {}),
								...(args.state ? { state: args.state } : {}),
								...(args.focus !== undefined ? { focus: args.focus } : {}),
							})
						}
						onDocumentModified={(filePath, commit) =>
							atelier.events.emit({
								type: "document_modified",
								filePath,
								modifiedBy: "user",
								...(commit !== undefined ? { commit } : {}),
							})
						}
					/>
				</DocumentLinksContext.Provider>
			</PreparedFileSurface>
		);
	},
});
