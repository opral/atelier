import { Editor, type Extensions, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import type { Lix } from "@lix-js/sdk";
import { MarkdownWc, astToTiptapDoc } from "./tiptap-markdown-bridge";
import type { EmptyMarkdownDefaultBlock } from "./tiptap-markdown-bridge";
import { parseMarkdown, serializeAst } from "./markdown";
import {
	cancelPendingImagePaste,
	handleImageDrop as defaultHandleImageDrop,
	handlePaste as defaultHandlePaste,
	type MarkdownImagePasteStatus,
	type StorePastedImage,
} from "./handle-paste";
import { SlashCommandsExtension } from "./extensions/slash-commands";
import { EmojiCommandsExtension } from "./extensions/emoji-commands";
import { TableNavigationExtension } from "./extensions/table-navigation";
import { upsertMarkdownFile } from "./upsert-markdown-file";
import {
	buildNormalizedMarkdownFromEditor,
	normalizePersistedMarkdown,
} from "./build-markdown-from-editor";
import {
	loadMarkdownAsset,
	type MarkdownWorkspaceFileOpener,
} from "./markdown-asset";
import { renderPdfPreview } from "@/extensions/pdf/pdf-preview";
import { storePastedMarkdownImage } from "./store-pasted-image";

type CreateEditorArgs = {
	lix: Lix;
	initialMarkdown?: string;
	contentAst?: any;
	initialContent?: JSONContent;
	additionalExtensions?: Extensions;
	onCreate?: (args: { editor: Editor }) => void;
	onUpdate?: (args: { editor: Editor }) => void | false;
	editorProps?: any;
	editable?: boolean;
	fileId?: string;
	sourceFilePath?: string;
	sourceCommitId?: string;
	defaultBlock?: EmptyMarkdownDefaultBlock;
	persistDebounceMs?: number;
	persistState?: boolean;
	shouldPersist?: () => boolean;
	resolveImageSrc?: (src: string) => string;
	openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	originKey?: string;
	onPersist?: (args: { fileId: string; filePath?: string }) => void;
	onImagePasteStatus?: (status: MarkdownImagePasteStatus) => void;
};

type MarkdownPersistenceBaseline = {
	lastAcknowledgedMarkdown: string;
	expectedFileMarkdown: string;
};

const persistenceBaselines = new WeakMap<Editor, MarkdownPersistenceBaseline>();

/**
 * Advances an editor's compare-and-swap baseline after authoritative file data
 * has been hydrated into that editor without emitting an update transaction.
 */
export function acknowledgeMarkdownEditorPersistence(
	editor: Editor,
	markdown: string,
): void {
	const baseline = persistenceBaselines.get(editor);
	if (!baseline) return;
	baseline.lastAcknowledgedMarkdown = normalizePersistedMarkdown(markdown);
	baseline.expectedFileMarkdown = markdown;
}

export const createMarkdownEditorOriginKey = (): string => {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return `atelier.markdown-editor:${crypto.randomUUID()}`;
	}
	return `atelier.markdown-editor:${Date.now().toString(36)}${Math.random()
		.toString(36)
		.slice(2)}`;
};

function flushEditorViewDomObserver(view: any): void {
	view?.domObserver?.flush?.();
}

function isSelectionNavigationKey(event: KeyboardEvent): boolean {
	return (
		event.key === "ArrowLeft" ||
		event.key === "ArrowRight" ||
		event.key === "ArrowUp" ||
		event.key === "ArrowDown" ||
		event.key === "Home" ||
		event.key === "End" ||
		event.key === "PageUp" ||
		event.key === "PageDown"
	);
}

function externalLinkUrlFromClick(event: MouseEvent): string | null {
	if (event.button !== 0) {
		return null;
	}
	const target =
		event.target instanceof Element ? event.target.closest("a[href]") : null;
	if (!(target instanceof HTMLAnchorElement)) {
		return null;
	}
	const href = target.getAttribute("href")?.trim();
	if (!href) {
		return null;
	}
	const protocolMatch = href.match(/^([a-zA-Z][a-zA-Z\d+.-]*):/);
	const protocol = protocolMatch?.[1]?.toLowerCase();
	if (protocol === "http" || protocol === "https" || protocol === "mailto") {
		return target.href;
	}
	return null;
}

function openExternalLink(url: string): void {
	window.open(url, "_blank", "noopener,noreferrer");
}

function handleExternalLinkClick(event: MouseEvent): void {
	const url = externalLinkUrlFromClick(event);
	if (!url) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
	openExternalLink(url);
}

// Plain TipTap Editor factory (no React). Useful for unit/integration tests.
export function createEditor(args: CreateEditorArgs): Editor {
	const {
		lix,
		initialMarkdown,
		contentAst,
		initialContent,
		additionalExtensions = [],
		onCreate,
		onUpdate,
		editorProps,
		editable = true,
		fileId,
		sourceFilePath,
		sourceCommitId,
		defaultBlock,
		persistDebounceMs,
		persistState = true,
		shouldPersist = () => true,
		resolveImageSrc,
		openWorkspaceFile,
		originKey = createMarkdownEditorOriginKey(),
		onPersist,
		onImagePasteStatus,
	} = args;

	const ast = contentAst ?? (parseMarkdown(initialMarkdown ?? "") as any);

	let persistStateTimer: any = null;
	let persistRunning = false;
	let persistQueued = false;
	let persistPromise: Promise<void> | null = null;
	let destroyed = false;
	let editorInstance: Editor | null = null;
	let currentEditor: Editor | null = null;
	let cleanupExternalLinkClick: (() => void) | null = null;
	const initialFileMarkdown = initialMarkdown ?? serializeAst(ast as any);
	const persistenceBaseline: MarkdownPersistenceBaseline = {
		lastAcknowledgedMarkdown: normalizePersistedMarkdown(initialFileMarkdown),
		expectedFileMarkdown: initialFileMarkdown,
	};
	const persistDebounceMsResolved = persistDebounceMs ?? 0;
	const persistOnce = async (editor: Editor) => {
		if (!shouldPersist()) return;
		// Review projections deliberately contain both sides of a suggestion.
		// They are presentation state, never valid file content. This guard keeps
		// an accidental mode transition or destroy flush from serializing them.
		if (containsMarkdownReviewProjection(editor)) return;
		const markdown = buildNormalizedMarkdownFromEditor(editor);
		if (markdown === persistenceBaseline.lastAcknowledgedMarkdown) return;
		const didPersist = await upsertMarkdownFile({
			lix,
			fileId: fileId!,
			markdown,
			expectedMarkdown: persistenceBaseline.expectedFileMarkdown,
			createIfMissing: false,
			originKey,
		});
		if (!didPersist) return;
		persistenceBaseline.lastAcknowledgedMarkdown = markdown;
		persistenceBaseline.expectedFileMarkdown = markdown;
		onPersist?.({ fileId: fileId!, filePath: sourceFilePath });
	};
	const runPersist = (editor: Editor): Promise<void> => {
		if (!fileId || !persistState || !shouldPersist()) return Promise.resolve();
		if (persistRunning) {
			persistQueued = true;
			return persistPromise ?? Promise.resolve();
		}
		persistRunning = true;
		persistPromise = (async () => {
			try {
				do {
					persistQueued = false;
					await persistOnce(editor);
				} while (persistQueued && !destroyed);
			} finally {
				persistRunning = false;
				persistPromise = null;
			}
		})();
		return persistPromise;
	};

	const placeholderConfig: any = {
		placeholder: ({ node }: { node: any }) => {
			if (node.childCount !== 0) return "";
			if (node.type.name === "heading" && node.attrs?.level === 1) {
				return "Heading 1";
			}
			return node.type.name === "paragraph" ? "Press ‘/’ for commands" : "";
		},
		showOnlyWhenEditable: true,
		showOnlyCurrent: true,
		includeChildren: false,
		shouldShow: ({ editor, node }: { editor: Editor; node: any }) =>
			editor.isFocused &&
			(node.type.name === "paragraph" ||
				(node.type.name === "heading" && node.attrs?.level === 1)) &&
			node.childCount === 0,
	};

	const markdownExtensions = MarkdownWc({
		resolveImageSrc,
		loadAsset: sourceFilePath
			? (src) => loadMarkdownAsset({ lix, sourceFilePath, sourceCommitId, src })
			: undefined,
		openWorkspaceFile,
		renderPdfPreview,
	}) as any[];
	const storeWorkspaceImage: StorePastedImage | undefined = sourceFilePath
		? ({ file, mimeType }) =>
				storePastedMarkdownImage({
					lix,
					sourceFilePath,
					file,
					mimeType,
					originKey,
				})
		: undefined;

	editorInstance = new Editor({
		extensions: [
			...markdownExtensions,
			...additionalExtensions,
			History.configure({
				depth: 200,
				newGroupDelay: 500,
			}),
			Placeholder.configure(placeholderConfig),
			SlashCommandsExtension.configure({
				onStateChange: () => {},
			}),
			EmojiCommandsExtension.configure({
				onStateChange: () => {},
			}),
			TableNavigationExtension,
		],
		editable,
		content:
			initialContent ?? (astToTiptapDoc(ast, { defaultBlock }) as JSONContent),
		onCreate: ({ editor }) => {
			currentEditor = editor as Editor;
			persistenceBaseline.lastAcknowledgedMarkdown =
				buildNormalizedMarkdownFromEditor(editor);
			persistenceBaselines.set(editor, persistenceBaseline);
			onCreate?.({ editor });
		},
		onUpdate: ({ editor }) => {
			if (destroyed) return;
			if (onUpdate?.({ editor }) === false) return;
			if (!fileId || !persistState) return;
			const scheduleRun = () => {
				if (destroyed) return;
				if (persistDebounceMsResolved <= 0) {
					void runPersist(editor);
					return;
				}
				if (persistStateTimer) clearTimeout(persistStateTimer);
				persistStateTimer = setTimeout(() => {
					persistStateTimer = null;
					if (destroyed || !shouldPersist()) return;
					void runPersist(editor);
				}, persistDebounceMsResolved);
			};
			scheduleRun();
		},
		onDestroy: () => {
			cleanupExternalLinkClick?.();
			cleanupExternalLinkClick = null;
			persistQueued = false;
			if (persistStateTimer) {
				clearTimeout(persistStateTimer);
				persistStateTimer = null;
			}
			const editorToPersist = currentEditor ?? editorInstance;
			if (editorToPersist && fileId && persistState && shouldPersist()) {
				if (persistRunning) {
					persistQueued = true;
				}
				void runPersist(editorToPersist).finally(() => {
					destroyed = true;
					currentEditor = null;
				});
			} else {
				destroyed = true;
				currentEditor = null;
			}
		},
		editorProps: {
			handlePaste: (_view: any, event: ClipboardEvent) => {
				if (!currentEditor) return false;
				return defaultHandlePaste({
					editor: currentEditor as any,
					event,
					storeImage: storeWorkspaceImage,
					onImagePasteStatus,
				});
			},
			...editorProps,
			handleDOMEvents: {
				...(editorProps?.handleDOMEvents ?? {}),
				keydown: (view: any, event: KeyboardEvent) => {
					if (
						currentEditor &&
						isUndoKeyboardEvent(event) &&
						cancelPendingImagePaste(currentEditor)
					) {
						event.preventDefault();
						return true;
					}
					const handleKeyDown = editorProps?.handleDOMEvents?.keydown;
					return typeof handleKeyDown === "function"
						? handleKeyDown(view, event)
						: false;
				},
				beforeinput: (view: any, event: InputEvent) => {
					if (
						currentEditor &&
						event.inputType === "historyUndo" &&
						cancelPendingImagePaste(currentEditor)
					) {
						event.preventDefault();
						return true;
					}
					const handleBeforeInput = editorProps?.handleDOMEvents?.beforeinput;
					return typeof handleBeforeInput === "function"
						? handleBeforeInput(view, event)
						: false;
				},
				keyup: (view: any, event: KeyboardEvent) => {
					if (isSelectionNavigationKey(event)) {
						flushEditorViewDomObserver(view);
					}
					const handleKeyUp = editorProps?.handleDOMEvents?.keyup;
					return typeof handleKeyUp === "function"
						? handleKeyUp(view, event)
						: false;
				},
				drop: (view: any, event: DragEvent) => {
					// ProseMirror's text/HTML drop parser deliberately leaves an empty
					// external file slice unclaimed. Handle files at the DOM boundary so
					// Chrome cannot navigate away to the dropped file URL.
					const handleDrop = editorProps?.handleDOMEvents?.drop;
					const consumerHandled =
						typeof handleDrop === "function" ? handleDrop(view, event) : false;
					if (consumerHandled || event.defaultPrevented) return true;
					if (!currentEditor) return false;
					return defaultHandleImageDrop({
						editor: currentEditor as any,
						view,
						event,
						storeImage: storeWorkspaceImage,
						onImagePasteStatus,
					});
				},
			},
		},
	});
	persistenceBaselines.set(editorInstance, persistenceBaseline);
	const editorDom = editorInstance.view.dom;
	editorDom.addEventListener("click", handleExternalLinkClick, {
		capture: true,
	});
	cleanupExternalLinkClick = () => {
		editorDom.removeEventListener("click", handleExternalLinkClick, {
			capture: true,
		});
	};
	currentEditor = editorInstance;
	return editorInstance;
}

function isUndoKeyboardEvent(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "z" &&
		(event.metaKey || event.ctrlKey) &&
		!event.shiftKey &&
		!event.altKey
	);
}

function containsMarkdownReviewProjection(editor: Editor): boolean {
	let found = false;
	editor.state.doc.descendants((node) => {
		if (found) return false;
		if (node.marks.some((mark) => mark.type.name === "markdownReviewDiff")) {
			found = true;
			return false;
		}
		const data = node.attrs?.data;
		if (
			data &&
			typeof data === "object" &&
			"markdownReview" in (data as Record<string, unknown>)
		) {
			found = true;
			return false;
		}
		return true;
	});
	return found;
}

// React useEditor config builder. TipTapEditor should use this to keep a single source.
