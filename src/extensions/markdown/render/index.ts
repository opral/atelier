import type { JSONContent } from "@tiptap/core";
import { parseMarkdown } from "../editor/markdown";
import { astToTiptapDoc } from "../editor/tiptap-markdown-bridge/mdwc-to-tiptap";
import { buildMarkdownReviewDocument } from "../review/build-review-document";
import { pruneToChanges } from "./prune";
import {
	carriesChange,
	countMarkdownDiff,
	renderReviewHtml,
	type MarkdownDiffStats,
} from "./html";
export type { MarkdownDiffStats };

export type MarkdownDiffOptions = {
	readonly beforeMarkdown: string;
	readonly afterMarkdown: string;
	/** Unchanged lines kept around each change. Default 1. */
	readonly context?: number;
	/** Ceiling on lines kept per list, table or document. Default 14. */
	readonly maxLines?: number;
	/** Skip the trim and render the whole document. */
	readonly full?: boolean;
	/**
	 * "describe" names an image and where it points; "embed" writes the
	 * `<img>`. A document's image address is chosen by whoever wrote the
	 * document, and embedding it has the reader's client call that address.
	 * Default "describe".
	 */
	readonly images?: "describe" | "embed";
};

export type MarkdownDiff = {
	/** The document, marked, ready to drop inside an element with class `md-diff atelier-document`. */
	readonly html: string;
	readonly stats: MarkdownDiffStats;
	/** Lines the trim left out; zero when the card shows everything. */
	readonly hidden: number;
	/** True when the two snapshots render identically. */
	readonly unchanged: boolean;
};

/**
 * Renders the difference between two Markdown snapshots as standalone HTML.
 *
 * This is the review the app shows — the same document builder, the same
 * marks, the same palette — written out for a surface that has no editor in
 * it: a card in a chat, a mail, a page rendered on a server. Pair the HTML
 * with the render stylesheet and put it inside `<div class="md-diff atelier-document">`.
 */
export function renderMarkdownDiff(options: MarkdownDiffOptions): MarkdownDiff {
	const review = buildMarkdownReviewDocument({
		beforeMarkdown: options.beforeMarkdown,
		afterMarkdown: options.afterMarkdown,
	});
	const stats = countMarkdownDiff(review.doc);
	// The document decides this, not the counters: a formatting-only change
	// (emphasis restyled, raw HTML rewritten) is marked and visible without
	// counting as a line.
	const unchanged = !carriesChange(review.doc);
	const { doc, hidden } = options.full
		? { doc: review.doc, hidden: 0 }
		: pruneToChanges(review.doc, {
				...(options.context !== undefined ? { context: options.context } : {}),
				...(options.maxLines !== undefined
					? { maxPerContainer: options.maxLines }
					: {}),
			});
	return {
		html: renderReviewHtml(doc, {
			...(options.images ? { images: options.images } : {}),
		}),
		stats,
		hidden,
		unchanged,
	};
}

/** A whole document as it stands, with no diff: the read-side card. */
export function renderMarkdownDocument(
	markdown: string,
	options: Pick<MarkdownDiffOptions, "images"> = {},
): string {
	return renderReviewHtml(
		astToTiptapDoc(parseMarkdown(markdown)) as JSONContent,
		{
			...(options.images ? { images: options.images } : {}),
		},
	);
}
