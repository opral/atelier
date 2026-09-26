import {
	Node,
	Mark,
	type Extensions,
	type CommandProps,
	type Editor,
} from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { codeLanguageLabel } from "./code-language-label";
import { CALLOUT_ICON_PATHS, calloutFamily, calloutLabel } from "./callout";
import {
	createCalloutNodeView,
	createCalloutTitleNodeView,
} from "./callout-node-view";
import { isSafeHref } from "../normalize-url";
import { createCodeBlockNodeView } from "./mermaid-code-block-node-view";
import { mediaKindSource } from "../extensions/host-media-files";
import {
	isPdfAssetSrc,
	isVideoAssetSrc,
	markdownAssetLabel,
	type LoadedMarkdownAsset,
	type MarkdownWorkspaceFileOpener,
} from "../markdown-asset";
import {
	createVideoPlayer,
	formatVideoTimecode,
} from "@/extensions/video/video-player";
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
		footnote: {
			/**
			 * Puts a marker at the caret and its definition with the others (or
			 * at the end of the document), and moves the caret into the
			 * definition to write the note. The label is the smallest number
			 * not already in use; the author can rename it in the source.
			 */
			insertFootnote: () => ReturnType;
		};
	}
}

// Minimal schema-only nodes and marks for MarkdownWc
/** The label as the author wrote it, falling back to the normalized form. */
function footnoteLabel(node: any): string {
	const label = node?.attrs?.label;
	if (typeof label === "string" && label.length > 0) return label;
	return String(node?.attrs?.identifier ?? "");
}

/** The smallest positive integer no marker or definition already uses. */
function nextFootnoteLabel(doc: any): string {
	const used = new Set<string>();
	doc.descendants((node: any) => {
		if (node.type.name === "footnoteRef" || node.type.name === "footnoteDef") {
			used.add(footnoteLabel(node));
		}
		return true;
	});
	let next = 1;
	while (used.has(String(next))) next += 1;
	return String(next);
}

/**
 * Where a new definition goes: after the last one, so definitions stay
 * together wherever the author keeps them; otherwise at the end.
 */
function footnoteDefinitionInsertPos(doc: any, definitionType: any): number {
	let after = doc.content.size;
	let found = false;
	doc.forEach((node: any, offset: number) => {
		if (node.type === definitionType) {
			after = offset + node.nodeSize;
			found = true;
		}
	});
	return found ? after : doc.content.size;
}

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
			isolating: true,
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
			// Items belong only to lists. Treating them as generic blocks lets
			// list lifting stop inside another item and creates bare <li> nodes.
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
					const syncInputEditable = () => {
						if (input) input.disabled = !editor.isEditable;
					};
					const content = document.createElement("div");
					if (isTask) {
						dom.setAttribute("data-task", node.attrs.checked ? "x" : " ");
						input = document.createElement("input");
						input.type = "checkbox";
						input.checked = node.attrs.checked === true;
						syncInputEditable();
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
						editor.on("update", syncInputEditable);
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
						destroy: () => {
							editor.off("update", syncInputEditable);
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
		// callout: a quote whose first line is a `[!NOTE]` marker
		Node.create({
			name: "callout",
			group: "block",
			content: "calloutTitle block+",
			defining: true,
			addAttributes() {
				return {
					data: { default: null },
					kind: { default: "note" },
					marker: { default: null },
					fold: { default: null },
				};
			},
			renderHTML({ node }) {
				const family = calloutFamily(node.attrs.kind);
				const svg = "http://www.w3.org/2000/svg";
				return [
					"div",
					{
						...diffAttrs(node, "element"),
						class: "markdown-callout",
						role: "note",
						"data-callout-family": family,
						"data-callout-kind": String(node.attrs.kind ?? "note"),
						style: `--markdown-callout-label: ${JSON.stringify(calloutLabel(node.attrs.kind))}`,
						...(node.attrs.fold === "-" ? { "data-folded": "" } : {}),
					},
					[
						"span",
						{ class: "markdown-callout-icon", "aria-hidden": "true" },
						[
							`${svg} svg`,
							{
								viewBox: "0 0 24 24",
								width: "18",
								height: "18",
								fill: "none",
								stroke: "currentColor",
								"stroke-width": "2",
								"stroke-linecap": "round",
								"stroke-linejoin": "round",
							},
							...CALLOUT_ICON_PATHS[family].map((d) => [`${svg} path`, { d }]),
						],
					],
					["div", { class: "markdown-callout-content" }, 0],
				] as any;
			},
			addNodeView() {
				return ({ node, editor, getPos }) =>
					createCalloutNodeView({
						node,
						editor,
						getPos: getPos as () => number | undefined,
					});
			},
		}),
		// callout title: one line, like a heading; empty shows the kind's name
		Node.create({
			name: "calloutTitle",
			content: "inline*",
			defining: true,
			renderHTML({ node }) {
				return [
					"div",
					{
						class: "markdown-callout-title",
						...(node.content.size === 0 ? { "data-empty": "" } : {}),
					},
					0,
				];
			},
			addNodeView() {
				return ({ node }) => createCalloutTitleNodeView({ node });
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
				return ReactNodeViewRenderer(FrontmatterEditorNodeView, {
					stopEvent: ({ event }) => stopFrontmatterEvent(event),
				});
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
		// Footnote marker: `[^label]` in the text. One atom, so it is one token
		// to select or delete. The label shows as written; the numbering is the
		// author's, not ours.
		Node.create({
			name: "footnoteRef",
			group: "inline",
			inline: true,
			atom: true,
			selectable: true,
			addAttributes() {
				return {
					label: { default: "" },
					identifier: { default: "" },
					data: { default: null },
				};
			},
			renderHTML({ node }) {
				const label = footnoteLabel(node);
				return [
					"sup",
					{
						class: "markdown-footnote-ref",
						"data-footnote-ref": label,
						...diffAttrs(node, "element"),
					},
					[
						"a",
						{
							class: "markdown-footnote-ref-link",
							role: "button",
							// It is announced as a button, so it has to be one:
							// focusable, and answering Enter and Space where it
							// stands. Without this a screen reader named a control
							// its user could neither reach nor press.
							tabindex: "0",
							"aria-label": `Go to footnote ${label}`,
						},
						`[${label}]`,
					],
				];
			},
		}),
		// Footnote definition: `[^label]: body`. The label is fixed; the body is
		// ordinary block content, edited like any paragraph. It stays wherever
		// it is in the file.
		Node.create({
			name: "footnoteDef",
			group: "block",
			content: "block+",
			defining: true,
			addAttributes() {
				return {
					label: { default: "" },
					identifier: { default: "" },
					data: { default: null },
				};
			},
			renderHTML({ node }) {
				const label = footnoteLabel(node);
				return [
					"div",
					{
						class: "markdown-footnote-def",
						"data-footnote-def": label,
						...diffAttrs(node, "element"),
					},
					[
						"span",
						{
							class: "markdown-footnote-def-label",
							contenteditable: "false",
							"aria-label": `Footnote ${label}`,
						},
						`[${label}]`,
					],
					["div", { class: "markdown-footnote-def-body" }, 0],
					[
						"button",
						{
							type: "button",
							class: "markdown-footnote-backref",
							contenteditable: "false",
							"data-footnote-backref": label,
							"aria-label": `Back to the text for footnote ${label}`,
							title: "Back to reference",
						},
						[
							"svg",
							{
								width: "16",
								height: "16",
								viewBox: "0 0 24 24",
								fill: "none",
								stroke: "currentColor",
								"stroke-width": "2",
								"stroke-linecap": "round",
								"stroke-linejoin": "round",
								"aria-hidden": "true",
								focusable: "false",
							},
							["path", { d: "M9 14 4 9l5-5" }],
							["path", { d: "M4 9h10a6 6 0 0 1 0 12h-1" }],
						],
					],
				];
			},
			addCommands() {
				const definitionName = this.name;
				return {
					insertFootnote:
						() =>
						({ state, tr, dispatch }: CommandProps) => {
							const definitionType = state.schema.nodes[definitionName];
							const markerType = state.schema.nodes.footnoteRef;
							if (!definitionType || !markerType) return false;
							const { $from } = state.selection;
							// A marker is inline text; there is nowhere to put it in a
							// code block, and nothing to point at from inside a note.
							if (!$from.parent.isTextblock || $from.parent.type.spec.code)
								return false;
							for (let depth = $from.depth; depth > 0; depth -= 1) {
								if ($from.node(depth).type === definitionType) return false;
							}
							const label = nextFootnoteLabel(state.doc);
							if (dispatch) {
								const definition = definitionType.create(
									{ label, identifier: label },
									state.schema.nodes.paragraph!.create(),
								);
								tr.insert(
									state.selection.from,
									markerType.create({ label, identifier: label }),
								);
								// Placed after the marker went in, so the position is
								// already in the document that receives it.
								const at = footnoteDefinitionInsertPos(tr.doc, definitionType);
								tr.insert(at, definition);
								// The caret moves into the empty note: past the definition's
								// opening and its paragraph's. ↩ brings it back.
								tr.setSelection(TextSelection.create(tr.doc, at + 2));
								tr.scrollIntoView();
							}
							return true;
						},
				};
			},
		}),
		// hard break
		Node.create({
			name: "hardBreak",
			group: "inline",
			inline: true,
			selectable: false,
			// Turning a paragraph into code keeps its breaks as newlines, and
			// code turned back into text keeps its lines as breaks. Without it
			// setBlockType dropped the break and joined the lines.
			linebreakReplacement: true,
			addAttributes() {
				return { data: { default: null }, soft: { default: false } };
			},
			renderHTML({ node }) {
				// A soft break is a source newline inside a paragraph. It stays a
				// node so the source wrapping survives edits, but it reads as a
				// space, the way CommonMark renders it, not as a line break.
				if (node.attrs.soft === true) {
					return [
						"span",
						{ ...diffAttrs(node, "element"), "data-soft-break": "" },
					];
				}
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
			// Input rules skip code: "**" typed inside `a b` is code, not bold.
			// Other marks may still wrap it (`**\`x\`**`), so no `excludes`.
			code: true,
			renderHTML() {
				return ["code", 0];
			},
			addKeyboardShortcuts() {
				return {
					// A span that ends the line has no plain text after it to move
					// into. ArrowRight steps out of it instead, so what is typed next
					// is plain text; the next press moves on as usual.
					ArrowRight: ({ editor }) => {
						const { selection, storedMarks } = editor.state;
						const { $from } = selection;
						if (
							!selection.empty ||
							$from.parentOffset !== $from.parent.content.size ||
							!this.type.isInSet(storedMarks ?? $from.marks())
						) {
							return false;
						}
						editor.view.dispatch(
							editor.state.tr.setStoredMarks(
								this.type.removeFromSet($from.marks()),
							),
						);
						return true;
					},
				};
			},
			addProseMirrorPlugins() {
				const codeType = this.type;
				return [
					new Plugin({
						props: {
							// At the start of a line ProseMirror takes the marks of the
							// text after the caret, so typing there went into a code span
							// that opens the line, with no way to type before it.
							handleTextInput(view, from, to, text) {
								const { state } = view;
								if (from !== to || to > state.doc.content.size) return false;
								const $from = state.doc.resolve(from);
								if (
									$from.parentOffset !== 0 ||
									state.storedMarks ||
									!codeType.isInSet($from.marks())
								) {
									return false;
								}
								const marks = codeType.removeFromSet($from.marks());
								view.dispatch(
									state.tr
										.replaceWith(from, to, state.schema.text(text, marks))
										.scrollIntoView(),
								);
								return true;
							},
						},
					}),
				];
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
						// Pasted HTML is the other way a target gets in.
						parseHTML: (el: any) => {
							const href = el.getAttribute("href");
							return href && isSafeHref(href) ? href : null;
						},
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
				// The mark keeps what the file says, so saving never rewrites it,
				// but a `javascript:` or `data:` target is drawn without an href:
				// a click in a read-only document would navigate to it natively.
				if (href && isSafeHref(String(href))) attrs.href = href;
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
				if (typeof src === "string" && isVideoAssetSrc(src)) {
					return videoRenderSpec({
						src: safeVideoSrc(renderedSrc),
						caption: typeof alt === "string" ? alt.trim() : "",
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
				return ({ node, editor, getPos, decorations }) =>
					createMarkdownMediaNodeView({
						node,
						decorations,
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
				if (typeof src === "string" && isVideoAssetSrc(src)) {
					return videoRenderSpec({
						src: safeVideoSrc(renderedSrc),
						caption: typeof alt === "string" ? alt.trim() : "",
						title,
						diffAttributes: diffAttrs(node, "element"),
						isBlock: true,
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
				return ({ node, editor, getPos, decorations }) =>
					createMarkdownMediaNodeView({
						node,
						decorations,
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

/**
 * Route an image-syntax node to the node view for its media type. Videos get
 * a playing embed; images and PDFs keep the shared asset node view.
 */
function createMarkdownMediaNodeView(args: {
	readonly node: any;
	readonly decorations?: readonly Decoration[];
	readonly resolveImageSrc?: MarkdownImageSrcResolver;
	readonly loadAsset?: (src: string) => Promise<LoadedMarkdownAsset | null>;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	readonly renderPdfPreview?: PdfPreviewRenderer;
	readonly deleteNode?: () => boolean;
}) {
	if (isVideoAssetSrc(mediaKindSource(args.node, args.decorations))) {
		return createMarkdownVideoNodeView(args);
	}
	return createMarkdownAssetNodeView(args);
}

function suppressMarkdownMediaControlSelection(event: Event): void {
	if (!(event.target instanceof Element)) return;
	const control = event.target.closest(
		"a, button, input, textarea, select, video, [role='slider']",
	);
	if (control === null) {
		return;
	}
	// Block video nodes are draggable from their video surface. Keep the
	// browser's default pointer behavior there so dragstart can fire, while
	// still shielding the editor from selecting the atom on the way through.
	if (!control.matches("video")) event.preventDefault();
	event.stopPropagation();
}

/**
 * Which events the frontmatter panel keeps from ProseMirror.
 *
 * Tiptap's default hands a mousedown on the panel's own chrome — its header,
 * the gaps between rows, the space around the tags — to ProseMirror, which
 * selects the whole panel and focuses the document. The panel then wore its
 * selection ring while its properties were being edited, and the next letter
 * typed replaced every one of them. A click inside the panel is a click on
 * its fields, never on the node: the panel keeps it, and a click on chrome
 * that focuses nothing leaves focus and selection where they were. Selecting
 * the panel from the keyboard (Backspace at the top of the body) still rings.
 */
function stopFrontmatterEvent(event: Event): boolean {
	const target = event.target;
	const isDrag = event.type.startsWith("drag") || event.type === "drop";
	if (
		target instanceof HTMLElement &&
		(target.matches("input, button, select, textarea") ||
			target.isContentEditable)
	) {
		return !isDrag;
	}
	if (event.type === "mousedown") {
		const control =
			target instanceof Element ? target.closest("a, label, [tabindex]") : null;
		if (control?.closest(".markdown-frontmatter") == null) {
			event.preventDefault();
		}
		return true;
	}
	return !(
		isDrag ||
		event.type === "copy" ||
		event.type === "cut" ||
		event.type === "paste"
	);
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

function videoRenderSpec({
	src,
	caption,
	title,
	diffAttributes,
	isBlock = false,
}: {
	readonly src: string;
	readonly caption: string;
	readonly title?: string | null;
	readonly diffAttributes: Record<string, string>;
	readonly isBlock?: boolean;
}): any {
	const available = src.length > 0;
	return [
		"span",
		{
			class: `markdown-video-embed${isBlock ? " markdown-image-block" : ""}`,
			"data-markdown-video": "",
			...(isBlock ? { "data-markdown-image-block": "" } : {}),
			"data-asset-state": available ? "ready" : "unavailable",
			contenteditable: "false",
			...(title ? { title } : {}),
			...diffAttributes,
		},
		[
			"span",
			{ class: "markdown-video-frame" },
			available
				? [
						"video",
						{
							class: "markdown-video-surface",
							src,
							controls: "controls",
							preload: "metadata",
							playsinline: "",
						},
					]
				: ["span", { class: "markdown-video-status" }, "Video unavailable"],
		],
		...(caption
			? [["span", { class: "markdown-video-caption" }, caption]]
			: []),
	];
}

/**
 * Node view for `![…](….mp4|mov|webm)`. Mounts the shared embed player, keeps
 * the alt text as a caption below the frame, and offers Open file (workspace
 * tab when the target resolves inside the workspace) plus the block delete
 * affordance shared with images.
 */
function createMarkdownVideoNodeView({
	node,
	resolveImageSrc,
	loadAsset,
	openWorkspaceFile,
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
	let disposed = false;
	let generation = 0;
	let loadedAsset: LoadedMarkdownAsset | null = null;
	let currentSource: string | null = null;
	let currentAlt = "";
	let videoDuration = 0;

	const dom = document.createElement("span");
	dom.className = "markdown-video-embed";
	dom.dataset.markdownVideo = "";
	dom.contentEditable = "false";
	dom.addEventListener("pointerdown", suppressMarkdownMediaControlSelection);
	dom.addEventListener("mousedown", suppressMarkdownMediaControlSelection);
	if (nodeTypeName === "imageBlock") {
		dom.classList.add("markdown-image-block");
		dom.dataset.markdownImageBlock = "";
		dom.draggable = true;
	}

	const frame = document.createElement("span");
	frame.className = "markdown-video-frame";
	const player = createVideoPlayer({
		variant: "embed",
		onMetadata: ({ duration }) => {
			videoDuration = duration;
			refreshCaption();
		},
	});
	frame.append(player.element);

	const toolbar = document.createElement("span");
	toolbar.className = "markdown-video-toolbar";
	const openAction = document.createElement("a");
	openAction.className = "markdown-video-open";
	openAction.textContent = "Open file";
	toolbar.append(openAction);
	const deleteAction =
		nodeTypeName === "imageBlock"
			? createAssetDeleteButton("video embed")
			: null;
	if (deleteAction) {
		const divider = document.createElement("span");
		divider.className = "markdown-video-toolbar-divider";
		toolbar.append(divider, deleteAction);
	}
	frame.append(toolbar);

	const status = document.createElement("span");
	status.className = "markdown-video-status";
	status.role = "status";
	status.textContent = "Loading video…";
	frame.append(status);

	const caption = document.createElement("span");
	caption.className = "markdown-video-caption";
	caption.hidden = true;
	dom.append(frame, caption);

	const refreshCaption = () => {
		if (!currentAlt) {
			caption.hidden = true;
			caption.textContent = "";
			return;
		}
		caption.hidden = false;
		caption.textContent =
			videoDuration > 0
				? `${currentAlt} · ${formatVideoTimecode(videoDuration)}`
				: currentAlt;
	};

	const applyAttributes = (nextNode: any) => {
		currentAlt =
			typeof nextNode.attrs?.alt === "string" ? nextNode.attrs.alt.trim() : "";
		const title =
			typeof nextNode.attrs?.title === "string" ? nextNode.attrs.title : null;
		if (title) dom.title = title;
		else dom.removeAttribute("title");
		for (const attribute of [
			"data-diff-key",
			"data-diff-mode",
			"data-diff-show-when-removed",
		]) {
			dom.removeAttribute(attribute);
		}
		for (const [key, value] of Object.entries(diffAttrs(nextNode, "element"))) {
			dom.setAttribute(key, String(value));
		}
		refreshCaption();
	};

	const setOpenDestination = (
		destination: "workspace" | "external" | "none",
		href: string,
	) => {
		if (destination === "none") {
			openAction.removeAttribute("href");
			toolbar.dataset.openAvailable = "false";
			return;
		}
		toolbar.dataset.openAvailable = "true";
		openAction.href = href;
		if (destination === "workspace") {
			openAction.removeAttribute("target");
			openAction.removeAttribute("rel");
			openAction.ariaLabel = "Open video in the center panel";
			return;
		}
		openAction.target = "_blank";
		openAction.rel = "noopener noreferrer";
		openAction.ariaLabel = "Open video in a new tab";
	};

	const setState = (state: "loading" | "ready" | "unavailable") => {
		dom.dataset.assetState = state;
		if (state === "loading") {
			dom.setAttribute("aria-busy", "true");
			status.textContent = "Loading video…";
		} else {
			dom.removeAttribute("aria-busy");
			if (state === "unavailable") status.textContent = "Video unavailable";
		}
	};

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
		void openWorkspaceFile({
			filePath: workspaceFile.filePath,
			...(workspaceFile.sourceCommitId
				? { state: { sourceCommitId: workspaceFile.sourceCommitId } }
				: {}),
		});
	};
	openAction.addEventListener("click", handleOpenWorkspaceFile);

	const disposeLoadedAsset = () => {
		loadedAsset?.dispose?.();
		loadedAsset = null;
	};

	const updateSource = (nextNode: any) => {
		generation += 1;
		const loadGeneration = generation;
		disposeLoadedAsset();
		videoDuration = 0;
		const src = String(nextNode.attrs?.src ?? "");
		currentSource = src;
		applyAttributes(nextNode);
		if (!loadAsset) {
			const renderedSrc = safeVideoSrc(
				resolveRenderedImageSrc(src, resolveImageSrc),
			);
			if (renderedSrc) {
				player.setSource(renderedSrc);
				setOpenDestination("external", renderedSrc);
				setState("ready");
			} else {
				player.setSource(null);
				setOpenDestination("none", "");
				setState("unavailable");
			}
			return;
		}
		setState("loading");
		player.setSource(null);
		setOpenDestination("none", "");
		void loadAsset(src).then(
			(asset) => {
				if (disposed || generation !== loadGeneration) {
					asset?.dispose?.();
					return;
				}
				loadedAsset = asset;
				const safeSrc = asset ? safeVideoSrc(asset.src) : "";
				if (!asset || !safeSrc) {
					disposeLoadedAsset();
					player.setSource(null);
					setState("unavailable");
					return;
				}
				player.setSource(safeSrc);
				setOpenDestination(
					asset.workspaceFile && openWorkspaceFile ? "workspace" : "external",
					safeSrc,
				);
				setState("ready");
			},
			() => {
				if (!disposed && generation === loadGeneration) {
					player.setSource(null);
					setState("unavailable");
				}
			},
		);
	};

	updateSource(node);
	return {
		dom,
		update: (nextNode: any, decorations: readonly Decoration[]) => {
			if (nextNode.type.name !== nodeTypeName) return false;
			const nextSource = String(nextNode.attrs?.src ?? "");
			if (!isVideoAssetSrc(mediaKindSource(nextNode, decorations))) {
				return false;
			}
			if (nextSource === currentSource) {
				applyAttributes(nextNode);
				return true;
			}
			updateSource(nextNode);
			return true;
		},
		destroy: () => {
			disposed = true;
			generation += 1;
			dom.removeEventListener(
				"pointerdown",
				suppressMarkdownMediaControlSelection,
			);
			dom.removeEventListener(
				"mousedown",
				suppressMarkdownMediaControlSelection,
			);
			openAction.removeEventListener("click", handleOpenWorkspaceFile);
			deleteAction?.removeEventListener("pointerdown", handleDeletePointerDown);
			deleteAction?.removeEventListener("click", handleDelete);
			player.destroy();
			disposeLoadedAsset();
		},
	};
}

function safeVideoSrc(src: string): string {
	if (!src || src.startsWith("//")) return "";
	try {
		const absolute = new URL(src);
		if (
			absolute.protocol === "http:" ||
			absolute.protocol === "https:" ||
			absolute.protocol === "blob:" ||
			absolute.protocol === "data:"
		) {
			return src;
		}
		return "";
	} catch {
		return "";
	}
}

function createMarkdownAssetNodeView({
	node,
	decorations,
	resolveImageSrc,
	loadAsset,
	openWorkspaceFile,
	renderPdfPreview,
	deleteNode,
}: {
	readonly node: any;
	readonly decorations?: readonly Decoration[];
	readonly resolveImageSrc?: MarkdownImageSrcResolver;
	readonly loadAsset?: (src: string) => Promise<LoadedMarkdownAsset | null>;
	readonly openWorkspaceFile?: MarkdownWorkspaceFileOpener;
	readonly renderPdfPreview?: PdfPreviewRenderer;
	readonly deleteNode?: () => boolean;
}) {
	const nodeTypeName = node.type.name;
	const rendersPdf = isPdfAssetSrc(mediaKindSource(node, decorations));
	const dom = rendersPdf ? createPdfEmbedDom(node) : createImageDom(node);
	dom.addEventListener("pointerdown", suppressMarkdownMediaControlSelection);
	dom.addEventListener("mousedown", suppressMarkdownMediaControlSelection);
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
		update: (nextNode: any, nextDecorations: readonly Decoration[]) => {
			if (nextNode.type.name !== nodeTypeName) return false;
			const kindSource = mediaKindSource(nextNode, nextDecorations);
			if (isPdfAssetSrc(kindSource) !== rendersPdf) return false;
			// A source edit can turn this asset into a video — rebuild as the
			// video node view instead of updating in place.
			if (isVideoAssetSrc(kindSource)) return false;
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
			dom.removeEventListener(
				"pointerdown",
				suppressMarkdownMediaControlSelection,
			);
			dom.removeEventListener(
				"mousedown",
				suppressMarkdownMediaControlSelection,
			);
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
	if (!image) return;
	// A new picture is measured afresh; the mark below is about the one that
	// was there.
	delete image.dataset.markdownImageSizeless;
	image.src = src;
	markSizelessImage(image);
	image.addEventListener("load", () => markSizelessImage(image), {
		once: true,
	});
}

/**
 * An SVG written without width and height has no intrinsic size, and the
 * embed sizes itself to its image: the two agree on nothing and the picture
 * lands at zero by zero — loaded, and invisible. Marked, it takes the size a
 * replaced element gets when it brings none of its own.
 */
function markSizelessImage(image: HTMLImageElement): void {
	if (!image.complete) return;
	// Only ever set: the mark is what gives the picture its size, so asking
	// again afterwards would find a sized picture and take it away again.
	if (image.getBoundingClientRect().width === 0)
		image.dataset.markdownImageSizeless = "";
}

function markdownImageElement(dom: HTMLElement): HTMLImageElement | null {
	return dom instanceof HTMLImageElement
		? dom
		: dom.querySelector<HTMLImageElement>(".markdown-image-block-content");
}

function createAssetDeleteButton(
	label: "image" | "PDF embed" | "video embed",
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
