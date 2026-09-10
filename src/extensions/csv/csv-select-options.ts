import { inferredOptionColor } from "./csv-infer";
import type { CsvColumnInfo } from "./csv-metadata";

export type CsvSelectOption = {
	readonly value: string;
	readonly color: string;
};

/**
 * The options a select column offers: the declared ones first, in their
 * declared order, then every other value the column actually holds. The
 * CSV is the source of truth for what exists; metadata only adds colour,
 * order, and options no row uses yet. A value written by hand, an agent,
 * or an import is offered everywhere the declared ones are, with a stable
 * colour hashed from the value.
 */
export function selectOptions(
	info: Pick<CsvColumnInfo, "options"> | undefined,
	values: readonly string[],
): CsvSelectOption[] {
	const declared = info?.options ?? [];
	const seen = new Set(declared.map((option) => option.value));
	const observed: string[] = [];
	for (const raw of values) {
		const value = raw.trim();
		if (!value || seen.has(value)) continue;
		seen.add(value);
		observed.push(value);
	}
	observed.sort((left, right) => left.localeCompare(right));
	return [
		...declared,
		...observed.map((value) => ({ value, color: inferredOptionColor(value) })),
	];
}

/** Colour for one value: declared colour, otherwise the stable hash. */
export function selectOptionColor(
	info: Pick<CsvColumnInfo, "options"> | undefined,
	value: string,
): string {
	return (
		info?.options?.find((option) => option.value === value)?.color ??
		inferredOptionColor(value)
	);
}
