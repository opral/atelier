import type { JSONContent } from "@tiptap/core";
// The concrete module, never the bridge barrel: the barrel carries the
// editor extensions, and this file runs where there is no DOM.
import {
	calloutFamily,
	calloutIconSvg,
	calloutLabel,
} from "../editor/tiptap-markdown-bridge/callout";

/**
 * Serializes a review document to standalone HTML.
 *
 * The editor paints a review with ProseMirror decorations, which exist only
 * while a view is mounted. A card in a chat has no editor, so the same review
 * document is written out directly, carrying the attributes the decorations
 * would have set — `data-review-status` on a node, a wrapping span on marked
 * text — so one stylesheet dresses both surfaces.
 */

export type ReviewStatus = "added" | "removed" | "modified" | "format";

export type MarkdownDiffStats = {
	/** Blocks that exist only after: new paragraphs, list items, table rows. */
	readonly added: number;
	/** Blocks that existed only before. */
	readonly removed: number;
	/** Blocks kept on both sides whose text or attributes changed. */
	readonly modified: number;
};

const VOID_BLOCKS = new Set(["horizontalRule", "image", "imageBlock"]);
/** Blocks that count as one line of the change in the summary. */
const COUNTED_BLOCKS = new Set([
	"paragraph",
	"heading",
	"calloutTitle",
	"listItem",
	"taskItem",
	"codeBlock",
	"tableRow",
	"horizontalRule",
	"image",
	"imageBlock",
	"markdownUnsupported",
	"markdownFrontmatter",
]);

export function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/** Where an image points, said plainly: a host, or the kind of data URI. */
function imageHost(source: string): string | null {
	if (/^data:image\//i.test(source)) return "embedded image";
	const match = /^https?:\/\/([^/?#]+)/i.exec(source);
	if (match?.[1]) return match[1];
	return source ? source.slice(0, 60) : null;
}

function reviewStatus(node: JSONContent): ReviewStatus | null {
	const data = node.attrs?.data as Record<string, unknown> | null | undefined;
	const review = data?.markdownReview as
		| { status?: unknown; hidden?: unknown }
		| undefined;
	// A serialization-only change (`[!NOTE]` spelled `[!note]`, a list
	// loosened by a blank line) reads exactly as it did: the editor leaves
	// it unpainted, and so does a card.
	if (review?.hidden === true) return null;
	const status = review?.status;
	return status === "added" ||
		status === "removed" ||
		status === "modified" ||
		status === "format"
		? status
		: null;
}

function markStatus(node: JSONContent): ReviewStatus | null {
	for (const mark of node.marks ?? []) {
		if (mark.type !== "markdownReviewDiff") continue;
		const status = (mark.attrs as { status?: unknown } | undefined)?.status;
		if (status === "added" || status === "removed") return status;
	}
	return null;
}

/** True when this node, or anything under it, is marked. */
export function carriesChange(node: JSONContent): boolean {
	if (reviewStatus(node) || markStatus(node)) return true;
	return (node.content ?? []).some(carriesChange);
}

export function countMarkdownDiff(doc: JSONContent): MarkdownDiffStats {
	let added = 0;
	let removed = 0;
	let modified = 0;
	const walk = (
		node: JSONContent,
		parentType: string | null,
		index: number,
		inherited: ReviewStatus | null,
		parentOwn: ReviewStatus | null,
	): void => {
		// A callout is a frame, not a line: a change of its kind or fold
		// counts once, on its title, the line the reader sees it on.
		const own =
			reviewStatus(node) ??
			(node.type === "calloutTitle" && parentType === "callout"
				? parentOwn
				: null);
		const status = own ?? inherited;
		if (isCountedLine(node, parentType, index)) {
			if (status === "added") added += 1;
			else if (status === "removed") removed += 1;
			// A node's own "modified"/"format" is a change the reader can see —
			// a ticked task, a re-levelled heading, an edited code block — and
			// counts once, on the node that carries it rather than on every
			// child that inherits it.
			else if (own === "modified" || own === "format" || hasMarkedText(node))
				modified += 1;
		}
		for (const [childIndex, child] of (node.content ?? []).entries())
			walk(child, node.type ?? null, childIndex, status, reviewStatus(node));
	};
	walk(doc, null, 0, null, null);
	return { added, removed, modified };
}

/**
 * One line of the change, as a reader counts them. A list item's leading
 * paragraph is the item's own text, not a line of its own; everything else
 * that holds text stands on its own line, nested items included.
 */
export function isCountedLine(
	node: JSONContent,
	parentType: string | null,
	index: number,
): boolean {
	if (!COUNTED_BLOCKS.has(node.type ?? "")) return false;
	// An image inside a sentence is part of that sentence's line; only the
	// block form stands on its own.
	if (node.type === "image" && parentType === "paragraph") return false;
	return !(
		node.type === "paragraph" &&
		index === 0 &&
		(parentType === "listItem" || parentType === "taskItem")
	);
}

/** Marked text belonging to this line, stopping before any line below it. */
function hasMarkedText(node: JSONContent): boolean {
	const search = (
		candidate: JSONContent,
		parentType: string | null,
		index: number,
	): boolean => {
		if (candidate !== node && isCountedLine(candidate, parentType, index))
			return false;
		if (markStatus(candidate)) return true;
		return (candidate.content ?? []).some((child, childIndex) =>
			search(child, candidate.type ?? null, childIndex),
		);
	};
	return search(node, null, 0);
}

export type RenderOptions = {
	/**
	 * "describe" names an image and where it points; "embed" writes the
	 * <img>. A card renders in the reader's client, and a document's image
	 * URL is chosen by whoever wrote the document: embedding it makes the
	 * reader's client call that address. Default "describe".
	 */
	readonly images?: "describe" | "embed";
};

export function renderReviewHtml(
	doc: JSONContent,
	options: RenderOptions = {},
): string {
	return (doc.content ?? []).map((node) => renderNode(node, options)).join("");
}

function attributes(node: JSONContent, extra: string[] = []): string {
	const status = reviewStatus(node);
	const parts = [...extra];
	if (status) parts.push(`data-review-status="${status}"`);
	return parts.length ? ` ${parts.join(" ")}` : "";
}

function renderChildren(node: JSONContent, options: RenderOptions): string {
	const children = node.content ?? [];
	const parts: string[] = [];
	for (let index = 0; index < children.length; index += 1) {
		const child = children[index]!;
		// `pnpm run build` with one edited word arrives as three text nodes, all
		// carrying the code mark. The document has one code span there, so the
		// card draws one: the run is wrapped once and the diff marks sit inside.
		if (hasCodeMark(child)) {
			const run: JSONContent[] = [];
			while (index < children.length && hasCodeMark(children[index]!)) {
				run.push(children[index]!);
				index += 1;
			}
			index -= 1;
			parts.push(
				`<code>${run.map((member) => renderText(member, { insideCode: true })).join("")}</code>`,
			);
			continue;
		}
		parts.push(renderNode(child, options));
	}
	return parts.join("");
}

function hasCodeMark(node: JSONContent): boolean {
	return (
		node.type === "text" &&
		(node.marks ?? []).some((mark) => mark.type === "code")
	);
}

function renderNode(node: JSONContent, options: RenderOptions): string {
	switch (node.type) {
		case "text":
			return renderText(node);
		case "hardBreak":
			return "<br>";
		case "paragraph": {
			const inner = renderChildren(node, options);
			// An empty paragraph is Atelier's invisible anchor, not a blank line
			// the reader should see marked.
			if (!inner) return `<p${attributes(node)}><br></p>`;
			return `<p${attributes(node)}>${inner}</p>`;
		}
		case "heading": {
			const level = Math.min(
				6,
				Math.max(1, Number(node.attrs?.level ?? 1) || 1),
			);
			return `<h${level}${attributes(node)}>${renderChildren(node, options)}</h${level}>`;
		}
		case "bulletList":
		case "orderedList": {
			const tag = node.type === "orderedList" ? "ol" : "ul";
			const start =
				node.type === "orderedList" && typeof node.attrs?.start === "number"
					? [`start="${node.attrs.start}"`]
					: [];
			const task =
				node.attrs?.isTaskList === true ? ['data-task-list="true"'] : [];
			return `<${tag}${attributes(node, [...start, ...task])}>${renderChildren(node, options)}</${tag}>`;
		}
		case "listItem":
		case "taskItem": {
			const checked = node.attrs?.checked;
			const task =
				checked === true || checked === false
					? [`data-task="${checked ? "x" : " "}"`]
					: [];
			// The box is the same element the editor draws, inert: one rule in
			// document.css styles both.
			const box =
				task.length > 0
					? `<input type="checkbox" disabled${checked ? " checked" : ""}>`
					: "";
			return `<li${attributes(node, task)}>${box}${renderChildren(node, options)}</li>`;
		}
		case "blockquote":
			return `<blockquote${attributes(node)}>${renderChildren(node, options)}</blockquote>`;
		case "callout":
			return renderCallout(node, options);
		case "codeBlock": {
			const language = node.attrs?.language;
			const languageAttribute =
				typeof language === "string" && language
					? [`data-language="${escapeHtml(language)}"`]
					: [];
			return `<pre${attributes(node, languageAttribute)}><code>${renderCodeText(node, options)}</code></pre>`;
		}
		case "horizontalRule":
			return `<hr${attributes(node)}>`;
		case "table":
			return `<table${attributes(node)}><tbody>${renderChildren(node, options)}</tbody></table>`;
		case "tableRow":
			return `<tr${attributes(node)}>${renderChildren(node, options)}</tr>`;
		case "tableCell":
		case "tableHeader": {
			const header =
				node.attrs?.isHeader === true || node.type === "tableHeader";
			const align = node.attrs?.align;
			const alignment =
				typeof align === "string" && align
					? [`data-align="${escapeHtml(align)}"`]
					: [];
			const tag = header ? "th" : "td";
			return `<${tag}${attributes(node, alignment)}>${renderChildren(node, options)}</${tag}>`;
		}
		case "image":
		case "imageBlock": {
			const source = String(node.attrs?.src ?? "");
			const alt = String(node.attrs?.alt ?? "");
			// Only fully-qualified sources can load from a standalone document;
			// a repository-relative one would resolve against whatever host
			// renders it.
			const loadable = /^(https?:|data:image\/)/i.test(source);
			if (options.images === "embed" && loadable)
				return `<img${attributes(node)} src="${escapeHtml(source)}" alt="${escapeHtml(alt)}">`;
			// Named, not fetched: rendering the tag would have the reader's
			// client call an address the document's author chose.
			const where = imageHost(source);
			const label = alt || "image";
			return `<span class="md-diff-image"${attributes(node)}>${escapeHtml(label)}${where ? ` <span class="md-diff-image-src">${escapeHtml(where)}</span>` : ""}</span>`;
		}
		case "markdownDiffGap": {
			const count = Number(node.attrs?.count ?? 0);
			const of = String(node.attrs?.of ?? "doc");
			// A cut inside a line counts characters, and stands where they were:
			// inline, so it reads as the end of the sentence it shortened.
			if (of === "line")
				return `<span class="md-diff-gap">⋯ ${escapeHtml(
					`${count} more ${count === 1 ? "character" : "characters"}`,
				)}</span>`;
			const inList =
				of === "bulletList" || of === "orderedList" || of === "taskList";
			const lines = count === 1 ? "line" : "lines";
			const label =
				node.attrs?.changed === true
					? `${count} more ${lines}`
					: `${count} unchanged ${lines}`;
			// A table body holds rows and nothing else: a div here would be
			// foster-parented out of the table it describes.
			if (of === "table")
				return `<tr class="md-diff-gap"><td colspan="99">⋯ ${escapeHtml(label)}</td></tr>`;
			const tag = inList ? "li" : "div";
			return `<${tag} class="md-diff-gap">⋯ ${escapeHtml(label)}</${tag}>`;
		}
		case "footnoteRef": {
			const label = footnoteLabel(node);
			return `<sup class="markdown-footnote-ref"${attributes(node)}>[${escapeHtml(label)}]</sup>`;
		}
		case "footnoteDef": {
			const label = footnoteLabel(node);
			return `<div class="markdown-footnote-def"${attributes(node)}><span class="markdown-footnote-def-label">[${escapeHtml(label)}]</span><div class="markdown-footnote-def-body">${renderChildren(node, options)}</div></div>`;
		}
		case "markdownUnsupported":
		case "markdownFrontmatter":
		case "markdownInlineHtml": {
			const value = String(node.attrs?.value ?? "");
			const tag = node.type === "markdownInlineHtml" ? "span" : "pre";
			// Raw source, shown as source: a card never runs a document's HTML.
			return `<${tag} class="md-diff-raw"${attributes(node)}>${escapeHtml(value)}</${tag}>`;
		}
		default:
			return VOID_BLOCKS.has(node.type ?? "")
				? ""
				: `<div${attributes(node)}>${renderChildren(node, options)}</div>`;
	}
}

/**
 * A callout, drawn with the editor's structure and classes so document.css
 * dresses both. The editor shows an untitled callout's kind with a
 * `::before`; here the kind's name is written into the title, so it reads
 * where generated content does not (a mail client, a screen reader). A
 * foldable callout (`[!NOTE]+`, `[!NOTE]-`) is a `<details>` whose summary
 * is the icon and the title: it opens and closes, by keyboard too, with no
 * script.
 */
function renderCallout(node: JSONContent, options: RenderOptions): string {
	const kind = String(node.attrs?.kind ?? "note");
	const family = calloutFamily(kind);
	const fold = node.attrs?.fold;
	const children = node.content ?? [];
	const titleNode = children[0]?.type === "calloutTitle" ? children[0] : null;
	const body = titleNode ? children.slice(1) : children;
	// The kind's name stands in for a title the reader's side leaves empty;
	// a title the change removed still shows, struck, before it.
	const words = titleNode ? renderChildren(titleNode, options) : "";
	const label = hasShownText(titleNode) ? "" : escapeHtml(calloutLabel(kind));
	const title = `${words}${words && label ? " " : ""}${label}${previousKindChip(node)}`;
	const titleAttributes = titleNode ? attributes(titleNode) : "";
	const frame = `class="markdown-callout" data-callout-family="${family}" data-callout-kind="${escapeHtml(kind)}"${attributes(node)}`;
	const icon = `<span class="markdown-callout-icon" aria-hidden="true">${calloutIconSvg(family)}</span>`;
	const bodyHtml = renderChildren({ content: body }, options);
	if (fold === "+" || fold === "-") {
		// A card must not hide the change it exists to show: a folded
		// callout whose body changed renders open.
		const open = fold === "+" || body.some(carriesChange);
		return `<details ${frame}${open ? " open" : ""}><summary class="markdown-callout-summary">${icon}<span class="markdown-callout-title"${titleAttributes}>${title}</span></summary><div class="markdown-callout-content">${bodyHtml}</div></details>`;
	}
	return `<div ${frame} role="note">${icon}<div class="markdown-callout-content"><div class="markdown-callout-title"${titleAttributes}>${title}</div>${bodyHtml}</div></div>`;
}

/** True when the title has text the reader's side keeps. */
function hasShownText(node: JSONContent | null): boolean {
	if (!node) return false;
	return (node.content ?? []).some(
		(child) =>
			markStatus(child) !== "removed" &&
			(child.type !== "text" || (child.text ?? "").trim().length > 0),
	);
}

/**
 * A callout whose kind changed says what it was: a small pill beside the
 * title with the old name struck through. The callout itself already wears
 * its new kind's colour and icon, so the pill is the only place the old one
 * shows.
 */
function previousKindChip(node: JSONContent): string {
	const previous = previousCalloutKind(node);
	if (previous === null) return "";
	const label = escapeHtml(calloutLabel(previous));
	return `<span class="markdown-callout-was" title="Was ${label}">was <s>${label}</s></span>`;
}

/**
 * The kind a callout had before the change, when a reader would see a
 * difference: `NOTE` becoming `note` is the same callout.
 */
export function previousCalloutKind(node: JSONContent): string | null {
	if (reviewStatus(node) !== "modified") return null;
	const data = node.attrs?.data as Record<string, unknown> | null | undefined;
	const review = data?.markdownReview as
		| { originalAttrs?: { kind?: unknown } | null }
		| undefined;
	const before = review?.originalAttrs?.kind;
	if (typeof before !== "string") return null;
	return calloutLabel(before) === calloutLabel(String(node.attrs?.kind ?? ""))
		? null
		: before;
}

function footnoteLabel(node: JSONContent): string {
	const label = node.attrs?.label;
	if (typeof label === "string" && label.length > 0) return label;
	return String(node.attrs?.identifier ?? "");
}

function renderCodeText(node: JSONContent, options: RenderOptions): string {
	const text = (node.content ?? [])
		.map((child) =>
			child.type === "text"
				? escapeHtml(child.text ?? "")
				: renderNode(child, options),
		)
		.join("");
	// A merged code block keeps both revisions in one text node and says which
	// offsets belong to which side. Without that, the card shows the old line
	// and the new line one above the other with nothing telling them apart.
	const ranges = lineRanges(node);
	if (ranges.length === 0) return text;
	const source = (node.content ?? [])
		.map((child) => (child.type === "text" ? (child.text ?? "") : ""))
		.join("");
	const parts: string[] = [];
	let cursor = 0;
	for (const range of ranges) {
		const from = Math.max(cursor, Math.min(range.from, source.length));
		const to = Math.max(from, Math.min(range.to, source.length));
		if (from > cursor) parts.push(escapeHtml(source.slice(cursor, from)));
		if (to > from)
			parts.push(
				`<span data-review-status="${range.status}">${escapeHtml(source.slice(from, to))}</span>`,
			);
		cursor = to;
	}
	if (cursor < source.length) parts.push(escapeHtml(source.slice(cursor)));
	return parts.join("");
}

/** A merged code block's one-sided lines, as offsets into its text. */
function lineRanges(
	node: JSONContent,
): Array<{ status: "added" | "removed"; from: number; to: number }> {
	const data = node.attrs?.data as Record<string, unknown> | null | undefined;
	const review = data?.markdownReview as { lineRanges?: unknown } | undefined;
	if (!Array.isArray(review?.lineRanges)) return [];
	return review.lineRanges.flatMap((candidate) => {
		const range = candidate as {
			status?: unknown;
			from?: unknown;
			to?: unknown;
		};
		return (range.status === "added" || range.status === "removed") &&
			typeof range.from === "number" &&
			typeof range.to === "number"
			? [{ status: range.status, from: range.from, to: range.to }]
			: [];
	});
}

const MARK_TAGS: Record<string, { open: string; close: string }> = {
	bold: { open: "<strong>", close: "</strong>" },
	italic: { open: "<em>", close: "</em>" },
	strike: { open: "<s>", close: "</s>" },
	code: { open: "<code>", close: "</code>" },
};

function renderText(
	node: JSONContent,
	context: { insideCode?: boolean } = {},
): string {
	let html = escapeHtml(node.text ?? "");
	for (const mark of node.marks ?? []) {
		if (context.insideCode && mark.type === "code") continue;
		const tags = MARK_TAGS[mark.type ?? ""];
		if (tags) html = `${tags.open}${html}${tags.close}`;
		else if (mark.type === "link") {
			const href = String(mark.attrs?.href ?? "");
			// Only navigable schemes; a card must not carry javascript: through.
			const safe = /^(https?:|mailto:|#|\/(?!\/))/i.test(href);
			html = safe
				? `<a href="${escapeHtml(href)}" rel="noreferrer noopener">${html}</a>`
				: html;
		}
	}
	const status = markStatus(node);
	return status ? `<span data-review-status="${status}">${html}</span>` : html;
}
