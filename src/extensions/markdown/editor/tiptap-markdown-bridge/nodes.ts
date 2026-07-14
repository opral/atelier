import {
	Node,
	Mark,
	type Extensions,
	type CommandProps,
	type Editor,
} from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { codeLanguageLabel } from "./code-language-label";
import { createCodeBlockNodeView } from "./mermaid-code-block-node-view";
import {
	isPdfAssetSrc,
	markdownAssetLabel,
	type LoadedMarkdownAsset,
	type MarkdownWorkspaceFileOpener,
} from "../markdown-asset";
import type {
	PdfPreviewController,
	PdfPreviewRenderer,
} from "@/extensions/pdf/pdf-preview";
import { FrontmatterEditorNodeView } from "../../components/frontmatter-editor";
import {
	frontmatterSourceFromInput,
	type FrontmatterRecord,
} from "../frontmatter-value";

export type MarkdownImageSrcResolver = (src: string) => string;

const syntaxHighlightingPluginKey = new PluginKey(
	"markdown-code-syntax-highlighting",
);

type SyntaxToken = {
	readonly from: number;
	readonly to: number;
	readonly kind:
		| "comment"
		| "keyword"
		| "literal"
		| "number"
		| "property"
		| "string"
		| "type";
};

const syntaxTokenPattern =
	/(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)(?=\s*:)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|(\b(?:as|async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|interface|let|new|of|return|satisfies|switch|throw|try|type|typeof|var|while|yield)\b)|(\b(?:false|null|true|undefined)\b)|(\b[A-Z][A-Za-z0-9_]*\b)|(\b[A-Za-z_$][\w$]*)(?=\s*:)/gm;

function syntaxTokensFor(source: string): SyntaxToken[] {
	const tokens: SyntaxToken[] = [];
	for (const match of source.matchAll(syntaxTokenPattern)) {
		const value = match[0];
		const from = match.index;
		if (from === undefined || value.length === 0) continue;
		const kind: SyntaxToken["kind"] = match[1]
			? "comment"
			: match[2]
				? "property"
				: match[3]
					? "string"
					: match[4]
						? "number"
						: match[5]
							? "keyword"
							: match[6]
								? "literal"
								: match[7]
									? "type"
									: "property";
		tokens.push({ from, to: from + value.length, kind });
	}
	return tokens;
}

function codeSyntaxDecorations(doc: any): DecorationSet {
	const decorations: Decoration[] = [];
	doc.descendants((node: any, position: number) => {
		if (node.type.name !== "codeBlock") return;
		for (const token of syntaxTokensFor(node.textContent)) {
			decorations.push(
				Decoration.inline(position + 1 + token.from, position + 1 + token.to, {
					class: `syntax-token syntax-${token.kind}`,
				}),
			);
		}
		return false;
	});
	return DecorationSet.create(doc, decorations);
}

function createCodeSyntaxHighlightingPlugin(): Plugin {
	return new Plugin({
		key: syntaxHighlightingPluginKey,
		state: {
			init: (_config, state) => codeSyntaxDecorations(state.doc),
			apply: (transaction, previous) =>
				transaction.docChanged
					? codeSyntaxDecorations(transaction.doc)
					: previous.map(transaction.mapping, transaction.doc),
		},
		props: {
			decorations(state) {
				return syntaxHighlightingPluginKey.getState(state);
			},
		},
	});
}

// Extend TipTap's command types
declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		horizontalRule: {
			setHorizontalRule: () => ReturnType;
		};
		frontmatter: {
			setFrontmatter: (value?: string | FrontmatterRecord) => ReturnType;
			unsetFrontmatter: () => ReturnType;
		};
	}
}

// Minimal schema-only nodes and marks for MarkdownWc
function diffAttrs(node: any, mode: "words" | "element" = "words"): any {
	const id = node?.attrs?.data?.id;
	if (typeof id !== "string" || id.length === 0) return {};
	const diffMode =
		node?.attrs?.data?.diffMode === "words" ||
		node?.attrs?.data?.diffMode === "element"
			? node.attrs.data.diffMode
			: mode;
	return {
		"data-diff-key": id,
		"data-diff-mode": diffMode,
		"data-diff-show-when-removed": "true",
	};
}

export function markdownWcNodes(
	options: {
		readonly resolveImageSrc?: MarkdownImageSrcResolver;
		readonly loadAsset?: (src: string) => Promise<LoadedMarkdownAsset | null>;
		readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
		readonly renderPdfPreview?: PdfPreviewRenderer;
	} = {},
): Extensions {
	const resolveImageSrc = options.resolveImageSrc;
	const loadAsset = options.loadAsset;
	const openWorkspaceFile = options.openWorkspaceFile;
	const renderPdfPreview = options.renderPdfPreview;
	return [
		// doc
		Node.create({ name: "doc", topNode: true, content: "block+" }),
		// text
		Node.create({ name: "text", group: "inline" }),
		// paragraph
		Node.create({
			name: "paragraph",
			group: "block",
			content: "inline*",
			addAttributes() {
				return { data: { default: null } };
			},
			renderHTML({ node }) {
				return ["p", diffAttrs(node), 0];
			},
		}),
		// heading
		Node.create({
			name: "heading",
			group: "block",
			content: "inline*",
			addAttributes() {
				return { level: { default: 1 }, data: { default: null } };
			},
			renderHTML({ node }) {
				const level = (node as any).attrs?.level || 1;
				return ["h" + level, diffAttrs(node), 0];
			},
		}),
		// lists
		Node.create({
			name: "bulletList",
			group: "block",
			content: "listItem+",
			addAttributes() {
				return { isTaskList: { default: false }, data: { default: null } };
			},
			renderHTML({ node }) {
				// Match serializeToHtml default: plain <ul>
				return ["ul", diffAttrs(node, "element"), 0];
			},
		}),
		Node.create({
			name: "orderedList",
			group: "block",
			content: "listItem+",
			addAttributes() {
				return { start: { default: 1 }, data: { default: null } };
			},
			renderHTML({ node }) {
				const attrs: any = {};
				const start = (node as any).attrs?.start;
				if (start && start !== 1) attrs.start = start;
				return ["ol", { ...attrs, ...diffAttrs(node, "element") }, 0];
			},
		}),
		// table
		Node.create({
			name: "table",
			group: "block",
			content: "tableRow+",
			addAttributes() {
				return { align: { default: [] }, data: { default: null } };
			},
			renderHTML({ node }) {
				return ["table", diffAttrs(node, "element"), ["tbody", 0]];
			},
		}),
		Node.create({
			name: "tableRow",
			content: "tableCell+",
			addAttributes() {
				return { data: { default: null } };
			},
			renderHTML({ node }) {
				return ["tr", diffAttrs(node, "element"), 0];
			},
		}),
		Node.create({
			name: "tableCell",
			content: "inline*",
			addAttributes() {
				return {
					isHeader: { default: false },
					align: { default: null },
					data: { default: null },
				};
			},
			renderHTML({ node }) {
				const isHeader = node.attrs?.isHeader === true;
				const align = node.attrs?.align;
				return [
					isHeader ? "th" : "td",
					{
						...diffAttrs(node),
						...(isHeader ? { scope: "col" } : {}),
						...(align ? { "data-align": align } : {}),
					},
					0,
				];
			},
		}),
		Node.create({
			name: "listItem",
			group: "block",
			content: "paragraph block*",
			defining: true,
			addAttributes() {
				return { checked: { default: null }, data: { default: null } };
			},
			renderHTML({ node }) {
				const isTask =
					node.attrs.checked === true || node.attrs.checked === false;
				const attrs = diffAttrs(node, "element");
				if (!isTask) return ["li", attrs, ["div", 0]];
				return [
					"li",
					{
						...attrs,
						"data-task": node.attrs.checked ? "x" : " ",
					},
					[
						"input",
						{
							type: "checkbox",
							checked: node.attrs.checked ? "checked" : undefined,
							disabled: "true",
						},
					],
					["div", 0],
				];
			},
			addNodeView() {
				return ({ node, editor, getPos }) => {
					const dom = document.createElement("li");
					const isTask =
						node.attrs.checked === true || node.attrs.checked === false;
					let input: HTMLInputElement | null = null;
					const content = document.createElement("div");
					if (isTask) {
						dom.setAttribute("data-task", node.attrs.checked ? "x" : " ");
						input = document.createElement("input");
						input.type = "checkbox";
						input.checked = node.attrs.checked === true;
						input.disabled = !editor.isEditable;
						input.addEventListener("mousedown", (e) => {
							// Prevent focusing the checkbox from moving the caret unexpectedly
							e.preventDefault();
						});
						input.addEventListener("change", () => {
							if (!editor.isEditable) return;
							const pos = typeof getPos === "function" ? getPos() : null;
							if (pos == null) return;
							const tr = editor.view.state.tr.setNodeMarkup(pos, undefined, {
								...node.attrs,
								checked: !node.attrs.checked,
							});
							editor.view.dispatch(tr);
						});
						dom.appendChild(input);
					}
					for (const [key, value] of Object.entries(
						diffAttrs(node, "element"),
					)) {
						dom.setAttribute(key, String(value));
					}
					dom.appendChild(content);
					return {
						dom,
						contentDOM: content,
						update: (newNode) => {
							if (newNode.type.name !== "listItem") return false;
							const wasTask = isTask;
							const isNowTask =
								newNode.attrs.checked === true ||
								newNode.attrs.checked === false;
							// If task-state toggled between task/non-task, recreate
							if (wasTask !== isNowTask) return false;
							if (isNowTask) {
								if (input) {
									input.checked = newNode.attrs.checked === true;
									input.disabled = !editor.isEditable;
								}
								dom.setAttribute(
									"data-task",
									newNode.attrs.checked ? "x" : " ",
								);
							}
							// Update attrs reference
							// @ts-ignore - node is captured; we can't reassign but it's fine for event handlers
							node = newNode;
							return true;
						},
					};
				};
			},
		}),
		// blockquote
		Node.create({
			name: "blockquote",
			group: "block",
			content: "block+",
			defining: true,
			addAttributes() {
				return { data: { default: null } };
			},
			renderHTML({ node }) {
				return ["blockquote", diffAttrs(node, "element"), 0];
			},
		}),
		// code block
		Node.create({
			name: "codeBlock",
			group: "block",
			content: "text*",
			marks: "",
			defining: true,
			code: true,
			addAttributes() {
				return { language: { default: null }, data: { default: null } };
			},
			renderHTML({ node }) {
				const lang = (node as any).attrs?.language ?? null;
				const codeAttrs: any = diffAttrs(node);
				if (lang) codeAttrs.class = `language-${lang}`;
				const languageLabel = lang ? codeLanguageLabel(lang) : null;
				return [
					"pre",
					lang ? { "data-language": lang } : {},
					...(languageLabel
						? [
								[
									"span",
									{
										class: "markdown-code-language",
										"aria-label": `Code language: ${languageLabel}`,
										contenteditable: "false",
									},
									languageLabel,
								],
							]
						: []),
					["code", codeAttrs, 0],
				];
			},
			addProseMirrorPlugins() {
				return [createCodeSyntaxHighlightingPlugin()];
			},
			addNodeView() {
				return ({ node, editor, getPos }) =>
					createCodeBlockNodeView({
						node,
						editor,
						view: editor.view,
						getPos,
						diffAttrs: diffAttrs(node),
					});
			},
		}),
		// horizontal rule
		Node.create({
			name: "horizontalRule",
			group: "block",
			addAttributes() {
				return {
					autoInput: { default: false },
					data: { default: null },
				};
			},
			renderHTML({ node }) {
				return ["hr", diffAttrs(node, "element")];
			},
			addCommands() {
				const nodeName = this.name;
				return {
					setHorizontalRule:
						() =>
						({ commands }: CommandProps) => {
							return commands.insertContent({ type: nodeName });
						},
				};
			},
		}),
		Node.create({
			name: "markdownFrontmatter",
			group: "block",
			atom: true,
			selectable: true,
			defining: true,
			addAttributes() {
				return {
					value: { default: "" },
					data: { default: null },
					autofocus: { default: false },
				};
			},
			renderHTML({ node }) {
				return [
					"div",
					{
						"data-markdown-frontmatter": "true",
						class: "markdown-frontmatter",
						...diffAttrs(node, "element"),
					},
					["pre", ["code", String(node.attrs.value ?? "")]],
				];
			},
			addCommands() {
				const nodeName = this.name;
				return {
					setFrontmatter:
						(value?: string | FrontmatterRecord) =>
						({ state, dispatch }: CommandProps) => {
							const nodeType = state.schema.nodes[nodeName];
							if (!nodeType) return false;
							const firstNode = state.doc.firstChild;
							if (firstNode?.type === nodeType) {
								if (value === undefined) return true;
								if (dispatch) {
									dispatch(
										state.tr.setNodeMarkup(0, nodeType, {
											...firstNode.attrs,
											value: frontmatterSourceFromInput(value),
										}),
									);
								}
								return true;
							}
							if (dispatch) {
								dispatch(
									state.tr.insert(
										0,
										nodeType.create({
											value: frontmatterSourceFromInput(value),
											data: null,
											autofocus: value === undefined,
										}),
									),
								);
							}
							return true;
						},
					unsetFrontmatter:
						() =>
						({ state, dispatch }: CommandProps) => {
							const nodeType = state.schema.nodes[nodeName];
							const firstNode = state.doc.firstChild;
							if (!nodeType || firstNode?.type !== nodeType) return false;
							if (dispatch) {
								dispatch(state.tr.delete(0, firstNode.nodeSize));
							}
							return true;
						},
				};
			},
			addNodeView() {
				return ReactNodeViewRenderer(FrontmatterEditorNodeView);
			},
		}),
		// Unsupported blocks (html, yaml, etc.)
		Node.create({
			name: "markdownUnsupported",
			group: "block",
			atom: true,
			selectable: true,
			defining: true,
			addAttributes() {
				return {
					kind: { default: "html" },
					value: { default: "" },
					data: { default: null },
				};
			},
			renderHTML({ node }) {
				const kind = (node as any).attrs?.kind ?? "unsupported";
				const label =
					kind === "yaml"
						? "YAML frontmatter (read only)"
						: "HTML block (read only)";
				const value = (node as any).attrs?.value ?? "";
				return [
					"div",
					{
						"data-markdown-wc-unsupported": kind,
						class: "markdown-wc-unsupported-block",
						...diffAttrs(node, "element"),
					},
					["strong", label],
					["pre", ["code", value]],
				];
			},
		}),
		// Inline HTML placeholder
		Node.create({
			name: "markdownInlineHtml",
			group: "inline",
			inline: true,
			atom: true,
			selectable: true,
			addAttributes() {
				return {
					value: { default: "" },
					data: { default: null },
				};
			},
			renderHTML({ node }) {
				return [
					"span",
					{
						"data-markdown-inline-html": "true",
						class: "markdown-wc-inline-html",
						...diffAttrs(node, "element"),
					},
					["code", (node as any).attrs?.value ?? ""],
				];
			},
		}),
		// hard break
		Node.create({
			name: "hardBreak",
			group: "inline",
			inline: true,
			selectable: false,
			addAttributes() {
				return { data: { default: null } };
			},
			renderHTML({ node }) {
				return ["br", diffAttrs(node, "element")];
			},
		}),
		// marks
		Mark.create({
			name: "bold",
			renderHTML() {
				return ["strong", 0];
			},
		}),
		Mark.create({
			name: "italic",
			renderHTML() {
				return ["em", 0];
			},
		}),
		Mark.create({
			name: "strike",
			renderHTML() {
				return ["s", 0];
			},
		}),
		Mark.create({
			name: "code",
			renderHTML() {
				return ["code", 0];
			},
		}),
		Mark.create({
			name: "link",
			// Don't extend the link when typing at its edges — matches how links
			// behave in other editors (you type *out* of a link, not into it).
			inclusive: false,
			addAttributes() {
				return {
					href: {
						default: null,
						parseHTML: (el: any) => el.getAttribute("href"),
					},
					title: {
						default: null,
						parseHTML: (el: any) => el.getAttribute("title"),
					},
					data: { default: null },
				};
			},
			parseHTML() {
				return [{ tag: "a[href]" }];
			},
			renderHTML({ mark }) {
				const attrs: any = {};
				const href = (mark as any).attrs?.href;
				if (href) attrs.href = href;
				const title = (mark as any).attrs?.title;
				if (title) attrs.title = title;
				return ["a", attrs, 0];
			},
		}),
		// image (inline)
		Node.create({
			name: "image",
			group: "inline",
			inline: true,
			atom: true,
			selectable: true,
			addAttributes() {
				return {
					src: { default: null },
					alt: { default: null },
					title: { default: null },
					data: { default: null },
				};
			},
			renderHTML({ node }) {
				const src = (node as any).attrs?.src;
				const alt = (node as any).attrs?.alt;
				const title = (node as any).attrs?.title;
				const renderedSrc =
					typeof src === "string" && src.length > 0
						? resolveRenderedImageSrc(src, resolveImageSrc)
						: "";
				if (typeof src === "string" && isPdfAssetSrc(src)) {
					return pdfRenderSpec({
						src: safePdfOpenSrc(renderedSrc),
						label: markdownAssetLabel(src, alt),
						title,
						diffAttributes: diffAttrs(node, "element"),
					});
				}
				const attrs: any = {};
				if (renderedSrc) attrs.src = renderedSrc;
				if (alt) attrs.alt = alt;
				if (title) attrs.title = title;
				return ["img", { ...attrs, ...diffAttrs(node, "element") }];
			},
			addNodeView() {
				return ({ node, editor, getPos }) =>
					createMarkdownAssetNodeView({
						node,
						resolveImageSrc,
						loadAsset,
						openWorkspaceFile,
						renderPdfPreview,
						deleteNode: () => deleteMarkdownAssetNode(editor, getPos),
					});
			},
		}),
		// A Markdown paragraph containing only an image is a true movable block.
		// Keep `image` above for images embedded in prose, where dragging an atom
		// would split text and leave an empty paragraph behind.
		Node.create({
			name: "imageBlock",
			group: "block",
			atom: true,
			selectable: true,
			draggable: true,
			addAttributes() {
				return {
					src: { default: null },
					alt: { default: null },
					title: { default: null },
					// `data` belongs to the containing Markdown paragraph so the
					// editor can assign a stable block id. `imageData` preserves
					// metadata attached to the Markdown image itself.
					data: { default: null },
					imageData: { default: null },
				};
			},
			renderHTML({ node }) {
				const src = (node as any).attrs?.src;
				const alt = (node as any).attrs?.alt;
				const title = (node as any).attrs?.title;
				const renderedSrc =
					typeof src === "string" && src.length > 0
						? resolveRenderedImageSrc(src, resolveImageSrc)
						: "";
				if (typeof src === "string" && isPdfAssetSrc(src)) {
					return pdfRenderSpec({
						src: safePdfOpenSrc(renderedSrc),
						label: markdownAssetLabel(src, alt),
						title,
						diffAttributes: diffAttrs(node, "element"),
					});
				}
				const attrs: any = {
					class: "markdown-image-block",
					"data-markdown-image-block": "",
				};
				if (renderedSrc) attrs.src = renderedSrc;
				if (alt) attrs.alt = alt;
				if (title) attrs.title = title;
				return ["img", { ...attrs, ...diffAttrs(node, "element") }];
			},
			addNodeView() {
				return ({ node, editor, getPos }) =>
					createMarkdownAssetNodeView({
						node,
						resolveImageSrc,
						loadAsset,
						openWorkspaceFile,
						renderPdfPreview,
						deleteNode: () => deleteMarkdownAssetNode(editor, getPos),
					});
			},
		}),
	];
}

function pdfRenderSpec({
	src,
	label,
	title,
	diffAttributes,
}: {
	readonly src: string;
	readonly label: string;
	readonly title?: string | null;
	readonly diffAttributes: Record<string, string>;
}): any {
	const openLabel = `Open ${label} in a new tab for full document access`;
	const available = src.length > 0;
	return [
		"span",
		{
			class: "markdown-pdf-embed",
			"data-markdown-pdf": "",
			"data-asset-state": available ? "open-only" : "unavailable",
			contenteditable: "false",
			...(title ? { title } : {}),
			...diffAttributes,
		},
		[
			"span",
			{ class: "markdown-pdf-toolbar" },
			["span", { class: "markdown-pdf-icon", "aria-hidden": "true" }],
			["span", { class: "markdown-pdf-label" }, label],
			[
				"a",
				{
					class: "markdown-pdf-open",
					...(available ? { href: src } : {}),
					target: "_blank",
					rel: "noopener noreferrer",
					"aria-label": openLabel,
				},
				"Open",
			],
		],
		[
			"span",
			{ class: "markdown-pdf-surface" },
			[
				"span",
				{
					class: "markdown-pdf-preview",
					role: "region",
					"aria-label": `PDF preview: ${label}`,
				},
			],
			[
				"span",
				{ class: "markdown-pdf-status", role: "status" },
				[
					"span",
					{ class: "markdown-pdf-status-message" },
					!available
						? "PDF preview unavailable"
						: "Open the PDF to view this document.",
				],
			],
		],
	];
}

function createMarkdownAssetNodeView({
	node,
	resolveImageSrc,
	loadAsset,
	openWorkspaceFile,
	renderPdfPreview,
	deleteNode,
}: {
	readonly node: any;
	readonly resolveImageSrc?: MarkdownImageSrcResolver;
	readonly loadAsset?: (src: string) => Promise<LoadedMarkdownAsset | null>;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	readonly renderPdfPreview?: PdfPreviewRenderer;
	readonly deleteNode?: () => boolean;
}) {
	const nodeTypeName = node.type.name;
	const originalSrc = String(node.attrs?.src ?? "");
	const rendersPdf = isPdfAssetSrc(originalSrc);
	const dom = rendersPdf ? createPdfEmbedDom(node) : createImageDom(node);
	let disposed = false;
	let generation = 0;
	let loadedAsset: LoadedMarkdownAsset | null = null;
	let pdfPreview: PdfPreviewController | null = null;
	let pdfRenderAbort: AbortController | null = null;
	let manualPreviewAbort: AbortController | null = null;
	let visibilityObserver: IntersectionObserver | null = null;
	let pendingManualAsset: LoadedMarkdownAsset | null = null;
	let currentSource: string | null = null;
	const previewAction = dom.querySelector<HTMLButtonElement>(
		".markdown-pdf-preview-action",
	);
	const openAction = dom.querySelector<HTMLAnchorElement>(".markdown-pdf-open");
	const deleteAction =
		nodeTypeName === "imageBlock"
			? createAssetDeleteButton(rendersPdf ? "PDF embed" : "image")
			: null;
	if (deleteAction) {
		const toolbar = dom.querySelector<HTMLElement>(".markdown-pdf-toolbar");
		if (toolbar && openAction) toolbar.insertBefore(deleteAction, openAction);
		else dom.append(deleteAction);
	}
	const handleDeletePointerDown = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
	};
	const handleDelete = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
		deleteNode?.();
	};
	deleteAction?.addEventListener("pointerdown", handleDeletePointerDown);
	deleteAction?.addEventListener("click", handleDelete);
	const handleOpenWorkspaceFile = (event: MouseEvent) => {
		const workspaceFile = loadedAsset?.workspaceFile;
		if (!workspaceFile || !openWorkspaceFile || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		const state = {
			...(workspaceFile.sourceCommitId
				? { sourceCommitId: workspaceFile.sourceCommitId }
				: {}),
			...(workspaceFile.page ? { page: workspaceFile.page } : {}),
		};
		void openWorkspaceFile({
			filePath: workspaceFile.filePath,
			...(Object.keys(state).length > 0 ? { state } : {}),
		});
	};
	openAction?.addEventListener("click", handleOpenWorkspaceFile);

	const disposePdfPreview = () => {
		pdfRenderAbort?.abort();
		pdfRenderAbort = null;
		pdfPreview?.destroy();
		pdfPreview = null;
	};
	const disposeLoadedAsset = () => {
		loadedAsset?.dispose?.();
		loadedAsset = null;
	};
	const showPdfPreview = async ({
		previewSrc,
		previewData,
		openSrc,
		previewGeneration,
		focusAfterLoad = false,
	}: {
		readonly previewSrc: string;
		readonly previewData?: Uint8Array;
		readonly openSrc: string;
		readonly previewGeneration: number;
		readonly focusAfterLoad?: boolean;
	}) => {
		disposePdfPreview();
		if (!renderPdfPreview) {
			setPdfDomOpenOnly(
				dom,
				openSrc,
				"PDF preview unavailable here. Use Open to view the document.",
			);
			return;
		}
		const container = dom.querySelector<HTMLElement>(".markdown-pdf-preview");
		if (!container) {
			setPdfDomOpenOnly(dom, openSrc, "PDF preview unavailable.");
			return;
		}
		setAssetDomLoading(dom);
		setPdfOpenHref(dom, openSrc);
		const mount = document.createElement("span");
		mount.className = "markdown-pdf-preview-mount";
		container.replaceChildren(mount);
		const renderAbort = new AbortController();
		pdfRenderAbort = renderAbort;
		try {
			const controller = await renderPdfPreview({
				src: previewSrc,
				data: previewData,
				container: mount,
				signal: renderAbort.signal,
				onError: () => {
					if (disposed || generation !== previewGeneration) return;
					pdfPreview = null;
					pdfRenderAbort = null;
					setPdfDomOpenOnly(
						dom,
						openSrc,
						"This page could not be rendered. Use Open to view the document.",
					);
					if (focusAfterLoad) focusPdfOpenLink(dom);
				},
			});
			if (disposed || generation !== previewGeneration) {
				controller.destroy();
				return;
			}
			pdfPreview = controller;
			setPdfDomReady(dom, openSrc);
			if (focusAfterLoad) {
				const preview = dom.querySelector<HTMLElement>(".markdown-pdf-preview");
				if (preview) {
					preview.tabIndex = -1;
					preview.focus();
				}
			}
		} catch {
			if (!disposed && generation === previewGeneration) {
				pdfRenderAbort = null;
				setPdfDomOpenOnly(
					dom,
					openSrc,
					"PDF preview unavailable. Use Open to view the document.",
				);
				if (focusAfterLoad) focusPdfOpenLink(dom);
			}
		}
	};
	const handlePreviewAction = async (event: Event) => {
		event.preventDefault();
		const asset = pendingManualAsset;
		if (!asset) return;
		const focusAfterLoad = true;
		const previewGeneration = generation;
		if (!asset.loadPreview) {
			pendingManualAsset = null;
			await showPdfPreview({
				previewSrc: asset.src,
				previewData: asset.data,
				openSrc: asset.src,
				previewGeneration,
				focusAfterLoad,
			});
			return;
		}
		setAssetDomLoading(dom);
		setPdfOpenHref(dom, asset.src);
		manualPreviewAbort?.abort();
		const previewAbort = new AbortController();
		manualPreviewAbort = previewAbort;
		let previewAsset: LoadedMarkdownAsset | null = null;
		try {
			previewAsset = await asset.loadPreview(previewAbort.signal);
		} catch {
			previewAsset = null;
		}
		if (manualPreviewAbort === previewAbort) manualPreviewAbort = null;
		if (disposed || generation !== previewGeneration) {
			previewAsset?.dispose?.();
			return;
		}
		if (!previewAsset) {
			pendingManualAsset = asset;
			setPdfDomManual(
				dom,
				asset.src,
				asset.manualReason ?? "remote",
				asset.remoteHost,
			);
			setPdfStatusMessage(
				dom,
				"Preview failed. Try again or use Open to view the PDF.",
			);
			if (focusAfterLoad) previewAction?.focus();
			return;
		}
		const safeSrc = safePdfRenderSrc(previewAsset.src);
		if (!safeSrc || !safeSrc.startsWith("blob:")) {
			previewAsset.dispose?.();
			pendingManualAsset = asset;
			setPdfDomManual(
				dom,
				asset.src,
				asset.manualReason ?? "remote",
				asset.remoteHost,
			);
			setPdfStatusMessage(
				dom,
				"Preview failed. Try again or use Open to view the PDF.",
			);
			if (focusAfterLoad) previewAction?.focus();
			return;
		}
		pendingManualAsset = null;
		disposeLoadedAsset();
		loadedAsset = previewAsset;
		await showPdfPreview({
			previewSrc: safeSrc,
			previewData: previewAsset.data,
			openSrc: asset.src,
			previewGeneration,
			focusAfterLoad,
		});
	};
	previewAction?.addEventListener("click", handlePreviewAction);

	const updateSource = (nextNode: any) => {
		generation += 1;
		const loadGeneration = generation;
		visibilityObserver?.disconnect();
		visibilityObserver = null;
		pendingManualAsset = null;
		manualPreviewAbort?.abort();
		manualPreviewAbort = null;
		disposePdfPreview();
		disposeLoadedAsset();
		const src = String(nextNode.attrs?.src ?? "");
		currentSource = src;
		updateAssetDomAttributes(dom, nextNode);
		if (!loadAsset) {
			const renderedSrc = resolveRenderedImageSrc(src, resolveImageSrc);
			const previewSrc = rendersPdf
				? safePdfRenderSrc(renderedSrc)
				: renderedSrc;
			const openSrc = rendersPdf ? safePdfOpenSrc(renderedSrc) : renderedSrc;
			if (previewSrc && rendersPdf && isRemotePdfSrc(previewSrc)) {
				setPdfDomOpenOnly(
					dom,
					openSrc,
					"Open the PDF to view this remote document.",
				);
			} else if (previewSrc && rendersPdf) {
				void showPdfPreview({
					previewSrc,
					openSrc,
					previewGeneration: loadGeneration,
				});
			} else if (openSrc && rendersPdf) {
				setPdfDomOpenOnly(dom, openSrc, "Open the PDF to view this document.");
			} else if (previewSrc) setImageDomSource(dom, previewSrc);
			else setAssetDomUnavailable(dom);
			return;
		}
		setAssetDomLoading(dom);
		const performLoad = () => {
			void loadAsset(src).then(
				(asset) => {
					if (disposed || generation !== loadGeneration) {
						asset?.dispose?.();
						return;
					}
					loadedAsset = asset;
					if (!asset) {
						setAssetDomUnavailable(dom);
						return;
					}
					setPdfOpenDestination(
						dom,
						asset.workspaceFile && openWorkspaceFile ? "workspace" : "external",
					);
					const safeSrc = rendersPdf ? safePdfRenderSrc(asset.src) : asset.src;
					if (!safeSrc) {
						disposeLoadedAsset();
						setAssetDomUnavailable(dom);
						return;
					}
					if (rendersPdf && asset.preview === "manual") {
						pendingManualAsset = asset;
						setPdfDomManual(
							dom,
							safeSrc,
							asset.manualReason ?? "remote",
							asset.remoteHost,
						);
						return;
					}
					if (rendersPdf) {
						void showPdfPreview({
							previewSrc: safeSrc,
							previewData: asset.data,
							openSrc: safeSrc,
							previewGeneration: loadGeneration,
						});
					} else {
						setImageDomSource(dom, safeSrc);
					}
				},
				() => {
					if (!disposed && generation === loadGeneration) {
						setAssetDomUnavailable(dom);
					}
				},
			);
		};
		if (rendersPdf && typeof IntersectionObserver !== "undefined") {
			visibilityObserver = new IntersectionObserver((entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				visibilityObserver?.disconnect();
				visibilityObserver = null;
				performLoad();
			});
			visibilityObserver.observe(dom);
		} else {
			performLoad();
		}
	};

	updateSource(node);
	return {
		dom,
		update: (nextNode: any) => {
			if (nextNode.type.name !== nodeTypeName) return false;
			if (isPdfAssetSrc(String(nextNode.attrs?.src ?? "")) !== rendersPdf) {
				return false;
			}
			const nextSource = String(nextNode.attrs?.src ?? "");
			if (nextSource === currentSource) {
				updateAssetDomAttributes(dom, nextNode);
				return true;
			}
			updateSource(nextNode);
			return true;
		},
		destroy: () => {
			disposed = true;
			generation += 1;
			visibilityObserver?.disconnect();
			previewAction?.removeEventListener("click", handlePreviewAction);
			openAction?.removeEventListener("click", handleOpenWorkspaceFile);
			deleteAction?.removeEventListener("pointerdown", handleDeletePointerDown);
			deleteAction?.removeEventListener("click", handleDelete);
			manualPreviewAbort?.abort();
			disposePdfPreview();
			disposeLoadedAsset();
		},
	};
}

function createImageDom(node: any): HTMLElement {
	const image = document.createElement("img");
	if (node.type.name !== "imageBlock") {
		updateAssetDomAttributes(image, node);
		return image;
	}

	const wrapper = document.createElement("span");
	wrapper.className = "markdown-image-embed markdown-image-block";
	wrapper.dataset.markdownImageBlock = "";
	wrapper.contentEditable = "false";
	wrapper.draggable = true;
	image.className = "markdown-image-block-content";
	image.draggable = false;
	wrapper.append(image);
	updateAssetDomAttributes(wrapper, node);
	return wrapper;
}

function createPdfEmbedDom(node: any): HTMLSpanElement {
	const wrapper = document.createElement("span");
	wrapper.className = "markdown-pdf-embed";
	wrapper.dataset.markdownPdf = "";
	wrapper.contentEditable = "false";
	if (node.type.name === "imageBlock") {
		wrapper.classList.add("markdown-image-block");
		wrapper.dataset.markdownImageBlock = "";
		wrapper.draggable = true;
	}

	const toolbar = document.createElement("span");
	toolbar.className = "markdown-pdf-toolbar";
	const icon = document.createElement("span");
	icon.className = "markdown-pdf-icon";
	icon.ariaHidden = "true";
	const label = document.createElement("span");
	label.className = "markdown-pdf-label";
	const open = document.createElement("a");
	open.className = "markdown-pdf-open";
	open.target = "_blank";
	open.rel = "noopener noreferrer";
	open.textContent = "Open";
	toolbar.append(icon, label, open);

	const surface = document.createElement("span");
	surface.className = "markdown-pdf-surface";
	const preview = document.createElement("span");
	preview.className = "markdown-pdf-preview";
	preview.role = "region";
	const status = document.createElement("span");
	status.className = "markdown-pdf-status";
	status.role = "status";
	const statusMessage = document.createElement("span");
	statusMessage.className = "markdown-pdf-status-message";
	statusMessage.textContent = "Loading PDF preview…";
	const previewAction = document.createElement("button");
	previewAction.type = "button";
	previewAction.className = "markdown-pdf-preview-action";
	previewAction.textContent = "Preview PDF";
	status.append(statusMessage, previewAction);
	surface.append(preview, status);
	wrapper.append(toolbar, surface);
	updateAssetDomAttributes(wrapper, node);
	return wrapper;
}

function updateAssetDomAttributes(dom: HTMLElement, node: any): void {
	const src = String(node.attrs?.src ?? "");
	const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : null;
	const title = typeof node.attrs?.title === "string" ? node.attrs.title : null;
	for (const attribute of [
		"data-diff-key",
		"data-diff-mode",
		"data-diff-show-when-removed",
	]) {
		dom.removeAttribute(attribute);
	}
	for (const [key, value] of Object.entries(diffAttrs(node, "element"))) {
		dom.setAttribute(key, String(value));
	}
	if (title) dom.title = title;
	else dom.removeAttribute("title");
	const image = markdownImageElement(dom);
	if (image) {
		if (alt) image.alt = alt;
		else image.removeAttribute("alt");
		return;
	}
	const label = markdownAssetLabel(src, alt);
	const labelElement = dom.querySelector<HTMLElement>(".markdown-pdf-label");
	const open = dom.querySelector<HTMLAnchorElement>(".markdown-pdf-open");
	const preview = dom.querySelector<HTMLElement>(".markdown-pdf-preview");
	if (labelElement) labelElement.textContent = label;
	if (open) {
		setPdfOpenDestination(dom, "external");
	}
	if (preview) preview.ariaLabel = `PDF preview: ${label}`;
}

function setAssetDomLoading(dom: HTMLElement): void {
	dom.dataset.assetState = "loading";
	dom.setAttribute("aria-busy", "true");
	markdownImageElement(dom)?.removeAttribute("src");
	const open = dom.querySelector<HTMLAnchorElement>(".markdown-pdf-open");
	const preview = dom.querySelector<HTMLElement>(".markdown-pdf-preview");
	open?.removeAttribute("href");
	preview?.replaceChildren();
	setPdfStatusMessage(dom, "Loading PDF preview…");
}

function setImageDomSource(dom: HTMLElement, src: string): void {
	dom.dataset.assetState = "ready";
	dom.removeAttribute("aria-busy");
	const image = markdownImageElement(dom);
	if (image) image.src = src;
}

function markdownImageElement(dom: HTMLElement): HTMLImageElement | null {
	return dom instanceof HTMLImageElement
		? dom
		: dom.querySelector<HTMLImageElement>(".markdown-image-block-content");
}

function createAssetDeleteButton(
	label: "image" | "PDF embed",
): HTMLButtonElement {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "markdown-asset-delete";
	button.contentEditable = "false";
	button.ariaLabel = `Delete ${label}`;
	button.title = `Delete ${label}`;

	const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	icon.setAttribute("viewBox", "0 0 24 24");
	icon.setAttribute("fill", "none");
	icon.setAttribute("stroke", "currentColor");
	icon.setAttribute("stroke-width", "2");
	icon.setAttribute("stroke-linecap", "round");
	icon.setAttribute("stroke-linejoin", "round");
	icon.setAttribute("aria-hidden", "true");
	for (const pathData of [
		"M3 6h18",
		"M8 6V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v2",
		"M19 6l-1 14c-.1 1.1-1 2-2 2H8c-1.1 0-1.9-.9-2-2L5 6",
		"M10 11v6",
		"M14 11v6",
	]) {
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", pathData);
		icon.append(path);
	}
	button.append(icon);
	return button;
}

function deleteMarkdownAssetNode(
	editor: Editor,
	getPos: () => number | undefined,
): boolean {
	try {
		const position = getPos();
		if (typeof position !== "number") return false;
		const node = editor.state.doc.nodeAt(position);
		if (node?.type.name !== "imageBlock") return false;
		return editor.commands.deleteRange({
			from: position,
			to: position + node.nodeSize,
		});
	} catch {
		return false;
	}
}

function setPdfDomReady(dom: HTMLElement, openSrc: string): void {
	dom.dataset.assetState = "ready";
	dom.removeAttribute("aria-busy");
	setPdfOpenHref(dom, openSrc);
}

function setAssetDomUnavailable(dom: HTMLElement): void {
	dom.dataset.assetState = "unavailable";
	dom.removeAttribute("aria-busy");
	dom
		.querySelector<HTMLAnchorElement>(".markdown-pdf-open")
		?.removeAttribute("href");
	dom.querySelector<HTMLElement>(".markdown-pdf-preview")?.replaceChildren();
	setPdfStatusMessage(dom, "PDF preview unavailable");
}

function setPdfDomManual(
	dom: HTMLElement,
	src: string,
	reason: "remote" | "large",
	remoteHost?: string,
): void {
	dom.dataset.assetState = "manual";
	dom.removeAttribute("aria-busy");
	setPdfOpenHref(dom, src);
	dom.querySelector<HTMLElement>(".markdown-pdf-preview")?.replaceChildren();
	setPdfStatusMessage(
		dom,
		reason === "large"
			? "This PDF is large. Preview it when you're ready."
			: remoteHost
				? `Previewing downloads this PDF from ${remoteHost}.`
				: "Remote PDFs load only after you choose to preview them.",
	);
	const action = dom.querySelector<HTMLButtonElement>(
		".markdown-pdf-preview-action",
	);
	if (action) {
		action.ariaLabel = remoteHost
			? `Preview PDF from ${remoteHost}`
			: "Preview PDF";
	}
}

function setPdfDomOpenOnly(
	dom: HTMLElement,
	src: string,
	message: string,
): void {
	dom.dataset.assetState = "open-only";
	dom.removeAttribute("aria-busy");
	setPdfOpenHref(dom, src);
	dom.querySelector<HTMLElement>(".markdown-pdf-preview")?.replaceChildren();
	setPdfStatusMessage(dom, message);
}

function setPdfOpenHref(dom: HTMLElement, src: string): void {
	const open = dom.querySelector<HTMLAnchorElement>(".markdown-pdf-open");
	if (open) open.href = src;
}

function setPdfOpenDestination(
	dom: HTMLElement,
	destination: "workspace" | "external",
): void {
	const open = dom.querySelector<HTMLAnchorElement>(".markdown-pdf-open");
	if (!open) return;
	const label =
		dom.querySelector<HTMLElement>(".markdown-pdf-label")?.textContent ??
		"PDF document";
	if (destination === "workspace") {
		open.removeAttribute("target");
		open.removeAttribute("rel");
		open.ariaLabel = `Open ${label} in the center panel`;
		return;
	}
	open.target = "_blank";
	open.rel = "noopener noreferrer";
	open.ariaLabel = `Open ${label} in a new tab for full document access`;
}

function setPdfStatusMessage(dom: HTMLElement, message: string): void {
	const status = dom.querySelector<HTMLElement>(".markdown-pdf-status-message");
	if (status) status.textContent = message;
}

function safePdfRenderSrc(src: string): string {
	if (!src || src.startsWith("//")) return "";
	try {
		const absolute = new URL(src);
		if (
			absolute.protocol === "http:" ||
			absolute.protocol === "https:" ||
			absolute.protocol === "blob:"
		) {
			return src;
		}
		return "";
	} catch {
		return "";
	}
}

function safePdfOpenSrc(src: string): string {
	if (!src) return "";
	try {
		const absolute = new URL(src, "https://atelier.workspace/");
		if (
			absolute.protocol !== "http:" &&
			absolute.protocol !== "https:" &&
			absolute.protocol !== "blob:"
		) {
			return "";
		}
		return src.startsWith("//") ? absolute.href : src;
	} catch {
		return "";
	}
}

function focusPdfOpenLink(dom: HTMLElement): void {
	dom.querySelector<HTMLAnchorElement>(".markdown-pdf-open[href]")?.focus();
}

function isRemotePdfSrc(src: string): boolean {
	try {
		const url = new URL(src);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function resolveRenderedImageSrc(
	src: string,
	resolveImageSrc: MarkdownImageSrcResolver | undefined,
): string {
	if (!resolveImageSrc) {
		return src;
	}
	try {
		return resolveImageSrc(src);
	} catch {
		return src;
	}
}
