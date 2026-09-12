import type { CsvRow } from "./csv-data";
import type { CsvColumnInfo } from "./csv-metadata";
import { CSV_COLOR_FALLBACKS } from "./csv-palette";

/**
 * Column info the grid renders with. Metadata wins; a column without any
 * carries a kind inferred from its values, marked `inferred` so editing,
 * filters, and property menus keep treating it as the plain CSV text it is.
 */
export type CsvDisplayColumnInfo = CsvColumnInfo & { inferred?: boolean };

/** Rows sampled per column; enough for a stable read, cheap on large files. */
export const CSV_INFER_ROW_LIMIT = 500;
/** A select needs a small vocabulary that actually repeats. */
const SELECT_MAX_OPTIONS = 12;
const SELECT_MAX_LENGTH = 24;
const SELECT_MIN_REPEATS = 2;
/** Text whose typical value runs past this wraps into taller rows. */
const WRAP_MEDIAN_LENGTH = 60;

const BOOLEAN_WORD = /^(yes|no|true|false)$/i;
const BOOLEAN_ANY = /^(yes|no|true|false|1|0)$/i;
const NUMBER = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?$/;
const ISO_DATE =
	/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[-+]\d{2}:?\d{2})?)?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL = /^https?:\/\/\S+$/i;

// Gray is the "no colour" colour and sinks into a hovered row, so an
// inferred value always gets a hue; gray stays for declared options.
const PALETTE_NAMES = (
	Object.keys(CSV_COLOR_FALLBACKS) as Array<keyof typeof CSV_COLOR_FALLBACKS>
).filter((name) => name !== "gray");

/** Stable per value, so a chip keeps its colour across files and reloads. */
export function inferredOptionColor(value: string): string {
	let hash = 0;
	for (const char of value) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
	return PALETTE_NAMES[hash % PALETTE_NAMES.length]!;
}

export type InferredColumnKind = Pick<
	CsvColumnInfo,
	"type" | "options" | "wrap"
>;

/** The kind a column's filled values agree on; `text` when they don't. */
export function inferColumnKind(values: readonly string[]): InferredColumnKind {
	const filled = values.map((value) => value.trim()).filter(Boolean);
	if (filled.length === 0) return { type: "text" };
	const every = (test: RegExp) => filled.every((value) => test.test(value));
	// 0/1 alone is a numeric column; a checkbox needs a spelled-out boolean.
	if (every(BOOLEAN_ANY) && filled.some((value) => BOOLEAN_WORD.test(value)))
		return { type: "checkbox" };
	if (every(NUMBER)) return { type: "number" };
	if (every(ISO_DATE)) return { type: "date" };
	if (every(EMAIL)) return { type: "email" };
	if (every(URL)) return { type: "url" };
	const distinct = [...new Set(filled)];
	if (
		distinct.length <= SELECT_MAX_OPTIONS &&
		filled.length - distinct.length >= SELECT_MIN_REPEATS &&
		distinct.every((value) => value.length <= SELECT_MAX_LENGTH)
	)
		return {
			type: "select",
			options: distinct.map((value) => ({
				value,
				color: inferredOptionColor(value),
			})),
		};
	const lengths = filled.map((value) => value.length).sort((a, b) => a - b);
	const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
	return median > WRAP_MEDIAN_LENGTH
		? { type: "text", wrap: true }
		: { type: "text" };
}

/** Display info for every column: metadata where it exists, inference elsewhere. */
export function inferColumnInfo(
	headers: readonly string[],
	rows: readonly CsvRow[],
	resolved: readonly (CsvColumnInfo | undefined)[],
): CsvDisplayColumnInfo[] {
	const sample = rows.slice(0, CSV_INFER_ROW_LIMIT);
	return headers.map((header, index) => {
		const known = resolved[index];
		if (known) return known;
		return {
			id: `inferred:${index}`,
			header,
			index,
			...inferColumnKind(sample.map((row) => row.cells[index] ?? "")),
			inferred: true,
		};
	});
}
