import type { CsvColumnInfo } from "./csv-metadata";

/** Keep numeric and nonnumeric groups consistent so comparison is transitive. */
export function compareCsvValues(
	a: string,
	b: string,
	type?: CsvColumnInfo["type"],
): number {
	if (type === "number") {
		const aIsNumber = a.trim() !== "" && Number.isFinite(Number(a));
		const bIsNumber = b.trim() !== "" && Number.isFinite(Number(b));
		if (aIsNumber && bIsNumber) return Number(a) - Number(b);
		if (aIsNumber !== bIsNumber) return aIsNumber ? -1 : 1;
	}
	return a.localeCompare(b, undefined, { numeric: true });
}
