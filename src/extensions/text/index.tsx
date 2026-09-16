import {
	loadTextFile,
	preparedFile,
	PreparedFileSurface,
} from "../../extension-runtime/prepared-file";
import {
	createContext,
	Suspense,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
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
import { useLix, useQueryResult } from "@/lib/lix-react";
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

/**
 * The text view is a frame and a document. The frame — toolbar, editor box,
 * background — is rendered from props that are always there, so it is on
 * screen from the first paint and stays put through every change of
 * document, revision or review. What the document is, and when it arrives,
 * is decided by a headless child that reads it and hands it to the frame's
 * editor; until then the editor keeps showing what it showed.
 */
export function TextView(props: TextViewProps) {
	const { fileId } = props;
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
	const review: LiveTextReview | null = epoch
		? {
				beforeCommitId: epoch.beforeCommitId,
				afterCommitId: epoch.afterCommitId,
				path: reviewFile?.path ?? props.filePath,
			}
		: null;
	// A checkpoint's span is a diff too, read from history instead of the
	// review's epoch.
	const historicalDiff =
		review === null &&
		revision.beforeCommitId !== null &&
		revision.afterCommitId !== null;
	const historical =
		review === null &&
		!historicalDiff &&
		editorRevisionMode(revision) !== "editor";
	return (
		<TextFrame
			reviewing={review !== null}
			// The toolbar stays where it is over a comparison, disabled, so
			// nothing on the page moves when a review opens or closes.
			toolbarDisabled={review !== null || historicalDiff}
			isActive={props.isActiveView ?? true}
			isPanelFocused={props.isPanelFocused ?? true}
		>
			{/* The documents below render no DOM of their own, so a read that
			    suspends here hides nothing: the frame and the previous document
			    stay on screen. */}
			<Suspense fallback={null}>
				{historicalDiff ? (
					<HistoricalTextDiff
						fileId={fileId}
						filePath={props.filePath}
						beforeCommitId={revision.beforeCommitId!}
						afterCommitId={revision.afterCommitId!}
						beforeExists={revision.beforeExists}
						afterExists={revision.afterExists}
					/>
				) : historical ? (
					<HistoricalTextDocument
						fileId={fileId}
						filePath={props.filePath}
						commitId={revision.afterCommitId ?? revision.beforeCommitId}
					/>
				) : (
					<LiveTextDocument
						atelier={props.atelier}
						fileId={fileId}
						filePath={props.filePath}
						review={review}
					/>
				)}
			</Suspense>
		</TextFrame>
	);
}

/** A document as the frame's editor shows it. */
type TextDocument = {
	readonly fileId: string;
	readonly filePath: string;
	readonly text: string;
	/** The before side of a comparison to draw `text` against, if any. */
	readonly original: string | null;
	readonly readOnly: boolean;
	readonly saveError: string | null;
};

type TextFrameHandle = {
	/**
	 * Put a document in the editor. Another file replaces the one shown with
	 * a fresh state; the same file is reconfigured in place. With
	 * `onlyIfShown`, a file that is not the one on screen is left for later
	 * and the region keeps what it has.
	 */
	readonly show: (
		document: TextDocument,
		onChange: (text: string) => void,
		options?: { readonly onlyIfShown?: boolean },
	) => void;
	/** The document's owner is gone; its edits have nowhere to go. */
	readonly release: (fileId: string) => void;
	/** A message stands in the document region while `shown`. */
	readonly setMessage: (shown: boolean) => void;
};

const TextFrameContext = createContext<TextFrameHandle | null>(null);

function ignoreChange() {}

/**
 * The view's frame: toolbar, editor box and whatever the document region
 * says instead of a document. It owns the one CodeMirror view, created with
 * the frame and kept for its life; documents come and go inside it.
 */
function TextFrame({
	reviewing,
	toolbarDisabled,
	isActive,
	isPanelFocused,
	children,
}: {
	readonly reviewing: boolean;
	readonly toolbarDisabled: boolean;
	readonly isActive: boolean;
	readonly isPanelFocused: boolean;
	readonly children: ReactNode;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const controllerRef = useRef<TextEditorController | null>(null);
	const currentRef = useRef<
		(TextDocument & { readonly onChange: (text: string) => void }) | null
	>(null);
	const [shown, setShown] = useState<{
		readonly fileId: string;
		readonly comparison: boolean;
		readonly readOnly: boolean;
		readonly saveError: string | null;
	} | null>(null);
	const [messages, setMessages] = useState(0);
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState(false);
	const copyTimerRef = useRef<number | null>(null);

	const handle = useMemo<
		TextFrameHandle & { readonly mount: () => void }
	>(() => {
		// Created on first use: a document's layout effect runs before the
		// frame's own, and the host element is already attached by then.
		const controller = () => {
			if (controllerRef.current) return controllerRef.current;
			const parent = hostRef.current;
			if (!parent) throw new Error("The text editor host is not mounted.");
			controllerRef.current = createTextEditor({
				parent,
				document: "",
				filePath: "",
				readOnly: true,
				onChange: (text) => currentRef.current?.onChange(text),
			});
			return controllerRef.current;
		};
		return {
			mount: () => {
				controller();
			},
			show: (document, onChange, options) => {
				const current = currentRef.current;
				if (options?.onlyIfShown && current?.fileId !== document.fileId) return;
				const editor = controller();
				if (
					!current ||
					current.fileId !== document.fileId ||
					current.filePath !== document.filePath
				) {
					editor.openDocument({
						document: document.text,
						filePath: document.filePath,
						readOnly: document.readOnly,
						original: document.original,
					});
				} else {
					if (current.text !== document.text) editor.setDocument(document.text);
					if (current.original !== document.original)
						editor.setComparison(document.original);
					if (current.readOnly !== document.readOnly)
						editor.setReadOnly(document.readOnly);
				}
				currentRef.current = { ...document, onChange };
				setShown({
					fileId: document.fileId,
					comparison: document.original !== null,
					readOnly: document.readOnly,
					saveError: document.saveError,
				});
			},
			release: (fileId) => {
				const current = currentRef.current;
				if (current?.fileId === fileId)
					currentRef.current = { ...current, onChange: ignoreChange };
			},
			setMessage: (visible) => {
				setMessages((count) => count + (visible ? 1 : -1));
			},
		};
	}, []);

	useLayoutEffect(() => {
		handle.mount();
		return () => {
			controllerRef.current?.destroy();
			controllerRef.current = null;
			currentRef.current = null;
		};
	}, [handle]);

	useEffect(
		() => () => {
			if (copyTimerRef.current !== null)
				window.clearTimeout(copyTimerRef.current);
		},
		[],
	);

	useEffect(() => {
		if (isActive && isPanelFocused) {
			controllerRef.current?.view.focus();
		}
	}, [isActive, isPanelFocused, shown?.fileId, shown?.readOnly]);

	const copyText = async () => {
		const currentText = controllerRef.current?.view.state.doc.toString() ?? "";
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

	const saveError = shown?.saveError ?? null;
	return (
		<TextFrameContext.Provider value={handle}>
			<div
				className="atelier-text-view"
				data-testid="text-editor-view"
				data-reviewing={reviewing || undefined}
				data-comparison={shown?.comparison ? "" : undefined}
				data-document={shown ? "" : undefined}
				aria-busy={!shown && messages === 0 ? "true" : undefined}
			>
				<div className="atelier-text-surface">
					<TextToolbar
						disabled={toolbarDisabled}
						copied={copied}
						status={
							saveError
								? `Save failed: ${saveError}`
								: copyError
									? "Copy failed"
									: copied
										? "Copied"
										: null
						}
						onSearch={() => controllerRef.current?.openSearch()}
						onCopy={() => void copyText()}
					/>
					<div
						className="atelier-text-editor-host"
						ref={hostRef}
						hidden={messages > 0 || undefined}
						data-empty={shown ? undefined : ""}
					/>
					{children}
				</div>
			</div>
		</TextFrameContext.Provider>
	);
}

function TextToolbar({
	disabled,
	copied = false,
	status = null,
	onSearch,
	onCopy,
	hidden = false,
}: {
	readonly disabled: boolean;
	readonly copied?: boolean;
	readonly status?: string | null;
	readonly onSearch?: () => void;
	readonly onCopy?: () => void;
	/** The prepared frame's toolbar: the shape of the live one, not a control. */
	readonly hidden?: boolean;
}) {
	return (
		<div
			className="atelier-text-toolbar"
			role="toolbar"
			aria-label="Text editor toolbar"
			aria-disabled={disabled || undefined}
			aria-hidden={hidden || undefined}
		>
			<button
				type="button"
				className="atelier-text-toolbar-button"
				onClick={onSearch}
				title="Find in file"
				disabled={disabled}
			>
				<Search aria-hidden="true" size={16} />
				<span>Search</span>
			</button>
			<span className="atelier-text-toolbar-spacer" />
			<span className="atelier-text-toolbar-status" aria-live="polite">
				{status}
			</span>
			<button
				type="button"
				className="atelier-text-toolbar-icon-button"
				onClick={onCopy}
				aria-label={copied ? "Copied file contents" : "Copy file contents"}
				title={copied ? "Copied" : "Copy file contents"}
				disabled={disabled}
			>
				{copied ? (
					<Check aria-hidden="true" size={16} />
				) : (
					<Copy aria-hidden="true" size={16} />
				)}
			</button>
		</div>
	);
}

/**
 * Hands a document to the frame's editor as soon as it is known, before the
 * browser paints. `null` hands over nothing: the editor keeps what it shows.
 */
function useShownDocument(
	document: TextDocument | null,
	onChange: (text: string) => void = ignoreChange,
	options?: { readonly onlyIfShown?: boolean },
) {
	const frame = useContext(TextFrameContext);
	if (!frame) throw new Error("A text document renders inside TextFrame.");
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const onlyIfShown = options?.onlyIfShown ?? false;
	const fileId = document?.fileId;
	const filePath = document?.filePath;
	const text = document?.text;
	const original = document?.original;
	const readOnly = document?.readOnly;
	const saveError = document?.saveError;
	useLayoutEffect(() => {
		if (
			fileId === undefined ||
			filePath === undefined ||
			text === undefined ||
			original === undefined ||
			readOnly === undefined ||
			saveError === undefined
		)
			return;
		frame.show(
			{ fileId, filePath, text, original, readOnly, saveError },
			(next) => onChangeRef.current(next),
			{ onlyIfShown },
		);
	}, [
		frame,
		fileId,
		filePath,
		text,
		original,
		readOnly,
		saveError,
		onlyIfShown,
	]);
	useLayoutEffect(() => {
		if (fileId === undefined) return;
		return () => frame.release(fileId);
	}, [frame, fileId]);
}

function ShownDocument({
	document,
}: {
	readonly document: TextDocument | null;
}) {
	useShownDocument(document);
	return null;
}

/** What the document region says instead of a document. */
function TextMessage({
	role,
	children,
}: {
	readonly role?: "alert";
	readonly children: ReactNode;
}) {
	const frame = useContext(TextFrameContext);
	useLayoutEffect(() => {
		frame?.setMessage(true);
		return () => frame?.setMessage(false);
	}, [frame]);
	return (
		<div className="atelier-text-message text-sm text-fg-subtle" role={role}>
			{children}
		</div>
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
}: {
	readonly fileId: string;
	readonly filePath: string | undefined;
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
						<HistoricalTextDocument
							fileId={fileId}
							filePath={path}
							commitId={afterExists ? afterCommitId : beforeCommitId}
						/>
					);
				}
				return (
					<ShownDocument
						document={{
							fileId,
							filePath: path,
							text: sides.after ?? "",
							original: sides.before ?? "",
							readOnly: true,
							saveError: null,
						}}
					/>
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
 * write's epoch are read here, alongside the workspace row; neither read
 * suspends, and until they land the frame keeps showing what it has.
 */
function LiveTextDocument({
	atelier,
	fileId,
	filePath,
	review,
}: {
	readonly atelier: ExtensionRuntime;
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly review: LiveTextReview | null;
}) {
	const fileResult = useQueryResult<TextFileRow>(
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

	if (fileResult.status === "error") throw fileResult.error;
	if (reviewState?.status === "unavailable") {
		return (
			<TextMessage role="alert">
				The working diff changed while it was being reviewed. Reopen the review.
			</TextMessage>
		);
	}
	// The row is on its way: the region keeps what it shows — the document
	// stepped from, or nothing yet — rather than a loading state.
	if (fileResult.status === "pending") return null;
	const fileRow = fileResult.rows[0];
	const path = review?.path || fileRow?.path || filePath;
	if (!fileRow) {
		// Only a review can show a file the workspace no longer has.
		if (!reviewState) {
			return <TextMessage>File not found in the workspace.</TextMessage>;
		}
		if (reviewState.status === "loading") return null;
	}
	return (
		<EditableTextDocument
			key={fileId}
			atelier={atelier}
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

function EditableTextDocument({
	atelier,
	fileId,
	filePath,
	fileRow,
	review,
}: {
	readonly atelier: ExtensionRuntime;
	readonly fileId: string;
	readonly filePath: string | undefined;
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
	// A file the reviewer stepped to is opened for its comparison, so it must
	// never paint as its live self: while the sides load, only a file already
	// on screen is touched — locked, its live text kept — and any other
	// document stays as it is.
	useShownDocument(
		{
			fileId,
			filePath: resolvedPath,
			text: editorText,
			original,
			readOnly: isReadOnly,
			saveError,
		},
		persistUserEdit,
		{ onlyIfShown: review?.status === "loading" },
	);
	return null;
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

/** One revision of the file, read from a commit. */
function HistoricalTextDocument({
	fileId,
	filePath,
	commitId,
}: {
	readonly fileId: string;
	readonly filePath: string | undefined;
	readonly commitId: string | null;
}) {
	const lix = useLix();
	const [snapshotText, setSnapshotText] = useState<string | null>(null);
	const [absentAtCommit, setAbsentAtCommit] = useState(false);
	const [loadError, setLoadError] = useState(false);
	useEffect(() => {
		let cancelled = false;
		// The previous snapshot stays visible while the next commit loads, so
		// retargeting between checkpoints never flashes the loading state.
		setAbsentAtCommit(false);
		setLoadError(false);
		if (!commitId) {
			setSnapshotText("");
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
	}, [commitId, fileId, lix]);

	if (loadError) {
		return (
			<TextMessage role="alert">Could not load this file revision.</TextMessage>
		);
	}
	if (absentAtCommit) {
		return (
			<TextMessage>
				<CheckpointAbsentFile filePath={filePath} commitId={commitId} />
			</TextMessage>
		);
	}
	return (
		<ShownDocument
			document={
				snapshotText === null
					? null
					: {
							fileId,
							filePath: filePath || `/${fileId}.txt`,
							text: snapshotText,
							original: null,
							readOnly: true,
							saveError: null,
						}
			}
		/>
	);
}

/**
 * The frame with no document in it: what the prepared surface shows until
 * the live frame has its document. The same toolbar, in the same place, so
 * the swap moves nothing; the region holds the prepared text, or nothing
 * when a comparison is on its way.
 */
function TextPreparedFrame({ children }: { readonly children?: ReactNode }) {
	return (
		<div
			className="atelier-text-view"
			data-testid="text-editor-prepared"
			aria-busy="true"
		>
			<div className="atelier-text-surface">
				<TextToolbar disabled hidden />
				{children ?? <div className="atelier-text-editor-host" data-empty="" />}
			</div>
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
		// A comparison is on its way: the prepared text is one revision, the
		// wrong picture, so the frame holds the place empty instead.
		const showsDiff = viewShowsDiff({
			session: atelier.diff.session,
			state: view.state,
		});
		return (
			<PreparedFileSurface
				documentKey={file?.id ?? view.instanceId}
				// The frame is up before its document; the surface waits for the
				// document, and keeps a document already shown across a step.
				readySelector=".atelier-text-view[data-document]"
				initial={
					showsDiff ? (
						<TextPreparedFrame />
					) : file ? (
						<TextPreparedFrame>
							<pre className="whitespace-pre-wrap p-4 font-mono text-sm">
								{file.content}
							</pre>
						</TextPreparedFrame>
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
