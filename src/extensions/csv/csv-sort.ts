import type { CsvColumnInfo } from "./csv-metadata";

/** Keep numeric and nonnumeric groups consistent so comparison is transitive. */
export function compareCsvValues(
	a: string,
	b: string,
	type?: CsvColumnInfo["type"],
	options?: CsvColumnInfo["options"],
): number {
	// Select values sort in their option order, the way the picker lists
	// them; values without an option definition follow, alphabetically.
	if (type === "select" && options && options.length > 0) {
		const aIndex = options.findIndex((option) => option.value === a);
		const bIndex = options.findIndex((option) => option.value === b);
		if (aIndex !== -1 || bIndex !== -1) {
			if (aIndex === -1) return 1;
			if (bIndex === -1) return -1;
			if (aIndex !== bIndex) return aIndex - bIndex;
		}
	}
	if (type === "number") {
		const aIsNumber = a.trim() !== "" && Number.isFinite(Number(a));
		const bIsNumber = b.trim() !== "" && Number.isFinite(Number(b));
		if (aIsNumber && bIsNumber) return Number(a) - Number(b);
		if (aIsNumber !== bIsNumber) return aIsNumber ? -1 : 1;
	}
	return a.localeCompare(b, undefined, { numeric: true });
}
