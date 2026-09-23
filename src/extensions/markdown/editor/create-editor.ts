import { deleteSelectedTableText } from "./extensions/table-selection";
import { closeHistory } from "@tiptap/pm/history";
import { Editor, type Extensions, type JSONContent } from "@tiptap/core";
import History from "@tiptap/extension-history";
import Placeholder from "@tiptap/extension-placeholder";
import {
	DOMSerializer,
	type Fragment,
	type Node as ProseMirrorNode,
	type Slice,
} from "@tiptap/pm/model";
import type { CommitSpan, Lix } from "@lix-js/sdk";
import { MarkdownWc, astToTiptapDoc } from "./tiptap-markdown-bridge";
import { assignMissingDataIds } from "./tiptap-markdown-bridge/assign-data-id";
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
import { EmbedFileCommandsExtension } from "./extensions/embed-file-commands";
import { MentionCommandsExtension } from "./extensions/mention-commands";
import { TableNavigationExtension } from "./extensions/table-navigation";
import { TableControlsExtension } from "./extensions/table-controls";
import { FocusedControlGuardExtension } from "./extensions/focused-control-guard";
import { ClickBelowDocumentExtension } from "./extensions/click-below-document";
import { SelectionBlockHighlightExtension } from "./extensions/selection-block-highlight";
import { CodeLanguageMenuExtension } from "./extensions/code-language-menu";
import { JoinAdjacentListsExtension } from "./extensions/join-adjacent-lists";
import { DocumentLinkIconsExtension } from "./extensions/document-link-icons";
import type { AtelierDocumentLinks } from "@/extension-api";
import { createDocumentExistence } from "./document-existence";
import {
	buildNormalizedMarkdownIncrementally,
	createIncrementalMarkdownSource,
	type IncrementalMarkdownSource,
} from "./incremental-markdown-save";
import {
	upsertMarkdownFile,
	upsertMarkdownFileWith,
	type MarkdownFileWriteParticipant,
} from "./upsert-markdown-file";
import {
	normalizePersistedMarkdown,
	serializeTiptapDocToMarkdown,
} from "./build-markdown-from-editor";
import {
	loadMarkdownAsset,
	type MarkdownWorkspaceFileOpener,
} from "./markdown-asset";
import { renderPdfPreview } from "@/extensions/pdf/pdf-preview";
import { OWN_CLIPBOARD_ATTRIBUTE } from "./clipboard-html";
import { storePastedMarkdownImage } from "./store-pasted-image";
import { bindDocumentLinks } from "./document-links";

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
	/** Save coalescing window from the first edit; later edits do not reset it. Defaults to 20ms. */
	persistDebounceMs?: number;
	persistState?: boolean;
	shouldPersist?: () => boolean;
	resolveImageSrc?: (src: string) => string;
	openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	/** The host's file URLs; absolute links to them behave like relative ones. */
	documentLinks?: AtelierDocumentLinks;
	originKey?: string;
	onPersist?: (args: {
		fileId: string;
		filePath?: string;
		/** The transition this save produced, for surfaces tracking their own writes. */
		commit?: CommitSpan | null;
	}) => void;
	onPersistenceError?: (error: Error | null) => void;
	onImagePasteStatus?: (status: MarkdownImagePasteStatus) => void;
};

type MarkdownPersistenceBaseline = {
	lastAcknowledgedMarkdown: string;
	expectedFileMarkdown: string;
	documentRevision: number;
	acknowledgedRevision: number;
	observationGeneration: number;
	/** Keeps `expectedFileMarkdown`'s spelling without re-reading it per save. */
	source: IncrementalMarkdownSource;
};

const persistenceBaselines = new WeakMap<Editor, MarkdownPersistenceBaseline>();

/**
 * Something that keeps rows of its own on this file's rows (a block's
 * conversation on its `markdown_node`) and must move them in the same
 * transaction as the save that re-derives those rows. Asked per save with
 * the document being saved; null means this save needs nothing from it.
 */
export type MarkdownSaveParticipant = {
	readonly prepare: (
		doc: ProseMirrorNode,
	) => MarkdownFileWriteParticipant | null;
};

const saveParticipants = new WeakMap<Editor, MarkdownSaveParticipant>();

/** Joins the editor's saves; returns the function that leaves them. */
export function joinMarkdownEditorSaves(
	editor: Editor,
	participant: MarkdownSaveParticipant,
): () => void {
	saveParticipants.set(editor, participant);
	return () => {
		if (saveParticipants.get(editor) === participant)
			saveParticipants.delete(editor);
	};
}

/**
 * Advances an editor's persistence baseline after authoritative file data
 * has been hydrated into that editor without emitting an update transaction.
 */
export function acknowledgeMarkdownEditorPersistence(
	editor: Editor,
	markdown: string,
): void {
	const baseline = persistenceBaselines.get(editor);
	if (!baseline) return;
	baseline.observationGeneration += 1;
	baseline.lastAcknowledgedMarkdown = buildNormalizedMarkdownIncrementally(
		editor.state.doc,
	);
	baseline.expectedFileMarkdown = markdown;
	baseline.acknowledgedRevision = baseline.documentRevision;
	baseline.source.prime(markdown, editor.state.doc);
}

/**
 * Returns the latest Markdown durably accepted by the local file write.
 * External delivery uses this as its clean baseline so it does not have to
 * wait for a second observer round trip to rediscover a successful local save.
 */
export function markdownEditorLastAcknowledgedMarkdown(
	editor: Editor,
): string | undefined {
	return persistenceBaselines.get(editor)?.lastAcknowledgedMarkdown;
}

/** Exact source baseline, including untouched noncanonical formatting. */
export function markdownEditorExpectedFileMarkdown(
	editor: Editor,
): string | undefined {
	return persistenceBaselines.get(editor)?.expectedFileMarkdown;
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

/**
 * Browser clipboard text drops document structure (including task state),
 * while Markdown is both portable to other editors and understood by our
 * paste handler. Serialize the selected ProseMirror slice through the same
 * Markdown bridge used for persisted documents.
 */
function markdownClipboardText(slice: Slice): string {
	let node = slice.content.childCount === 1 ? slice.content.firstChild : null;
	let depth = 1;
	while (
		node &&
		!node.inlineContent &&
		node.childCount === 1 &&
		depth < slice.openStart
	) {
		node = node.firstChild;
		depth += 1;
	}
	if (
		node?.inlineContent &&
		slice.openStart >= depth &&
		slice.openEnd >= depth
	) {
		// An open text-block slice represents selected inline content, not its
		// surrounding heading/list/code container. Keep code literal and retain
		// whitespace needed when a fragment is pasted back into a sentence.
		const text = node.textContent;
		let onlyText = true;
		node.forEach((child) => {
			if (!child.isText) onlyText = false;
		});
		if (node.type.spec.code || (onlyText && !text.trim())) return text;
		let markdown = serializeTiptapDocToMarkdown({
			type: "doc",
			content: [{ type: "paragraph", content: node.content.toJSON() }],
		}).replace(/\n$/, "");
		const leading = node.firstChild?.isText
			? (node.firstChild.text?.match(/^[ \t]+/)?.[0] ?? "")
			: "";
		const trailing = node.lastChild?.isText
			? (node.lastChild.text?.match(/[ \t]+$/)?.[0] ?? "")
			: "";
		if (leading && !markdown.startsWith(leading)) markdown = leading + markdown;
		if (trailing && !markdown.endsWith(trailing)) markdown += trailing;
		return markdown;
	}
	let markdown = serializeTiptapDocToMarkdown({
		type: "doc",
		content:
			slice.openStart > 0
				? liftOpenNestedItems(slice.content.toJSON())
				: slice.content.toJSON(),
	});
	// Blocks cut from the middle of a paragraph keep the spaces at the cut,
	// so pasting them back rejoins "Body| text" instead of "Bodytext". The
	// paste handler restores them onto the open edge blocks.
	const first = openTextblock(slice.content, slice.openStart, "start");
	const last = openTextblock(slice.content, slice.openEnd, "end");
	const leading = first?.firstChild?.isText
		? (first.firstChild.text?.match(/^[ \t]+/)?.[0] ?? "")
		: "";
	const trailing = last?.lastChild?.isText
		? (last.lastChild.text?.match(/[ \t]+$/)?.[0] ?? "")
		: "";
	if (leading) markdown = leading + markdown;
	if (trailing) markdown = markdown.replace(/\n$/, "") + trailing;
	return markdown;
}

/**
 * A selection that starts inside a nested list item opens its parent item
 * without that item's own text, which would serialize as "- - child".
 * Lift the nested items into the outer list instead.
 */
function liftOpenNestedItems(content: JSONContent[]): JSONContent[] {
	const [list, ...rest] = content;
	const [item, ...items] = list?.content ?? [];
	const nested = item?.content?.length === 1 ? item.content[0] : null;
	if (
		!list ||
		!/^(bulletList|orderedList)$/.test(list.type ?? "") ||
		item?.type !== "listItem" ||
		!nested ||
		!/^(bulletList|orderedList)$/.test(nested.type ?? "")
	)
		return content;
	const [lifted] = liftOpenNestedItems([nested]);
	return [
		{ ...list, content: [...(lifted?.content ?? []), ...items] },
		...rest,
	];
}

/**
 * The schema's own HTML for a copy, with every top-level element marked as
 * ours. Only then is the Markdown in text/plain the source of a paste; other
 * ProseMirror editors also write data-pm-slice, and their plain text is not
 * Markdown, so their HTML is converted instead.
 */
const markdownClipboardSerializer = {
	serializeFragment(
		fragment: Fragment,
		options: { document?: Document } = {},
		target?: HTMLElement | DocumentFragment,
	) {
		const schema = fragment.firstChild?.type.schema;
		const dom = schema
			? DOMSerializer.fromSchema(schema).serializeFragment(
					fragment,
					options,
					target,
				)
			: (target ?? (options.document ?? document).createDocumentFragment());
		for (const child of Array.from(dom.childNodes))
			if (child.nodeType === 1)
				(child as Element).setAttribute(OWN_CLIPBOARD_ATTRIBUTE, "");
		return dom;
	},
} as unknown as DOMSerializer;

/** The textblock an open slice edge ends in, if the slice is open that far. */
function openTextblock(
	content: Slice["content"],
	openDepth: number,
	side: "start" | "end",
): ProseMirrorNode | null {
	let node = side === "start" ? content.firstChild : content.lastChild;
	for (let depth = 1; node && depth <= openDepth; depth += 1) {
		if (node.isTextblock) return node;
		node = side === "start" ? node.firstChild : node.lastChild;
	}
	return null;
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
		documentLinks,
		originKey = createMarkdownEditorOriginKey(),
		onPersist,
		onPersistenceError,
		onImagePasteStatus,
	} = args;

	const ast = contentAst ?? (parseMarkdown(initialMarkdown ?? "") as any);

	let persistStateTimer: any = null;
	let persistPromise: Promise<void> | null = null;
	let destroyed = false;
	let pendingPersistenceSnapshot: {
		readonly revision: number;
		readonly doc: ProseMirrorNode;
	} | null = null;
	let editorInstance: Editor | null = null;
	let currentEditor: Editor | null = null;
	let cleanupExternalLinkClick: (() => void) | null = null;
	const initialFileMarkdown = initialMarkdown ?? serializeAst(ast as any);
	const persistenceBaseline: MarkdownPersistenceBaseline = {
		lastAcknowledgedMarkdown: normalizePersistedMarkdown(initialFileMarkdown),
		expectedFileMarkdown: initialFileMarkdown,
		documentRevision: 0,
		acknowledgedRevision: 0,
		observationGeneration: 0,
		source: createIncrementalMarkdownSource(),
	};
	const persistWindowMs = persistDebounceMs ?? 20;
	const persistOnce = async (): Promise<number | undefined> => {
		const snapshot = pendingPersistenceSnapshot;
		if (!snapshot) return undefined;
		const { revision, doc } = snapshot;
		if (containsMarkdownReviewProjection(doc)) return revision;
		if (revision === persistenceBaseline.acknowledgedRevision) {
			pendingPersistenceSnapshot = null;
			return revision;
		}
		const normalizedMarkdown = buildNormalizedMarkdownIncrementally(doc);
		if (normalizedMarkdown === persistenceBaseline.lastAcknowledgedMarkdown) {
			persistenceBaseline.acknowledgedRevision = revision;
			if (pendingPersistenceSnapshot?.revision === revision) {
				pendingPersistenceSnapshot = null;
			}
			return revision;
		}
		const preserved = persistenceBaseline.source.preserve(
			persistenceBaseline.expectedFileMarkdown,
			doc,
			normalizedMarkdown,
		);
		const markdown = preserved.markdown;
		const observationGeneration = persistenceBaseline.observationGeneration;
		const participant = editorInstance
			? saveParticipants.get(editorInstance)?.prepare(doc)
			: null;
		const write = { lix, fileId: fileId!, markdown, originKey };
		const receipt = participant
			? await upsertMarkdownFileWith({ ...write, participant })
			: await upsertMarkdownFile(write);
		if (!receipt.written)
			throw new Error(
				"Could not save because the file no longer exists. Your draft is still in this editor.",
			);
		// Observations can arrive after the local commit but before its promise
		// returns. Keep that newer clean baseline instead of reviving the old save.
		if (persistenceBaseline.observationGeneration === observationGeneration) {
			persistenceBaseline.lastAcknowledgedMarkdown = normalizedMarkdown;
			persistenceBaseline.expectedFileMarkdown = markdown;
			persistenceBaseline.acknowledgedRevision = revision;
			preserved.accept();
		}
		if (pendingPersistenceSnapshot?.revision === revision) {
			pendingPersistenceSnapshot = null;
		}
		onPersistenceError?.(null);
		onPersist?.({
			fileId: fileId!,
			filePath: sourceFilePath,
			commit: receipt.commit,
		});
		return revision;
	};
	const runPersist = (): Promise<void> => {
		if (!fileId || !persistState) return Promise.resolve();
		if (persistPromise) return persistPromise;
		persistPromise = (async () => {
			try {
				while (true) {
					const attemptedRevision = await persistOnce();
					if (
						attemptedRevision === undefined ||
						pendingPersistenceSnapshot === null ||
						pendingPersistenceSnapshot.revision === attemptedRevision
					) {
						break;
					}
				}
				if (!pendingPersistenceSnapshot && persistStateTimer) {
					clearTimeout(persistStateTimer);
					persistStateTimer = null;
				}
			} catch (error) {
				onPersistenceError?.(
					error instanceof Error ? error : new Error("Could not save file."),
				);
				throw error;
			} finally {
				persistPromise = null;
			}
		})();
		return persistPromise;
	};
	const placeholderConfig: any = {
		// The hint names the block the caret is in: the slash prompt for
		// plain text, or the heading level.
		placeholder: ({ node }: { node: any }) => {
			if (node.childCount !== 0) return "";
			if (node.type.name === "heading") {
				return `Heading ${node.attrs?.level ?? 1}`;
			}
			return node.type.name === "paragraph" ? "Press ‘/’ for commands" : "";
		},
		// When it shows is the stylesheet's call (src/index.css): on the empty
		// line under a focused caret, and in an empty document even unfocused.
		showOnlyWhenEditable: true,
		showOnlyCurrent: true,
		includeChildren: false,
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

	const documentExistence = createDocumentExistence(lix);
	// A host URL names a file by id or path; an id becomes a path once the
	// file list is known, so the link is plain until then and a document after.
	const resolveHostHref = documentLinks
		? (href: string): string | null => {
				const target = documentLinks.resolve(href);
				if (!target) return null;
				return "path" in target
					? target.path
					: (documentExistence.pathOf(target.id) ?? null);
			}
		: undefined;
	editorInstance = new Editor({
		extensions: [
			...markdownExtensions,
			JoinAdjacentListsExtension,
			DocumentLinkIconsExtension.configure({
				sourceFilePath: sourceFilePath ?? null,
				exists: documentExistence.exists,
				subscribe: documentExistence.subscribe,
				...(resolveHostHref ? { resolveHostHref } : {}),
			}),
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
			EmbedFileCommandsExtension.configure({
				onStateChange: () => {},
			}),
			MentionCommandsExtension.configure({
				onStateChange: () => {},
			}),
			TableNavigationExtension,
			TableControlsExtension,
			FocusedControlGuardExtension,
			ClickBelowDocumentExtension,
			SelectionBlockHighlightExtension,
			CodeLanguageMenuExtension,
		],
		// Nothing listens for its "delete" events, and it re-maps every step of
		// every transaction to emit them.
		enableCoreExtensions: { delete: false },
		editable,
		content:
			initialContent ?? (astToTiptapDoc(ast, { defaultBlock }) as JSONContent),
		onBeforeCreate: ({ editor }) => {
			// The schema exists now and the document does not yet.
			const content = editor.options.content;
			if (content && typeof content === "object" && !Array.isArray(content))
				editor.options.content = assignMissingDataIds(
					content as JSONContent,
					editor.schema,
				);
		},
		onCreate: ({ editor }) => {
			currentEditor = editor as Editor;
			// TipTap emits create on a later timer. Edits can arrive first; they
			// must not become the acknowledged baseline before being persisted.
			if (persistenceBaseline.documentRevision === 0) {
				persistenceBaseline.lastAcknowledgedMarkdown =
					buildNormalizedMarkdownIncrementally(editor.state.doc);
			}
			persistenceBaselines.set(editor, persistenceBaseline);
			onCreate?.({ editor });
		},
		onUpdate: ({ editor, transaction }) => {
			if (destroyed) return;
			if (onUpdate?.({ editor }) === false) return;
			if (!transaction.docChanged) return;
			persistenceBaseline.documentRevision += 1;
			if (!fileId || !persistState || !shouldPersist()) return;
			// Capture the payload while TipTap is alive. The persistence owner can
			// then finish independently if the view is destroyed before its save window
			// or an in-flight write completes.
			// The editor's document, not the transaction's: what plugins
			// appended to it (an outside write's content put back after an
			// undo) is part of what the writer now sees.
			pendingPersistenceSnapshot = {
				revision: persistenceBaseline.documentRevision,
				doc: editor.state.doc,
			};
			if (persistWindowMs <= 0) {
				void runPersist().catch(() => {});
				return;
			}
			// Keep the first edit’s deadline; continuous typing must not postpone
			// persistence. An in-flight save already drains the latest snapshot.
			if (persistStateTimer || persistPromise) return;
			persistStateTimer = setTimeout(() => {
				persistStateTimer = null;
				void runPersist().catch(() => {});
			}, persistWindowMs);
		},
		onDestroy: () => {
			cleanupExternalLinkClick?.();
			cleanupExternalLinkClick = null;
			documentExistence.close();
			// A save still draining after this falls back to the whole document.
			persistenceBaseline.source.dispose();
			destroyed = true;
			currentEditor = null;
			// Destruction only releases TipTap. A save window or serialized drain already
			// owned by persistence may finish its payload captured in onUpdate.
		},
		editorProps: {
			// Keep a couple of lines of context around the caret while typing
			// near the top or bottom edge, instead of pinning it to the edge.
			scrollThreshold: { top: 72, bottom: 96, left: 0, right: 0 },
			scrollMargin: { top: 88, bottom: 128, left: 0, right: 0 },
			clipboardTextSerializer: (slice: any) => markdownClipboardText(slice),
			clipboardSerializer: markdownClipboardSerializer,
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
			attributes: {
				...(editorProps?.attributes ?? {}),
				// The document's type comes from document.css, the sheet the
				// static render inlines, so the two cannot drift.
				class: ["atelier-document", editorProps?.attributes?.class]
					.filter(Boolean)
					.join(" "),
			},
			handleDOMEvents: {
				...(editorProps?.handleDOMEvents ?? {}),
				cut: (view: any, event: ClipboardEvent) => {
					const customCut = editorProps?.handleDOMEvents?.cut;
					if (typeof customCut === "function" && customCut(view, event))
						return true;
					if (
						!view.editable ||
						!event.clipboardData ||
						!deleteSelectedTableText(view.state)
					)
						return false;
					const clipboard = view.serializeForClipboard(
						view.state.selection.content(),
					);
					event.clipboardData.setData("text/plain", clipboard.text);
					event.clipboardData.setData("text/html", clipboard.dom.innerHTML);
					event.preventDefault();
					deleteSelectedTableText(view.state, (tr) =>
						view.dispatch(closeHistory(tr)),
					);
					view.dispatch(closeHistory(view.state.tr));
					return true;
				},

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
	// Align the file with the document before the first save needs it.
	persistenceBaseline.source.prime(
		initialFileMarkdown,
		editorInstance.state.doc,
	);
	const editorDom = editorInstance.view.dom;
	const cleanupDocumentLinks =
		sourceFilePath && openWorkspaceFile
			? bindDocumentLinks(
					editorDom,
					sourceFilePath,
					openWorkspaceFile,
					sourceCommitId,
					documentExistence.exists,
					resolveHostHref,
				)
			: undefined;
	editorDom.addEventListener("click", handleExternalLinkClick, {
		capture: true,
	});
	cleanupExternalLinkClick = () => {
		cleanupDocumentLinks?.();
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

function containsMarkdownReviewProjection(doc: ProseMirrorNode): boolean {
	let found = false;
	doc.descendants((node) => {
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
