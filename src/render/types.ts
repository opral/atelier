/**
 * What a static render takes and gives back.
 *
 * Atelier's views normally mount: they hold a Lix handle, draw into the DOM,
 * and remember where they are. A static render is the same view with none of
 * that — content in, HTML out — for a surface that has no shell in it: a card
 * in a chat, a mail, a page rendered on a server.
 */

/**
 * A file to show, as bytes, because that is what a Lix file is.
 *
 * Which side is missing says what happened: no `before` is a file that was
 * created, no `after` is one that was deleted, and both is a change. Bytes
 * also keep "did not exist" distinct from "existed and was empty", which a
 * string cannot.
 */
export type RenderContent = {
	readonly path: string;
	readonly before?: Uint8Array;
	readonly after?: Uint8Array;
};

/** The vocabulary Lix uses for a diff, so a render agrees with `lix_diff`. */
export type RenderKind = "added" | "modified" | "removed";

/** Entities changed, counted the way `lix_diff` counts them. */
export type RenderCounts = {
	readonly added: number;
	readonly modified: number;
	readonly removed: number;
};

export type Rendered = {
	readonly kind: RenderKind;
	/** HTML for an element with class `atelier-render`, or a whole document. */
	readonly html: string;
	/** Absent when the view cannot count its own entities. */
	readonly counts?: RenderCounts;
	/** Entities the budget left out; zero when everything is shown. */
	readonly hidden: number;
};

/**
 * Why there is no render. Not an error: a chat card asking for a PDF, or for
 * a file that did not change, is an ordinary thing to answer.
 */
export type NotRendered = {
	readonly skipped:
		| "unsupported"
		| "unchanged"
		| "empty"
		| "too-large"
		| "failed";
};

export type RenderOptions = {
	/**
	 * Rough ceiling on the HTML, in bytes. A view trims to fit and reports
	 * what it left out; one that cannot fit at all skips with "too-large".
	 */
	readonly maxBytes?: number;
	/** Emit a complete HTML document with the stylesheet inlined. */
	readonly document?: boolean;
	/**
	 * "describe" names an image and where it points; "embed" writes the tag.
	 * A document's image address is chosen by whoever wrote the document, and
	 * embedding it has the reader's client call that address. Default
	 * "describe".
	 */
	readonly images?: "describe" | "embed";
};

/** What a file type implements to be rendered without a shell. */
export type StaticRenderer = {
	readonly fileExtensions: readonly string[];
	readonly render: (
		content: {
			readonly path: string;
			readonly before: Uint8Array | undefined;
			readonly after: Uint8Array | undefined;
			readonly kind: RenderKind;
		},
		options: RenderOptions,
	) => Rendered | NotRendered;
};

export function isRendered(result: Rendered | NotRendered): result is Rendered {
	return "html" in result;
}
