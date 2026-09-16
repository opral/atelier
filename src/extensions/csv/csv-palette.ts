export const CSV_COLOR_FALLBACKS = {
	gray: ["#e9e7e4", "#44403c"], // token-literal: canvas fallback for --at-tag-gray, --at-tag-gray-fg
	brown: ["#eee3da", "#60432e"], // token-literal: canvas fallback for --at-tag-brown, --at-tag-brown-fg
	orange: ["#fae8d4", "#783d10"], // token-literal: canvas fallback for --at-tag-orange, --at-tag-orange-fg
	yellow: ["#f6efc9", "#604900"], // token-literal: canvas fallback for --at-tag-yellow, --at-tag-yellow-fg
	green: ["#dfece3", "#285238"], // token-literal: canvas fallback for --at-tag-green, --at-tag-green-fg
	blue: ["#deebf7", "#294d69"], // token-literal: canvas fallback for --at-tag-blue, --at-tag-blue-fg
	purple: ["#ebe2f3", "#583c70"], // token-literal: canvas fallback for --at-tag-purple, --at-tag-purple-fg
	pink: ["#f5e0ec", "#693b53"], // token-literal: canvas fallback for --at-tag-pink, --at-tag-pink-fg
	red: ["#f8e0de", "#7b332f"], // token-literal: canvas fallback for --at-tag-red, --at-tag-red-fg
} as const;
export type CsvPalette = Record<
	keyof typeof CSV_COLOR_FALLBACKS,
	readonly [string, string]
>;
export const CSV_COLORS = Object.fromEntries(
	Object.entries(CSV_COLOR_FALLBACKS).map(([name, [bg, fg]]) => [
		name,
		[`var(--at-tag-${name}, ${bg})`, `var(--at-tag-${name}-fg, ${fg})`],
	]),
) as unknown as CsvPalette;
