/**
 * Callouts: GitHub's alerts (`> [!NOTE]`) and Obsidian's callouts
 * (`> [!tip]- Title`), which are the same syntax. The file keeps a quote
 * whose first line is the marker; the editor shows a callout node whose
 * marker is its attributes and whose title is its first line. This module
 * is DOM-free: the static render reads it too.
 */

/** The five kinds GitHub renders. Every other word is Obsidian's. */
export const CALLOUT_KINDS = [
	"note",
	"tip",
	"important",
	"warning",
	"caution",
] as const;

export type CalloutFamily = (typeof CALLOUT_KINDS)[number] | "default";

export type CalloutFold = "+" | "-" | null;

export type CalloutMarker = {
	/** The word as written, `NOTE` or `note`, so a save keeps its case. */
	readonly marker: string;
	readonly kind: string;
	readonly fold: CalloutFold;
	/** Characters the marker took up, the space before a title included. */
	readonly length: number;
};

/**
 * `[!word]`, an optional fold sign, then the end of the line or a space
 * before the title. Obsidian allows any word; GitHub renders five of them
 * and shows the others as a quote, which is still what the file says.
 */
const MARKER = /^\[!([A-Za-z][\w-]*)\]([+-])?(?:[ \t]+|$)/;

export function parseCalloutMarker(text: string): CalloutMarker | null {
	const match = MARKER.exec(text);
	if (!match) return null;
	return {
		marker: match[1]!,
		kind: match[1]!.toLowerCase(),
		fold: (match[2] as "+" | "-" | undefined) ?? null,
		length: match[0].length,
	};
}

export function calloutMarkerText(attrs: {
	readonly marker?: string | null;
	readonly kind?: string | null;
	readonly fold?: CalloutFold | string | null;
}): string {
	const word = attrs.marker || (attrs.kind ?? "note").toUpperCase();
	const fold = attrs.fold === "+" || attrs.fold === "-" ? attrs.fold : "";
	return `[!${word}]${fold}`;
}

/**
 * Obsidian's aliases take the colour of the GitHub kind they mean; a word
 * with no family is grey and keeps its own name as the title.
 */
const FAMILIES: Record<string, CalloutFamily> = {
	note: "note",
	info: "note",
	todo: "note",
	abstract: "note",
	summary: "note",
	tldr: "note",
	tip: "tip",
	hint: "tip",
	success: "tip",
	check: "tip",
	done: "tip",
	important: "important",
	warning: "warning",
	attention: "warning",
	question: "warning",
	help: "warning",
	faq: "warning",
	caution: "caution",
	danger: "caution",
	error: "caution",
	failure: "caution",
	fail: "caution",
	missing: "caution",
	bug: "caution",
};

export function calloutFamily(kind: string | null | undefined): CalloutFamily {
	return FAMILIES[(kind ?? "").toLowerCase()] ?? "default";
}

/** What an untitled callout shows: `Note`, or `Example` for `[!example]`. */
export function calloutLabel(kind: string | null | undefined): string {
	const word = (kind ?? "").trim() || "note";
	return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Lucide's icon for each family, as stroke paths on a 24px grid. */
export const CALLOUT_ICON_PATHS: Record<CalloutFamily, readonly string[]> = {
	// info
	note: ["M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20", "M12 16v-4", "M12 8h.01"],
	// lightbulb
	tip: [
		"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5",
		"M9 18h6",
		"M10 22h4",
	],
	// message-square-warning
	important: [
		"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
		"M12 7v2",
		"M12 13h.01",
	],
	// triangle-alert
	warning: [
		"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
		"M12 9v4",
		"M12 17h.01",
	],
	// octagon-alert
	caution: [
		"M12 16h.01",
		"M12 8v4",
		"M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z",
	],
	// message-square
	default: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
};

/** The icon as SVG markup, for the static render and the editor alike. */
export function calloutIconSvg(family: CalloutFamily): string {
	const paths = CALLOUT_ICON_PATHS[family]
		.map((d) => `<path d="${d}"></path>`)
		.join("");
	return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
