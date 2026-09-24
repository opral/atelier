/** Shared layout for measuring rows and painting text, including explicit newlines. */
export type CsvTextLine = { text: string; start: number; end: number };
export const CSV_TEXT_LINE_HEIGHT = 20;
export const CSV_TEXT_VERTICAL_PADDING = 10;
export const CSV_TEXT_HORIZONTAL_PADDING = 8.5;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Where a word may break besides whitespace, as Chromium breaks it: after a
 * hyphen inside a word ("non-|engineers", "2026-|09-10", never after a
 * word's leading hyphen, "-5"), and after a question or exclamation mark
 * before a letter ("path?|query").
 */
const WORD_BREAK = /(?<=[\p{L}\p{N}]-)(?=[\p{L}\p{N}])|(?<=[?!])(?=\p{L})/u;

/**
 * Lays text out in lines the way the cell editor's textarea does
 * (`white-space: pre-wrap; overflow-wrap: anywhere`), so the canvas and the
 * editor that opens over it break at the same places and clicking into a
 * cell moves no word.
 */
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
	for (const run of text.match(/\r\n|\r|\n|[^\S\r\n]+|[^\s]+/gu) ?? []) {
		if (/^(\r\n|\r|\n)$/.test(run)) {
			push();
			start += run.length;
			continue;
		}
		// A space at a soft break hangs off the end of the line, as it does in
		// CSS: it never pushes the next word down.
		if (line && /^\s+$/.test(run)) {
			line += run;
			continue;
		}
		for (const token of run.split(WORD_BREAK)) {
			// The space between the words is part of the line the word joins.
			if (line && measure(line + token) > width) push();
			if (measure(token) <= width) {
				line += token;
				continue;
			}
			// A word wider than the cell starts a line of its own and only then
			// breaks between graphemes (`overflow-wrap: anywhere`).
			if (line.trim()) push();
			for (const { segment } of graphemes.segment(token)) {
				if (line && measure(line + segment) > width) push();
				line += segment;
			}
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
