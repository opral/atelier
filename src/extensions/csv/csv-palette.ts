export const CSV_COLOR_FALLBACKS = {
	gray: ["#e9e7e4", "#44403c"], // token-literal: canvas fallback for --atelier-tag-gray, --atelier-tag-gray-fg
	brown: ["#eee3da", "#60432e"], // token-literal: canvas fallback for --atelier-tag-brown, --atelier-tag-brown-fg
	orange: ["#fae8d4", "#783d10"], // token-literal: canvas fallback for --atelier-tag-orange, --atelier-tag-orange-fg
	yellow: ["#f6efc9", "#604900"], // token-literal: canvas fallback for --atelier-tag-yellow, --atelier-tag-yellow-fg
	green: ["#dfece3", "#285238"], // token-literal: canvas fallback for --atelier-tag-green, --atelier-tag-green-fg
	blue: ["#deebf7", "#294d69"], // token-literal: canvas fallback for --atelier-tag-blue, --atelier-tag-blue-fg
	purple: ["#ebe2f3", "#583c70"], // token-literal: canvas fallback for --atelier-tag-purple, --atelier-tag-purple-fg
	pink: ["#f5e0ec", "#693b53"], // token-literal: canvas fallback for --atelier-tag-pink, --atelier-tag-pink-fg
	red: ["#f8e0de", "#7b332f"], // token-literal: canvas fallback for --atelier-tag-red, --atelier-tag-red-fg
} as const;
export type CsvPalette = Record<
	keyof typeof CSV_COLOR_FALLBACKS,
	readonly [string, string]
>;
export const CSV_COLORS = Object.fromEntries(
	Object.entries(CSV_COLOR_FALLBACKS).map(([name, [bg, fg]]) => [
		name,
		[
			`var(--atelier-tag-${name}, ${bg})`,
			`var(--atelier-tag-${name}-fg, ${fg})`,
		],
	]),
) as unknown as CsvPalette;
