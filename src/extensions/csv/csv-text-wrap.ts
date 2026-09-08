/** Shared layout for measuring rows and painting text, including explicit newlines. */
export type CsvTextLine = { text: string; start: number; end: number };
export const CSV_TEXT_LINE_HEIGHT = 20;
export const CSV_TEXT_VERTICAL_PADDING = 10;
export const CSV_TEXT_HORIZONTAL_PADDING = 8.5;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function wrapCsvText(
	text: string,
	width: number,
	measure: (text: string) => number,
): CsvTextLine[] {
	const lines: CsvTextLine[] = [];
	let line = "",
		start = 0;
	const push = () => {
		lines.push({ text: line, start, end: start + line.length });
		start += line.length;
		line = "";
	};
	// Break at whitespace when possible; keep offsets so search matches span lines.
	for (const token of text.match(/\r\n|\r|\n|[^\S\r\n]+|[^\s]+/gu) ?? []) {
		if (/^(\r\n|\r|\n)$/.test(token)) {
			push();
			start += token.length;
			continue;
		}
		if (line && /^\s+$/.test(token)) {
			line += token;
			continue;
		}
		if (line && measure(line + token) > width) push();
		if (measure(token) <= width) {
			line += token;
			continue;
		}
		for (const { segment } of graphemes.segment(token)) {
			if (line && measure(line + segment) > width) push();
			line += segment;
		}
	}
	push();
	return lines;
}

export function csvWrappedRowHeight(lines: number): number {
	return Math.max(
		40,
		lines * CSV_TEXT_LINE_HEIGHT + CSV_TEXT_VERTICAL_PADDING * 2,
	);
}
