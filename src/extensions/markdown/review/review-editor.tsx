import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import {
	Check,
	CheckCheck,
	ChevronLeft,
	ChevronRight,
	CornerDownLeft,
	FileText,
	RotateCcw,
} from "lucide-react";
import { useLix } from "@/lib/lix-react";
import { createEditor } from "../editor/create-editor";
import type { MarkdownWorkspaceFileOpener } from "../editor/markdown-asset";
import type { MarkdownReviewDiff } from "../review-diff";
import {
	buildMarkdownReviewDocument,
	materializeMarkdownReviewDecisions,
	resolveMarkdownReviewDocumentChanges,
	type MarkdownReviewDecision,
} from "./build-review-document";
import { MarkdownReviewExtensions } from "./review-extension";

export function MarkdownReviewEditor({
	reviewDiff,
	sourceFilePath,
	afterCommitId,
	openWorkspaceFile,
	reviewEnabled = false,
	isActive = false,
	onComplete,
	externalEditor,
	onCompletionStart,
	onCompletionSuccess,
	onCompletionFailure,
}: {
	readonly reviewDiff: MarkdownReviewDiff;
	readonly sourceFilePath: string;
	readonly afterCommitId?: string;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	readonly reviewEnabled?: boolean;
	readonly isActive?: boolean;
	readonly onComplete?: (markdown: string) => Promise<void>;
	/**
	 * Reuses the live Markdown editor for an active review. When omitted (for
	 * historical diffs), this component owns a read-only presentation editor.
	 */
	readonly externalEditor?: Editor | null;
	readonly onCompletionStart?: (markdown: string) => void;
	readonly onCompletionSuccess?: (markdown: string) => void;
	readonly onCompletionFailure?: () => void;
}) {
	const lix = useLix();
	const { beforeMarkdown, afterMarkdown, beforeBlocks, afterBlocks } =
		reviewDiff;
	const incomingReviewDocument = useMemo(
		() =>
			buildMarkdownReviewDocument({
				beforeMarkdown,
				afterMarkdown,
				beforeBlocks,
				afterBlocks,
			}),
		[afterBlocks, afterMarkdown, beforeBlocks, beforeMarkdown],
	);
	const [reviewDocument, setReviewDocument] = useState(() =>
		buildMarkdownReviewDocument(reviewDiff),
	);
	const [decisions, setDecisions] = useState<
		ReadonlyMap<string, MarkdownReviewDecision>
	>(() => new Map());
	const [activeChangeId, setActiveChangeId] = useState<string | null>(
		() => reviewDocument.changes[0]?.id ?? null,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const displayDocument = useMemo(
		() => resolveMarkdownReviewDocumentChanges(reviewDocument.doc, decisions),
		[decisions, reviewDocument.doc],
	);
	const pendingChanges = useMemo(
		() => reviewDocument.changes.filter((change) => !decisions.has(change.id)),
		[decisions, reviewDocument.changes],
	);
	const activeChange =
		reviewDocument.changes.find((change) => change.id === activeChangeId) ??
		pendingChanges[0] ??
		null;
	const activeOrdinal = activeChange
		? reviewDocument.changes.findIndex(
				(change) => change.id === activeChange.id,
			) + 1
		: 0;
	const [ownedEditor, setOwnedEditor] = useState<Editor | null>(null);
	const editor = externalEditor ?? ownedEditor;
	const fileName = workspaceFileName(sourceFilePath);
	const completionSucceeded = useRef(false);

	useEffect(() => {
		if (
			!externalEditor ||
			busy ||
			decisions.size > 0 ||
			reviewDocument.usedSemanticBlockIds ||
			!incomingReviewDocument.usedSemanticBlockIds
		) {
			return;
		}
		setReviewDocument(incomingReviewDocument);
		setActiveChangeId(incomingReviewDocument.changes[0]?.id ?? null);
		setError(null);
	}, [
		busy,
		decisions.size,
		externalEditor,
		incomingReviewDocument,
		reviewDocument,
	]);

	useLayoutEffect(() => {
		if (externalEditor) return;
		const nextEditor = createEditor({
			lix,
			initialContent: reviewDocument.doc,
			additionalExtensions: MarkdownReviewExtensions,
			sourceFilePath,
			sourceCommitId: afterCommitId,
			openWorkspaceFile,
			editable: false,
			persistState: false,
		});
		setOwnedEditor(nextEditor);
		return () => nextEditor.destroy();
	}, [
		afterCommitId,
		externalEditor,
		lix,
		openWorkspaceFile,
		reviewDocument.doc,
		sourceFilePath,
	]);

	useLayoutEffect(() => {
		if (!externalEditor) return;
		const authoritativeDocument = externalEditor.getJSON();
		return () => {
			if (completionSucceeded.current || externalEditor.isDestroyed) return;
			setReviewEditorDocument(externalEditor, authoritativeDocument);
		};
	}, [externalEditor]);

	useLayoutEffect(() => {
		if (!editor) return;
		setReviewEditorDocument(editor, displayDocument);
	}, [displayDocument, editor]);

	useEffect(() => {
		if (!editor) return;
		const changedElements = Array.from(
			editor.view.dom.querySelectorAll<HTMLElement>("[data-review-change-id]"),
		);
		let firstActive: HTMLElement | undefined;
		for (const element of changedElements) {
			const active =
				activeChangeId !== null &&
				element.dataset.reviewChangeId === activeChangeId;
			if (active) {
				element.dataset.reviewActive = "true";
				firstActive ??= element;
			} else {
				delete element.dataset.reviewActive;
			}
		}
		firstActive?.scrollIntoView?.({ block: "center", behavior: "smooth" });
	}, [activeChangeId, editor]);

	useEffect(() => {
		if (!editor || !reviewEnabled) return;
		const handleReviewClick = (event: MouseEvent) => {
			if (!(event.target instanceof Element)) return;
			const changed = event.target.closest<HTMLElement>(
				"[data-review-change-id]",
			);
			const changeId = changed?.dataset.reviewChangeId;
			if (!changeId || decisions.has(changeId)) return;
			setActiveChangeId(changeId);
			setError(null);
		};
		const editorElement = editor.view.dom;
		editorElement.addEventListener("click", handleReviewClick);
		return () => editorElement.removeEventListener("click", handleReviewClick);
	}, [decisions, editor, reviewEnabled]);

	const navigate = useCallback(
		(direction: -1 | 1) => {
			if (pendingChanges.length < 2 || busy) return;
			const currentIndex = pendingChanges.findIndex(
				(change) => change.id === activeChange?.id,
			);
			const nextIndex =
				(currentIndex + direction + pendingChanges.length) %
				pendingChanges.length;
			setActiveChangeId(pendingChanges[nextIndex]!.id);
			setError(null);
		},
		[activeChange?.id, busy, pendingChanges],
	);

	const decide = useCallback(
		async (decision: MarkdownReviewDecision, allPendingChanges = false) => {
			if (!activeChange || busy || !editor) return;
			const nextDecisions = new Map(decisions);
			const changesToDecide = allPendingChanges
				? pendingChanges
				: [activeChange];
			for (const change of changesToDecide) {
				nextDecisions.set(change.id, decision);
			}
			const remaining = reviewDocument.changes.filter(
				(change) => !nextDecisions.has(change.id),
			);

			if (remaining.length > 0) {
				setDecisions(nextDecisions);
				const currentIndex = reviewDocument.changes.findIndex(
					(change) => change.id === activeChange.id,
				);
				const next =
					reviewDocument.changes
						.slice(currentIndex + 1)
						.find((change) => !nextDecisions.has(change.id)) ?? remaining[0]!;
				setActiveChangeId(next.id);
				setError(null);
				return;
			}

			// Collapse the final suggestion in the existing editor immediately. The
			// authoritative raw Markdown resolver runs afterward; on failure this
			// optimistic projection is restored to the unresolved review document.
			setReviewEditorDocument(
				editor,
				resolveMarkdownReviewDocumentChanges(reviewDocument.doc, nextDecisions),
			);
			setDecisions(nextDecisions);
			setBusy(true);
			setError(null);
			const markdown = materializeMarkdownReviewDecisions(
				reviewDocument,
				nextDecisions,
			);
			onCompletionStart?.(markdown);
			try {
				// The resolver can remove the reviewed file and unmount this editor.
				// Mark completion before awaiting it so unmount cleanup does not restore
				// the synthetic review document into a disappearing live editor.
				completionSucceeded.current = true;
				await onComplete?.(markdown);
				onCompletionSuccess?.(markdown);
			} catch (cause) {
				completionSucceeded.current = false;
				onCompletionFailure?.();
				setDecisions(decisions);
				if (!editor.isDestroyed) {
					setReviewEditorDocument(
						editor,
						resolveMarkdownReviewDocumentChanges(reviewDocument.doc, decisions),
					);
				}
				setError(
					cause instanceof Error
						? cause.message
						: "Could not resolve this review.",
				);
			} finally {
				setBusy(false);
			}
		},
		[
			activeChange,
			busy,
			decisions,
			editor,
			onComplete,
			onCompletionFailure,
			onCompletionStart,
			onCompletionSuccess,
			pendingChanges,
			reviewDocument,
		],
	);

	useEffect(() => {
		if (!reviewEnabled || !isActive) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.altKey || event.shiftKey) return;
			const usesPrimaryModifier =
				event.metaKey || (event.ctrlKey && !event.metaKey);
			if (usesPrimaryModifier && event.key === "Enter") {
				event.preventDefault();
				event.stopPropagation();
				void decide("keep");
				return;
			}
			if (
				!usesPrimaryModifier &&
				(event.key === "Backspace" || event.key === "Delete")
			) {
				event.preventDefault();
				event.stopPropagation();
				void decide("undo");
				return;
			}
			if (usesPrimaryModifier) return;
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				navigate(-1);
			} else if (event.key === "ArrowRight") {
				event.preventDefault();
				navigate(1);
			}
		};
		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () =>
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [decide, isActive, navigate, reviewEnabled]);

	return (
		<>
			{externalEditor ? null : (
				<div className="ph-mask tiptap-container h-full w-full overflow-y-auto bg-background">
					<EditorContent
						editor={editor}
						className="tiptap mx-auto w-full"
						data-testid="markdown-review-editor"
						data-review-change-count={reviewDocument.changes.length}
						data-review-resolved-count={decisions.size}
					/>
				</div>
			)}
			{reviewEnabled && activeChange ? (
				<MarkdownChangeReviewControls
					fileName={fileName}
					activeOrdinal={activeOrdinal}
					total={reviewDocument.changes.length}
					canNavigate={pendingChanges.length > 1}
					busy={busy}
					error={error}
					onPrevious={() => navigate(-1)}
					onNext={() => navigate(1)}
					onUndo={() => void decide("undo")}
					onKeepAll={() => void decide("keep", true)}
					onKeep={() => void decide("keep")}
					showKeepAll={pendingChanges.length > 1}
				/>
			) : null}
		</>
	);
}

function setReviewEditorDocument(
	editor: Editor,
	document: Parameters<Editor["schema"]["nodeFromJSON"]>[0],
): void {
	const nextDocument = editor.schema.nodeFromJSON(document);
	if (editor.state.doc.eq(nextDocument)) return;
	editor
		.chain()
		.setMeta("addToHistory", false)
		.setContent(nextDocument, {
			emitUpdate: false,
			errorOnInvalidContent: true,
		})
		.run();
}

function MarkdownChangeReviewControls({
	fileName,
	activeOrdinal,
	total,
	canNavigate,
	busy,
	error,
	onPrevious,
	onNext,
	onUndo,
	onKeepAll,
	onKeep,
	showKeepAll,
}: {
	readonly fileName: string;
	readonly activeOrdinal: number;
	readonly total: number;
	readonly canNavigate: boolean;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onPrevious: () => void;
	readonly onNext: () => void;
	readonly onUndo: () => void;
	readonly onKeepAll: () => void;
	readonly onKeep: () => void;
	readonly showKeepAll: boolean;
}) {
	return (
		<div className="markdown-change-review-wrap">
			{error ? (
				<div className="markdown-change-review-error" role="alert">
					{error}
				</div>
			) : null}
			<div
				className="markdown-change-review-actions"
				role="group"
				aria-label={`Review change ${activeOrdinal} of ${total}`}
			>
				<div className="markdown-change-review-nav">
					<button
						type="button"
						className="markdown-change-review-icon-button"
						aria-label="Previous change"
						disabled={!canNavigate || busy}
						onClick={onPrevious}
					>
						<ChevronLeft aria-hidden />
					</button>
					<span className="markdown-change-review-file">
						<FileText aria-hidden />
						<strong>{fileName}</strong>
					</span>
					<span className="markdown-change-review-count">
						{activeOrdinal} of {total}
					</span>
					<button
						type="button"
						className="markdown-change-review-icon-button"
						aria-label="Next change"
						disabled={!canNavigate || busy}
						onClick={onNext}
					>
						<ChevronRight aria-hidden />
					</button>
				</div>
				<div className="markdown-change-review-divider" />
				<button
					type="button"
					className="markdown-change-review-button markdown-change-review-button-undo"
					aria-label="Undo change"
					data-attr="review-change-undo"
					disabled={busy}
					onClick={onUndo}
				>
					<RotateCcw aria-hidden />
					Undo
					<kbd className="markdown-change-review-keycap">⌫</kbd>
				</button>
				{showKeepAll ? (
					<button
						type="button"
						className="markdown-change-review-button markdown-change-review-button-keep-all"
						aria-label="Keep all remaining changes"
						data-attr="review-change-keep-all"
						disabled={busy}
						onClick={onKeepAll}
					>
						<CheckCheck aria-hidden />
						Keep all
					</button>
				) : null}
				<button
					type="button"
					className="markdown-change-review-button markdown-change-review-button-keep"
					aria-label="Keep change"
					data-attr="review-change-keep"
					disabled={busy}
					onClick={onKeep}
				>
					<Check aria-hidden />
					{busy ? "Saving…" : "Keep"}
					<kbd className="markdown-change-review-keycap markdown-change-review-keycap-keep">
						<span>{isMacPlatform() ? "⌘" : "Ctrl"}</span>
						<CornerDownLeft aria-hidden />
					</kbd>
				</button>
			</div>
		</div>
	);
}

function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return true;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function workspaceFileName(path: string): string {
	const segments = path.split("/").filter(Boolean);
	return segments.at(-1) ?? path;
}
