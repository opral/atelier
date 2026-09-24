/**
 * The single source of the diff-glyph geometry (design 23d). The React
 * component draws these paths directly; the file tree — a shadow-DOM web
 * component whose row indicator is only styleable, not renderable — applies
 * the same shapes as a CSS mask-image, so every surface renders the exact
 * same glyph.
 */

export const DIFF_GLYPH_VIEWBOX = "0 0 12 12";
export const DIFF_GLYPH_RADIUS = 5.5;
export const DIFF_GLYPH_STROKE = 1.5;

export const DIFF_GLYPH_KNOCKOUT_PATHS = {
	added: "M6 3.5v5M3.5 6h5",
	/* A tilde: one wave through the centre, ~ for "changed". */
	modified: "M3.3 6.6c.9-1.1 1.8-1.1 2.7 0s1.8 1.1 2.7 0",
	removed: "M3.5 6h5",
	moved: "M4.8 3.6 7.2 6 4.8 8.4",
} as const;

/**
 * A mask data-URI: the dot silhouette with the knockout cut out. Painted
 * pixels reveal the element's background (a theme token); the knockout is
 * genuinely transparent, so whatever sits behind the glyph shows through.
 */
export function diffGlyphMaskDataUri(
	kind: "added" | "modified" | "removed" | "moved",
): string {
	const knockout = `<path d="${DIFF_GLYPH_KNOCKOUT_PATHS[kind]}" stroke="#000" stroke-width="${DIFF_GLYPH_STROKE}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`; // token-literal: mask luminance, not a colour
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${DIFF_GLYPH_VIEWBOX}">` +
		`<mask id="k"><circle cx="6" cy="6" r="${DIFF_GLYPH_RADIUS}" fill="#fff"/>${knockout}</mask>` + // token-literal: mask luminance, not a colour
		`<rect width="12" height="12" fill="#000" mask="url(#k)"/>` + // token-literal: mask luminance, not a colour
		`</svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
