export const CSV_COLOR_FALLBACKS = {
	gray: ["#eeedeb", "#44403c"],
	brown: ["#eee3da", "#60432e"],
	orange: ["#fae8d4", "#783d10"],
	yellow: ["#f6efc9", "#604900"],
	green: ["#dfece3", "#285238"],
	blue: ["#deebf7", "#294d69"],
	purple: ["#ebe2f3", "#583c70"],
	pink: ["#f5e0ec", "#693b53"],
	red: ["#f8e0de", "#7b332f"],
} as const;
export type CsvPalette = Record<
	keyof typeof CSV_COLOR_FALLBACKS,
	readonly [string, string]
>;
export const CSV_COLORS = Object.fromEntries(
	Object.entries(CSV_COLOR_FALLBACKS).map(([name, [bg, fg]]) => [
		name,
		[
			`var(--color-bg-tag-${name}, ${bg})`,
			`var(--color-text-tag-${name}, ${fg})`,
		],
	]),
) as unknown as CsvPalette;
