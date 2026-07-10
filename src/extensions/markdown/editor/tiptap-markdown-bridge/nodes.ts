import { Node, Mark, type Extensions, type CommandProps } from "@tiptap/core";
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

export type MarkdownImageSrcResolver = (src: string) => string;

// Extend TipTap's command types
declare module "@tiptap/core" {
	interface Commands<ReturnType> {
		horizontalRule: {
			setHorizontalRule: () => ReturnType;
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
				return { data: { default: null } };
			},
			renderHTML({ node }) {
				return ["td", diffAttrs(node), 0];
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
						input.addEventListener("mousedown", (e) => {
							// Prevent focusing the checkbox from moving the caret unexpectedly
							e.preventDefault();
						});
						input.addEventListener("change", () => {
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
								if (input) input.checked = newNode.attrs.checked === true;
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
				return ["pre", ["code", codeAttrs, 0]];
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
				return { data: { default: null } };
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
				return ({ node }) =>
					createMarkdownAssetNodeView({
						node,
						resolveImageSrc,
						loadAsset,
						openWorkspaceFile,
						renderPdfPreview,
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
}: {
	readonly node: any;
	readonly resolveImageSrc?: MarkdownImageSrcResolver;
	readonly loadAsset?: (src: string) => Promise<LoadedMarkdownAsset | null>;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	readonly renderPdfPreview?: PdfPreviewRenderer;
}) {
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
	const previewAction = dom.querySelector<HTMLButtonElement>(
		".markdown-pdf-preview-action",
	);
	const openAction = dom.querySelector<HTMLAnchorElement>(".markdown-pdf-open");
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
			fileId: workspaceFile.fileId,
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
		openSrc,
		previewGeneration,
		focusAfterLoad = false,
	}: {
		readonly previewSrc: string;
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
			if (nextNode.type.name !== "image") return false;
			if (isPdfAssetSrc(String(nextNode.attrs?.src ?? "")) !== rendersPdf) {
				return false;
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
			manualPreviewAbort?.abort();
			disposePdfPreview();
			disposeLoadedAsset();
		},
	};
}

function createImageDom(node: any): HTMLImageElement {
	const image = document.createElement("img");
	updateAssetDomAttributes(image, node);
	return image;
}

function createPdfEmbedDom(node: any): HTMLSpanElement {
	const wrapper = document.createElement("span");
	wrapper.className = "markdown-pdf-embed";
	wrapper.dataset.markdownPdf = "";
	wrapper.contentEditable = "false";

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
	if (dom instanceof HTMLImageElement) {
		if (alt) dom.alt = alt;
		else dom.removeAttribute("alt");
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
	if (dom instanceof HTMLImageElement) dom.removeAttribute("src");
	const open = dom.querySelector<HTMLAnchorElement>(".markdown-pdf-open");
	const preview = dom.querySelector<HTMLElement>(".markdown-pdf-preview");
	open?.removeAttribute("href");
	preview?.replaceChildren();
	setPdfStatusMessage(dom, "Loading PDF preview…");
}

function setImageDomSource(dom: HTMLElement, src: string): void {
	dom.dataset.assetState = "ready";
	dom.removeAttribute("aria-busy");
	if (dom instanceof HTMLImageElement) {
		dom.src = src;
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
