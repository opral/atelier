import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { Check, RotateCcw } from "lucide-react";
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
	const completionSucceeded = useRef(false);
	const reviewDocumentRef = useRef(reviewDocument.doc);
	const openWorkspaceFileRef = useRef(openWorkspaceFile);
	const canOpenWorkspaceFile = openWorkspaceFile !== undefined;
	const stableOpenWorkspaceFile = useMemo<
		MarkdownWorkspaceFileOpener | undefined
	>(() => {
		if (!canOpenWorkspaceFile) return undefined;
		return (args) => openWorkspaceFileRef.current?.(args);
	}, [canOpenWorkspaceFile]);
	useLayoutEffect(() => {
		reviewDocumentRef.current = reviewDocument.doc;
		openWorkspaceFileRef.current = openWorkspaceFile;
	}, [openWorkspaceFile, reviewDocument.doc]);

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
			initialContent: reviewDocumentRef.current,
			additionalExtensions: MarkdownReviewExtensions,
			sourceFilePath,
			sourceCommitId: afterCommitId,
			openWorkspaceFile: stableOpenWorkspaceFile,
			editable: false,
			persistState: false,
		});
		setOwnedEditor(nextEditor);
		return () => nextEditor.destroy();
	}, [
		afterCommitId,
		externalEditor,
		lix,
		sourceFilePath,
		stableOpenWorkspaceFile,
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
		if (!editor || editor.isDestroyed) return;
		setReviewEditorDocument(editor, displayDocument);
	}, [displayDocument, editor]);

	const [activeChangeElement, setActiveChangeElement] =
		useState<HTMLElement | null>(null);
	useEffect(() => {
		if (!editor || editor.isDestroyed) return;
		const changedElements = Array.from(
			editor.view.dom.querySelectorAll<HTMLElement>("[data-review-change-id]"),
		);
		let firstActive: HTMLElement | undefined;
		for (const element of changedElements) {
			const active =
				reviewEnabled &&
				activeChangeId !== null &&
				element.dataset.reviewChangeId === activeChangeId;
			if (active) {
				element.dataset.reviewActive = "true";
				firstActive ??= element;
			} else {
				delete element.dataset.reviewActive;
			}
		}
		setActiveChangeElement(firstActive ?? null);
		firstActive?.scrollIntoView?.({ block: "center", behavior: "smooth" });
	}, [activeChangeId, displayDocument, editor, reviewEnabled]);

	useEffect(() => {
		if (!editor || editor.isDestroyed || !reviewEnabled) return;
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
		async (decision: MarkdownReviewDecision) => {
			if (!activeChange || busy || !editor) return;
			const nextDecisions = new Map(decisions);
			nextDecisions.set(activeChange.id, decision);
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
			reviewDocument,
		],
	);

	useEffect(() => {
		if (!reviewEnabled || !isActive) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (
				event.altKey ||
				event.isComposing ||
				event.repeat ||
				isReviewShortcutBlockedTarget(event.target)
			) {
				return;
			}
			const usesPrimaryModifier = isMacPlatform()
				? event.metaKey && !event.ctrlKey
				: event.ctrlKey && !event.metaKey;
			const hasCommandModifier = event.metaKey || event.ctrlKey;
			// Plain ⌘⏎ belongs to the diff-mode float (Keep all, workspace-wide).
			// ⇧⌘⏎ keeps just the active change.
			if (usesPrimaryModifier && event.key === "Enter" && event.shiftKey) {
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				void decide("keep");
				return;
			}
			if (event.shiftKey) return;
			if (
				!hasCommandModifier &&
				(event.key === "Backspace" || event.key === "Delete")
			) {
				event.preventDefault();
				event.stopPropagation();
				void decide("undo");
				return;
			}
			if (hasCommandModifier) return;
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
	}, [decide, isActive, navigate, pendingChanges.length, reviewEnabled]);

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
			{reviewEnabled && activeChange && activeChangeElement ? (
				<InlineChangeReviewChip
					anchor={activeChangeElement}
					activeOrdinal={activeOrdinal}
					total={reviewDocument.changes.length}
					busy={busy}
					error={error}
					onUndo={() => void decide("undo")}
					onKeep={() => void decide("keep")}
				/>
			) : null}
		</>
	);
}

function setReviewEditorDocument(
	editor: Editor,
	document: Parameters<Editor["schema"]["nodeFromJSON"]>[0],
): void {
	// Resource effects can replace an owned editor in the same React commit in
	// which document effects still hold the previous render's reference. TipTap
	// deliberately nulls its schema and view when an editor is destroyed, so a
	// stale reference is not a usable editor and must never be mutated.
	if (editor.isDestroyed) return;
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

/**
 * S2 inline decision chip: change-level verbs live on the change itself,
 * where their scope is literally visible. Anchored above the active change,
 * repositioned on scroll/resize, hidden while the anchor is off-screen.
 */
function InlineChangeReviewChip({
	anchor,
	activeOrdinal,
	total,
	busy,
	error,
	onUndo,
	onKeep,
}: {
	readonly anchor: HTMLElement;
	readonly activeOrdinal: number;
	readonly total: number;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onUndo: () => void;
	readonly onKeep: () => void;
}) {
	const [placement, setPlacement] = useState<{
		readonly top: number;
		readonly right: number;
	} | null>(null);

	useLayoutEffect(() => {
		let frame = 0;
		const update = () => {
			const rect = anchor.getBoundingClientRect();
			// Hide only when clearly scrolled out of view. jsdom reports all-zero
			// rects, which must still count as visible.
			const offScreen = rect.bottom < 0 || rect.top > window.innerHeight;
			setPlacement(
				offScreen
					? null
					: {
							top: Math.max(rect.top - 30, 4),
							right: Math.max(window.innerWidth - rect.right, 4),
						},
			);
		};
		const scheduleUpdate = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(update);
		};
		update();
		window.addEventListener("scroll", scheduleUpdate, {
			capture: true,
			passive: true,
		});
		window.addEventListener("resize", scheduleUpdate);
		const observer = new ResizeObserver(scheduleUpdate);
		observer.observe(anchor);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener("scroll", scheduleUpdate, { capture: true });
			window.removeEventListener("resize", scheduleUpdate);
			observer.disconnect();
		};
	}, [anchor]);

	if (!placement) return null;
	const individualShortcut = isMacPlatform()
		? "Meta+Shift+Enter"
		: "Control+Shift+Enter";
	return createPortal(
		<div
			className="markdown-inline-review-chip"
			style={{ top: placement.top, right: placement.right }}
			role="group"
			aria-label={`Review change ${activeOrdinal} of ${total}`}
		>
			{error ? (
				<span className="markdown-inline-review-chip-error" role="alert">
					{error}
				</span>
			) : null}
			<button
				type="button"
				aria-label="Undo change"
				data-attr="review-change-undo"
				disabled={busy}
				onClick={onUndo}
			>
				<RotateCcw aria-hidden />
				Undo
			</button>
			<span className="markdown-inline-review-chip-divider" />
			<button
				type="button"
				aria-label="Keep change"
				aria-keyshortcuts={individualShortcut}
				data-attr="review-change-keep"
				className="markdown-inline-review-chip-keep"
				disabled={busy}
				onClick={onKeep}
			>
				<Check aria-hidden />
				{busy ? "Saving…" : "Keep"}
			</button>
		</div>,
		document.body,
	);
}

function isReviewShortcutBlockedTarget(target: EventTarget | null): boolean {
	if (!(target instanceof Element)) return false;
	return Boolean(
		target.closest(
			'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"]',
		),
	);
}

function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return true;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
