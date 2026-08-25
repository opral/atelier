/**
 * Diff-type glyphs: the dot silhouette every surface already uses, with a
 * knockout that adds meaning at the same footprint (design 23d). Like game-pad
 * buttons, every type gets a shape AND a color, so the types survive
 * grayscale and deuteranopia:
 *
 *   added    dot + plus      green
 *   modified plain dot       brand orange
 *   removed  dot + minus     red
 *   moved    dot + chevron   slate blue
 *   conflict split dot       purple (reserved — no producer until merges)
 *
 * Internal detail needs ≥10px to stay crisp. Listings run 12px; the compact
 * file tree runs the 10px floor; below that (the 7px status bar dot)
 * callers keep a plain color dot and let these views carry the types.
 */

import {
	DIFF_GLYPH_KNOCKOUT_PATHS,
	DIFF_GLYPH_RADIUS,
	DIFF_GLYPH_STROKE,
	DIFF_GLYPH_VIEWBOX,
} from "./diff-glyph-geometry";

export type DiffGlyphKind =
	| "added"
	| "modified"
	| "removed"
	| "moved"
	| "conflict";

const GLYPH_FILL: Record<DiffGlyphKind, string> = {
	added: "var(--color-border-diff-added)",
	modified: "var(--color-icon-brand)",
	removed: "var(--color-border-diff-removed)",
	moved: "var(--color-icon-diff-moved)",
	conflict: "var(--color-icon-diff-conflict)",
};

const GLYPH_TITLE: Record<DiffGlyphKind, string> = {
	added: "Added",
	modified: "Modified",
	removed: "Removed",
	moved: "Moved",
	conflict: "Conflict",
};

export function DiffGlyph({
	kind,
	size = 12,
	dimmed = false,
	className,
}: {
	readonly kind: DiffGlyphKind;
	readonly size?: number;
	/** Reviewed changes keep their shape and drop to sand. */
	readonly dimmed?: boolean;
	readonly className?: string;
}) {
	const fill = dimmed ? "var(--color-icon-quaternary)" : GLYPH_FILL[kind];
	// The knockout is the panel ground showing through the dot.
	const knockout = "var(--color-bg-panel)";
	return (
		<span
			title={GLYPH_TITLE[kind]}
			aria-label={GLYPH_TITLE[kind]}
			className={`inline-flex ${className ?? ""}`}
		>
		<svg width={size} height={size} viewBox={DIFF_GLYPH_VIEWBOX} aria-hidden="true">
			{kind === "conflict" ? (
				<>
					<path d="M6 1a5 5 0 0 0 0 10Z" fill={fill} />
					<circle
						cx="6"
						cy="6"
						r="4.2"
						fill="none"
						stroke={fill}
						strokeWidth="1.6"
					/>
				</>
			) : (
				<circle cx="6" cy="6" r={DIFF_GLYPH_RADIUS} fill={fill} />
			)}
			{kind === "added" || kind === "removed" || kind === "moved" ? (
				<path
					d={DIFF_GLYPH_KNOCKOUT_PATHS[kind]}
					stroke={knockout}
					strokeWidth={DIFF_GLYPH_STROKE}
					fill="none"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			) : null}
		</svg>
		</span>
	);
}
