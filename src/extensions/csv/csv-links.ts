import {
	CSV_TEXT_HORIZONTAL_PADDING,
	CSV_TEXT_LINE_HEIGHT,
	CSV_TEXT_VERTICAL_PADDING,
	type CsvTextLine,
} from "./csv-text-wrap";

const HTTP_URL = /^https?:\/\/[^\s/?#]+\S*$/i;
const EMAIL = /^[^\s@:/]+@[^\s@]+\.[^\s@]+$/;
const MAILTO = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i;
/** `example.com/path`: what a URL property holds when the scheme was left off. */
const BARE_DOMAIN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i;

/**
 * Where a cell's value leads, or null. Only http(s) and mailto are links:
 * a value is data an agent or an import wrote, and a `javascript:` or
 * `file:` value must never become something a click follows.
 *
 * - URL properties link http(s) values, mailto and bare addresses, and a
 *   bare domain as https (Notion's reading of `example.com`).
 * - Email properties link an address as mailto.
 * - Text (declared or inferred, and a column with no type) links a value
 *   that is one whole http(s) or mailto URL; an inferred text column keeps
 *   linking a bare address too, as it did before.
 * - Select, checkbox, date, and number values are never links.
 */
export function csvCellLinkUrl(
	value: string,
	type: string | undefined,
	inferred = false,
): string | null {
	const text = value.trim();
	if (!text) return null;
	if (HTTP_URL.test(text) || MAILTO.test(text)) {
		return type === undefined ||
			type === "text" ||
			type === "url" ||
			type === "email"
			? text
			: null;
	}
	if (EMAIL.test(text)) {
		return type === "email" || type === "url" || (type === "text" && inferred)
			? `mailto:${text}`
			: null;
	}
	if (type === "url" && BARE_DOMAIN.test(text)) return `https://${text}`;
	return null;
}

export type CsvLinkBox = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

/**
 * Where a link cell's text is, relative to the cell: one box per line the
 * canvas draws, each as wide as that line's text (never past the cell's
 * padding). The link is the text, not the cell — a press beside it selects
 * or edits the cell, as in Notion.
 */
export function csvLinkBoxes(
	cell: {
		readonly text: string;
		readonly wrappedLines?: readonly CsvTextLine[];
	},
	size: { readonly width: number; readonly height: number },
	measure: (text: string) => number,
): CsvLinkBox[] {
	const maxWidth = Math.max(0, size.width - CSV_TEXT_HORIZONTAL_PADDING * 2);
	const box = (text: string, y: number): CsvLinkBox => ({
		x: CSV_TEXT_HORIZONTAL_PADDING,
		y,
		width: Math.min(maxWidth, measure(text.replace(/\s+$/u, ""))),
		height: CSV_TEXT_LINE_HEIGHT,
	});
	const lines = cell.wrappedLines;
	if (!lines || lines.length === 0)
		return [box(cell.text, (size.height - CSV_TEXT_LINE_HEIGHT) / 2)];
	const top = Math.max(
		CSV_TEXT_VERTICAL_PADDING,
		(size.height - lines.length * CSV_TEXT_LINE_HEIGHT) / 2,
	);
	return lines
		.map((line, index) => box(line.text, top + index * CSV_TEXT_LINE_HEIGHT))
		.filter((line) => line.width > 0 && line.y < size.height);
}

/** Whether a point in the cell is on its link text, with a little slack. */
export function csvLinkHit(
	boxes: readonly CsvLinkBox[],
	x: number | undefined,
	y: number | undefined,
): boolean {
	if (x === undefined || y === undefined) return false;
	return boxes.some(
		(box) =>
			x >= box.x - 2 &&
			x <= box.x + box.width + 2 &&
			y >= box.y &&
			y <= box.y + box.height,
	);
}

/** Opens a link the way a Notion cell does: a new tab, no opener, no referrer. */
export function openCsvLink(url: string): void {
	window.open(url, "_blank", "noopener,noreferrer");
}
