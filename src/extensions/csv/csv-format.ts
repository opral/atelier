import { parse } from "papaparse";

/**
 * Detects the delimiter and dominant newline via a Papa Parse preview pass.
 * Detection skips empty lines: with them included, a trailing newline drags
 * the average field count under Papa Parse's guessing threshold and every
 * non-comma file falls back to a single comma-delimited column.
 */
export function detectCsvFormat(text: string): {
	delimiter: string;
	newline: "\n" | "\r\n" | "\r";
} {
	if (text.length === 0) return { delimiter: ",", newline: "\n" };
	const result = parse<string[]>(text, { preview: 10, skipEmptyLines: true });
	const delimiter =
		typeof result.meta.delimiter === "string" &&
		result.meta.delimiter.length === 1
			? result.meta.delimiter
			: ",";
	const newline =
		result.meta.linebreak === "\r\n" || result.meta.linebreak === "\r"
			? result.meta.linebreak
			: "\n";
	return { delimiter, newline };
}

export function normalizeCsvHeaders(
	headerRow: readonly string[],
	columnCount: number,
): string[] {
	const bases = Array.from(
		{ length: columnCount },
		(_, index) => headerRow[index]?.trim() || `Column ${index + 1}`,
	);
	const reserved = new Set(bases);
	const used = new Set<string>();
	return bases.map((base) => {
		let name = base;
		let suffix = 2;
		while (used.has(name)) {
			do {
				name = `${base} ${suffix++}`;
			} while (reserved.has(name));
		}
		used.add(name);
		return name;
	});
}
