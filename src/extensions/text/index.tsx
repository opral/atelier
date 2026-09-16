import {
	loadTextFile,
	preparedFile,
	PreparedFileSurface,
} from "../../extension-runtime/prepared-file";
import {
	Suspense,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Check, Copy, FileCode2, Search } from "lucide-react";
import type { ExtensionRuntime } from "@/extension-runtime/types";
import {
	editorRevisionMode,
	normalizeEditorRevisionState,
} from "@/extension-runtime/editor-revision-state";
import { useSyncedTextFile } from "@/extension-runtime/use-synced-text-file";
import { CheckpointAbsentFile } from "@/extension-runtime/checkpoint-absent-file";
import { decodeFileDataToText, fileText } from "@/lib/decode-file-data";
import { FileSnapshotsAtCommits } from "@/hooks/use-file-snapshots-at-commits";
import { useLix, useQueryTakeFirst } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import {
	getFileDataAtCommit,
	useWorkingFileData,
	workingReviewFile,
} from "@/shell/external-write-review-history";
import { createReactExtensionDefinition } from "../../extension-runtime/react-extension";
import { parseExtensionManifest } from "../../extension-runtime/extension-manifest";
import { viewShowsDiff } from "@/extension-runtime/diff-sides";
import { createTextEditor, type TextEditorController } from "./editor";
import manifestJson from "./manifest.json";
import "./style.css";

type TextFileRow = {
	readonly id: string;
	readonly path: string;
	readonly content: unknown;
};

export type TextViewProps = {
	readonly atelier: ExtensionRuntime;
	readonly fileId: string;
	readonly filePath?: string;
	readonly isActiveView?: boolean;
	readonly isPanelFocused?: boolean;
	readonly beforeCommitId?: string | null;
	readonly afterCommitId?: string | null;
};

export function TextView(props: TextViewProps) {
	return (
		<Suspense fallback={<TextLoadingState />}>
			<TextViewContent {...props} />
		</Suspense>
	);
}

function TextViewContent({ fileId, ...props }: TextViewProps) {
	assertFileId(fileId);
	const revision = normalizeEditorRevisionState(props);
	// The shell owns review detection: this file is under review whenever the
	// working diff session marks it pending — diff mode covers every open
	// surface, not just the revealed file. A deleted file has no live row, so
	// the review is answered before the workspace is read.
	const reviewFile = workingReviewFile(props.atelier.diff.session, fileId);
	const epoch =
		reviewFile?.review?.status === "pending"
			? reviewFile.workingEpoch
			: undefined;
	if (!epoch) {
		// A checkpoint's span is a diff too, read from history instead of the
		// review's epoch.
		if (revision.beforeCommitId && revision.afterCommitId) {
			return (
				<HistoricalTextDiff
					{...props}
					fileId={fileId}
					beforeCommitId={revision.beforeCommitId}
					afterCommitId={revision.afterCommitId}
					beforeExists={revision.beforeExists}
					afterExists={revision.afterExists}
				/>
			);
		}
		if (editorRevisionMode(revision) !== "editor") {
			return (
				<HistoricalTextView
					{...props}
					fileRow={undefined}
					fileId={fileId}
					commitId={revision.afterCommitId ?? revision.beforeCommitId}
				/>
			);
		}
	}
	// The editor and its review are one component at one position: opening or
	// closing the review changes its props, never its identity, so the mounted
	// view is reconfigured in place and nothing on screen is replaced.
	return (
		<LiveTextView
			{...props}
			fileId={fileId}
			review={
				epoch
					? {
							beforeCommitId: epoch.beforeCommitId,
							afterCommitId: epoch.afterCommitId,
							path: reviewFile?.path ?? props.filePath,
						}
					: null
			}
		/>
	);
}

/** The file at each end of a checkpoint's span, as one unified diff. */
function HistoricalTextDiff({
	fileId,
	filePath,
	beforeCommitId,
	afterCommitId,
	beforeExists,
	afterExists,
	...props
}: TextViewProps & {
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly beforeExists: boolean;
	readonly afterExists: boolean;
}) {
	return (
		<FileSnapshotsAtCommits
			fileId={fileId}
			beforeCommitId={beforeCommitId}
			afterCommitId={afterCommitId}
			beforeExists={beforeExists}
			afterExists={afterExists}
		>
			{({ beforeSnapshot, afterSnapshot }) => {
				const path =
					afterSnapshot?.path ??
					beforeSnapshot?.path ??
					filePath ??
					`/${fileId}.txt`;
				const sides = textDiffSides(
					beforeSnapshot?.content,
					afterSnapshot?.content,
				);
				if (!sides) {
					return (
						<HistoricalTextView
							{...props}
							fileRow={undefined}
							fileId={fileId}
							filePath={path}
							commitId={afterExists ? afterCommitId : beforeCommitId}
						/>
					);
				}
				return (
					<div
						className="atelier-text-view"
						data-testid="text-editor-view"
						data-comparison=""
					>
						<TextEditorSurface
							key={`${beforeCommitId}:${afterCommitId}`}
							filePath={path}
							text={sides.after ?? ""}
							original={sides.before ?? ""}
							readOnly
							toolbarDisabled
							isActive={props.isActiveView ?? true}
							isPanelFocused={props.isPanelFocused ?? true}
							onChange={() => {}}
						/>
					</div>
				);
			}}
		</FileSnapshotsAtCommits>
	);
}

type LiveTextReview = {
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly path: string | undefined;
};

/** What the editor shows of a review, once the epoch's two sides are read. */
type TextReviewState =
	| { readonly status: "loading" }
	| { readonly status: "unavailable" }
	| {
			readonly status: "ready";
			/** The before side, or `null` when the two sides cannot be diffed. */
			readonly original: string | null;
			/** The after side; empty for a deleted file. */
			readonly text: string;
	  };

/**
 * The live file, and its review when the shell opens one. Both sides of the
 * write's epoch are read here, alongside the workspace row, so the surface
 * below keeps its place while they load.
 */
function LiveTextView({
	fileId,
	review,
	...props
}: TextViewProps & { readonly review: LiveTextReview | null }) {
	const fileRow = useQueryTakeFirst<TextFileRow>(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path", "content"])
				.where("id", "=", fileId)
				.limit(1),
		{ subscribe: false },
	);
	const working = useWorkingFileData(
		review ? fileId : null,
		review?.beforeCommitId,
		review?.afterCommitId,
	);
	const reviewState: TextReviewState | null = useMemo(() => {
		if (!review) return null;
		if (working.loading) return { status: "loading" };
		if (working.error) return { status: "unavailable" };
		// A deleted file has no after side; its last content is still readable
		// as an all-removed diff.
		const sides = textDiffSides(working.data, working.afterData);
		if (sides) {
			return {
				status: "ready",
				original: sides.before ?? "",
				text: sides.after ?? "",
			};
		}
		// Nothing to compare: bytes that are not text, or two sides that read
		// the same. The read-only editor shows the side that exists.
		if (working.afterData == null) return { status: "unavailable" };
		return {
			status: "ready",
			original: null,
			text: decodeFileDataToText(working.afterData),
		};
	}, [review, working]);

	if (reviewState?.status === "unavailable") return <TextReviewUnavailable />;
	const path = review?.path || fileRow?.path || props.filePath;
	if (!fileRow) {
		// Only a review can show a file the workspace no longer has.
		if (!reviewState) {
			return (
				<div className="flex h-full items-center justify-center text-sm text-fg-subtle">
					File not found in the workspace.
				</div>
			);
		}
		if (reviewState.status === "loading") return <TextLoadingState />;
	}
	return (
		<EditableTextViewResolved
			key={fileId}
			{...props}
			fileId={fileId}
			filePath={path}
			fileRow={
				fileRow ?? {
					id: fileId,
					path: path ?? `/${fileId}.txt`,
					content: new Uint8Array(),
				}
			}
			review={reviewState}
		/>
	);
}

function EditableTextViewResolved({
	atelier,
	fileId,
	filePath,
	fileRow,
	isActiveView = true,
	isPanelFocused = true,
	review,
}: Omit<TextViewProps, "beforeCommitId" | "afterCommitId"> & {
	readonly fileRow: TextFileRow;
	readonly review: TextReviewState | null;
}) {
	const resolvedPath = fileRow.path || filePath || `/${fileId}.txt`;
	const initialText = useMemo(
		() => decodeFileDataToText(fileRow.content),
		[fileRow.content],
	);
	const isReviewing = review !== null;
	const isReadOnly = isReviewing || atelier.readOnly;

	const originKey = useMemo(() => createTextEditorOriginKey(), []);
	const {
		text: editorText,
		saveError,
		persist: persistUserEdit,
	} = useSyncedTextFile({
		fileId,
		initialText,
		// Under review the document is the epoch's after side, never a newer
		// live row; while the sides load, the live text stays on screen.
		reviewText: review?.status === "ready" ? review.text : null,
		reviewing: isReviewing,
		readOnly: atelier.readOnly,
		originKey,
	});
	const original = review?.status === "ready" ? review.original : null;

	return (
		<div
			className="atelier-text-view"
			data-testid="text-editor-view"
			data-reviewing={isReviewing || undefined}
			data-comparison={original === null ? undefined : ""}
		>
			<TextEditorSurface
				key={fileId}
				filePath={resolvedPath}
				text={editorText}
				original={original}
				readOnly={isReadOnly}
				toolbarDisabled={isReviewing}
				isActive={isActiveView}
				isPanelFocused={isPanelFocused}
				onChange={persistUserEdit}
				saveError={saveError}
			/>
		</div>
	);
}

/**
 * Both sides of a comparison as text, or `null` when the diff view cannot show
 * them: bytes that are not UTF-8, or two sides that read the same (the change
 * was metadata, or an empty file was created). The read-only editor shows the
 * side that exists in those cases.
 *
 * A side is `null` where the file has none: a created file has no before, a
 * deleted one no after.
 */
function textDiffSides(
	beforeData: unknown,
	afterData: unknown,
): { readonly before: string | null; readonly after: string | null } | null {
	const before = beforeData == null ? null : fileText(beforeData);
	const after = afterData == null ? null : fileText(afterData);
	if (beforeData != null && before === null) return null;
	if (afterData != null && after === null) return null;
	if (before === null && after === null) return null;
	if (before === null) return after === "" ? null : { before, after };
	if (after === null) return before === "" ? null : { before, after };
	return before === after ? null : { before, after };
}

function TextReviewUnavailable() {
	return (
		<div
			className="flex h-full items-center justify-center px-6 text-center text-sm text-fg-subtle"
			role="alert"
		>
			The working diff changed while it was being reviewed. Reopen the review.
		</div>
	);
}

function HistoricalTextView({
	fileRow,
	fileId,
	filePath,
	commitId,
	isActiveView = true,
	isPanelFocused = true,
}: Omit<TextViewProps, "atelier"> & {
	readonly fileRow: TextFileRow | undefined;
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
	if (snapshotText === null) return <TextLoadingState />;
	return (
		<div className="atelier-text-view" data-testid="text-editor-view">
			<TextEditorSurface
				filePath={fileRow?.path || filePath || `/${fileId}.txt`}
				text={snapshotText}
				readOnly
				isActive={isActiveView}
				isPanelFocused={isPanelFocused}
				onChange={() => {}}
			/>
		</div>
	);
}

function TextEditorSurface({
	filePath,
	text,
	original = null,
	readOnly,
	toolbarDisabled = false,
	isActive,
	isPanelFocused,
	onChange,
	saveError = null,
}: {
	readonly filePath: string;
	readonly text: string;
	/** The before side of a comparison to draw `text` against, if any. */
	readonly original?: string | null;
	readonly readOnly: boolean;
	/**
	 * The toolbar stays where it is over a comparison, disabled, so nothing
	 * on the page moves when a review opens or closes.
	 */
	readonly toolbarDisabled?: boolean;
	readonly isActive: boolean;
	readonly isPanelFocused: boolean;
	readonly onChange: (text: string) => void;
	readonly saveError?: string | null;
}) {
	const editorHostRef = useRef<HTMLDivElement>(null);
	const controllerRef = useRef<TextEditorController | null>(null);
	const onChangeRef = useRef(onChange);
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState(false);
	const copyTimerRef = useRef<number | null>(null);

	useEffect(() => {
		onChangeRef.current = onChange;
	}, [onChange]);

	useEffect(
		() => () => {
			if (copyTimerRef.current !== null)
				window.clearTimeout(copyTimerRef.current);
		},
		[],
	);

	useLayoutEffect(() => {
		const parent = editorHostRef.current;
		if (!parent) return;
		const controller = createTextEditor({
			parent,
			document: text,
			filePath,
			readOnly,
			original,
			onChange: (nextText) => onChangeRef.current(nextText),
		});
		controllerRef.current = controller;
		return () => {
			controllerRef.current = null;
			controller.destroy();
		};
		// The view is recreated only when a different file is mounted.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filePath]);

	useEffect(() => {
		controllerRef.current?.setDocument(text);
	}, [text]);

	useEffect(() => {
		controllerRef.current?.setComparison(original);
	}, [original]);

	useEffect(() => {
		controllerRef.current?.setReadOnly(readOnly);
	}, [readOnly]);

	useEffect(() => {
		if (isActive && isPanelFocused) {
			controllerRef.current?.view.focus();
		}
	}, [isActive, isPanelFocused, readOnly]);

	const copyText = async () => {
		const currentText =
			controllerRef.current?.view.state.doc.toString() ?? text;
		try {
			await navigator.clipboard.writeText(currentText);
			setCopyError(false);
			setCopied(true);
		} catch {
			setCopied(false);
			setCopyError(true);
		}
		if (copyTimerRef.current !== null)
			window.clearTimeout(copyTimerRef.current);
		copyTimerRef.current = window.setTimeout(() => {
			setCopied(false);
			setCopyError(false);
		}, 1400);
	};

	return (
		<div className="atelier-text-surface">
			<div
				className="atelier-text-toolbar"
				role="toolbar"
				aria-label="Text editor toolbar"
				aria-disabled={toolbarDisabled || undefined}
			>
				<button
					type="button"
					className="atelier-text-toolbar-button"
					onClick={() => controllerRef.current?.openSearch()}
					title="Find in file"
					disabled={toolbarDisabled}
				>
					<Search aria-hidden="true" size={16} />
					<span>Search</span>
				</button>
				<span className="atelier-text-toolbar-spacer" />
				<span className="atelier-text-toolbar-status" aria-live="polite">
					{saveError
						? `Save failed: ${saveError}`
						: copyError
							? "Copy failed"
							: copied
								? "Copied"
								: null}
				</span>
				<button
					type="button"
					className="atelier-text-toolbar-icon-button"
					onClick={() => void copyText()}
					aria-label={copied ? "Copied file contents" : "Copy file contents"}
					title={copied ? "Copied" : "Copy file contents"}
					disabled={toolbarDisabled}
				>
					{copied ? (
						<Check aria-hidden="true" size={16} />
					) : (
						<Copy aria-hidden="true" size={16} />
					)}
				</button>
			</div>
			<div className="atelier-text-editor-host" ref={editorHostRef} />
		</div>
	);
}

function TextLoadingState() {
	return (
		<div
			className="flex h-full items-center justify-center text-sm text-fg-subtle"
			role="status"
		>
			Loading text…
		</div>
	);
}

function createTextEditorOriginKey(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return `atelier.text-editor:${crypto.randomUUID()}`;
	}
	return `atelier.text-editor:${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

function assertFileId(fileId: unknown): asserts fileId is string {
	if (typeof fileId !== "string" || fileId.length === 0) {
		throw new Error("TextView requires a non-empty fileId.");
	}
}

export const extension = createReactExtensionDefinition({
	manifest: parseExtensionManifest(
		"bundled:atelier_text/manifest.json",
		JSON.stringify(manifestJson),
	),
	description: "Edit text and source files.",
	icon: FileCode2,
	load: loadTextFile,
	component: ({ atelier, view, data }) => {
		const file = preparedFile(data);
		return (
			<PreparedFileSurface
				key={file?.id ?? view.instanceId}
				readySelector=".cm-editor"
				diff={viewShowsDiff({
					session: atelier.diff.session,
					state: view.state,
				})}
				initial={
					file ? (
						<pre className="whitespace-pre-wrap p-4 font-mono text-sm">
							{file.content}
						</pre>
					) : (
						<p>File not found in the workspace.</p>
					)
				}
			>
				<TextView
					atelier={atelier}
					fileId={view.state.fileId as string}
					filePath={view.state.filePath as string | undefined}
					isActiveView={view.isActive}
					isPanelFocused={view.isFocused}
					beforeCommitId={
						view.state.beforeCommitId as string | null | undefined
					}
					afterCommitId={view.state.afterCommitId as string | null | undefined}
				/>
			</PreparedFileSurface>
		);
	},
});
