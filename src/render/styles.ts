import { THEME_CSS } from "../shell/theme.generated";
import { MARKDOWN_CSS } from "./markdown-css";

/**
 * Everything a static render needs to look like Atelier.
 *
 * The palette is the app's own theme.css, copied verbatim by
 * scripts/tokens/emit-theme.mjs (the build checks the copy), so the two
 * cannot drift, and a host that
 * redefines an `--at-*` token on any ancestor retints the render through the
 * cascade: no theming API, no configuration. Comments are stripped so the
 * tokens block is the first thing in the sheet.
 */
const THEME_TOKENS = THEME_CSS.replace(/\/\*[\s\S]*?\*\//g, "").trim();

/** Shared frame: the scope, the type, and the diff colours both views use. */
const BASE_CSS = `
.atelier-render {
	font-family: var(--at-font-sans);
	font-size: 14px;
	line-height: 1.62;
	color: var(--at-fg);
}
.atelier-render *, .atelier-render *::before, .atelier-render *::after {
	box-sizing: border-box;
}
`;

/** CSV renders through html-diff, which marks status with its own attribute. */
const CSV_CSS = `
/* The frame belongs to the wrapper: a collapsed table ignores a radius, and
   the wrapper is what clips. */
.csv-diff {
	overflow-x: auto;
	border: 1px solid var(--at-border);
	border-radius: var(--at-radius-lg);
}
.csv-diff table {
	width: 100%;
	border: 0;
	border-collapse: collapse;
	font-size: 13px;
}
.csv-diff th, .csv-diff td {
	padding: 7px 9px;
	border-bottom: 1px solid var(--at-border-subtle);
	text-align: left;
	vertical-align: top;
	white-space: pre-wrap;
	/* A wide column wraps rather than pushing the change off the card. */
	max-width: 24ch;
	overflow-wrap: anywhere;
	/* A cell is written in whatever direction its language runs. */
	unicode-bidi: plaintext;
}
.csv-diff thead th {
	background: var(--at-bg-subtle);
	font-weight: 600;
}
.csv-diff tbody tr:last-child > td { border-bottom: 0; }
.csv-diff [data-diff-status="added"] {
	background: var(--at-diff-added-subtle);
	color: var(--at-diff-added);
}
.csv-diff [data-diff-status="removed"] {
	background: var(--at-diff-removed-subtle);
	color: var(--at-diff-removed);
}
.csv-diff [data-diff-mode="words"] [data-diff-status="removed"],
.csv-diff tr[data-diff-status="removed"] > td {
	text-decoration: line-through;
	text-decoration-color: var(--at-diff-removed);
}
.csv-diff [data-diff-mode="words"] [data-diff-status="added"] {
	text-decoration: none;
}
.csv-diff [data-diff-status="modified"] { background: var(--at-accent-subtle); }
/* Two versions of a cell sit side by side: without this "lead" and
   "qualified" read as one word. */
.csv-diff td span[data-diff-status], .csv-diff th span[data-diff-status] {
	padding: 0 2px;
	margin: 0 -1px;
	border-radius: var(--at-radius-sm);
	/* Each version is its own run: without isolation, a removed and an added
	   Arabic word reorder into each other, letter by letter. */
	unicode-bidi: isolate;
}
.csv-diff td[data-diff-status], .csv-diff th[data-diff-status] { border-radius: 0; }
/* The row a gap stands for, named rather than silently missing. */
.csv-diff tr.csv-diff-gap > td {
	color: var(--at-fg-subtle);
	font-size: 12px;
	text-align: center;
}
`;

export const RENDER_CSS = [THEME_TOKENS, BASE_CSS, MARKDOWN_CSS, CSV_CSS]
	.join("\n")
	.trim();
