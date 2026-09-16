import type {
	NotRendered,
	Rendered,
	RenderOptions,
	StaticRenderer,
} from "../../../render/types";
import { fileText } from "../../../lib/decode-file-data";
import { renderMarkdownDiff, renderMarkdownDocument } from "./index";

/**
 * The Markdown view, rendered without a shell.
 *
 * The same review the editor draws — the same document alignment, the same
 * marks, the same palette — serialized instead of decorated, so a change
 * reads the same in a chat as it does in the app.
 */

/** Bytes a render will parse. Parsing walks the document, not the change. */
const MAX_SOURCE_BYTES = 100_000;

/**
 * Nesting a parser walks by recursion, and a document is written by whoever
 * opened the chat. A hundred levels of quote or list is not a document anyone
 * reads; it is a stack the server would rather keep.
 */
const MAX_NESTING = 24;

/** Lines kept per list, table or document before the budget trims. */
const DEFAULT_MAX_LINES = 14;

export const markdownStaticRenderer: StaticRenderer = {
	fileExtensions: ["md", "markdown", "mdx"],
	render(content, options): Rendered | NotRendered {
		const before = content.before === undefined ? "" : fileText(content.before);
		const after = content.after === undefined ? "" : fileText(content.after);
		if (before === null || after === null) return { skipped: "unsupported" };
		if (
			byteLength(before) > MAX_SOURCE_BYTES ||
			byteLength(after) > MAX_SOURCE_BYTES
		)
			return { skipped: "too-large" };
		if (tooDeep(before) || tooDeep(after)) return { skipped: "too-large" };

		// One side only: the document as it stands, or as it stood.
		if (content.kind === "added" || content.kind === "removed") {
			const source = content.kind === "added" ? after : before;
			if (source.trim() === "") return { skipped: "empty" };
			const html = scoped(renderMarkdownDocument(source, imageOption(options)));
			const counts = lineCount(html);
			return {
				kind: content.kind,
				html,
				counts:
					content.kind === "added"
						? { added: counts, modified: 0, removed: 0 }
						: { added: 0, modified: 0, removed: counts },
				hidden: 0,
			};
		}

		const diff = renderMarkdownDiff({
			beforeMarkdown: before,
			afterMarkdown: after,
			context: 1,
			maxLines: lineBudget(options.maxBytes),
			...imageOption(options),
		});
		if (diff.unchanged) return { skipped: "unchanged" };
		return {
			kind: "modified",
			html: scoped(diff.html),
			counts: {
				added: diff.stats.added,
				modified: diff.stats.modified,
				removed: diff.stats.removed,
			},
			hidden: diff.hidden,
		};
	},
};

/** The view's own scope, so a caller never has to know its class name. */
function scoped(html: string): string {
	// `atelier-document` is the stylesheet's scope, shared with the editor;
	// `md-diff` is the render's own chrome.
	return `<div class="md-diff atelier-document">${html}</div>`;
}

function imageOption(options: RenderOptions): {
	images?: "describe" | "embed";
} {
	return options.images ? { images: options.images } : {};
}

/**
 * Lines a container may keep, from the caller's byte budget.
 *
 * A rendered line of prose runs to a couple of hundred bytes once it carries
 * tags; the divisor is deliberately generous, because a budget that is missed
 * costs a second render and a budget that is met early costs a gap note.
 */
function lineBudget(maxBytes: number | undefined): number {
	if (maxBytes === undefined) return DEFAULT_MAX_LINES;
	return Math.max(3, Math.min(DEFAULT_MAX_LINES, Math.floor(maxBytes / 900)));
}

function lineCount(html: string): number {
	return (html.match(/<(?:li|p|h[1-6]|tr|pre)\b/g) ?? []).length;
}

function byteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

function tooDeep(markdown: string): boolean {
	for (const line of markdown.split("\n")) {
		const quotes = (/^[\s>]*/.exec(line)?.[0] ?? "").split(">").length - 1;
		const indent = (/^[ \t]*/.exec(line)?.[0] ?? "").length;
		if (quotes > MAX_NESTING || indent / 2 > MAX_NESTING) return true;
	}
	return false;
}
