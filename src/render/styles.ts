import { MARKDOWN_CSS } from "./markdown-css";
import { ATELIER_RENDER_TOKENS } from "./tokens.generated";

/**
 * Everything a static render needs to look like Atelier.
 *
 * The palette is generated from the app's theme, so the two cannot drift, and
 * a host that defines its own `--atelier-*` values on any ancestor retints the
 * render through the cascade — no theming API, no configuration.
 */

/** Shared frame: the scope, the type, and the diff colours both views use. */
const BASE_CSS = `
.atelier-render {
	font-family: var(--atelier-font-sans);
	font-size: 14px;
	line-height: 1.62;
	color: var(--atelier-ink);
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
	border: 1px solid var(--atelier-border);
	border-radius: var(--atelier-radius);
}
.csv-diff table {
	width: 100%;
	border: 0;
	border-collapse: collapse;
	font-size: 13px;
}
.csv-diff th, .csv-diff td {
	padding: 7px 9px;
	border-bottom: 1px solid var(--atelier-border-subtle);
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
	background: var(--atelier-bg-muted);
	font-weight: 600;
}
.csv-diff tbody tr:last-child > td { border-bottom: 0; }
.csv-diff [data-diff-status="added"] {
	background: var(--atelier-added-bg);
	color: var(--atelier-added-ink);
}
.csv-diff [data-diff-status="removed"] {
	background: var(--atelier-removed-bg);
	color: var(--atelier-removed-ink);
}
.csv-diff [data-diff-mode="words"] [data-diff-status="removed"],
.csv-diff tr[data-diff-status="removed"] > td {
	text-decoration: line-through;
	text-decoration-color: var(--atelier-removed-edge);
}
.csv-diff [data-diff-mode="words"] [data-diff-status="added"] {
	text-decoration: none;
}
.csv-diff [data-diff-status="modified"] { background: var(--atelier-modified-bg); }
/* Two versions of a cell sit side by side: without this "lead" and
   "qualified" read as one word. */
.csv-diff td span[data-diff-status], .csv-diff th span[data-diff-status] {
	padding: 0 2px;
	margin: 0 -1px;
	border-radius: var(--atelier-radius-small);
	/* Each version is its own run: without isolation, a removed and an added
	   Arabic word reorder into each other, letter by letter. */
	unicode-bidi: isolate;
}
.csv-diff td[data-diff-status], .csv-diff th[data-diff-status] { border-radius: 0; }
/* The row a gap stands for, named rather than silently missing. */
.csv-diff tr.csv-diff-gap > td {
	color: var(--atelier-ink-subtle);
	font-size: 12px;
	text-align: center;
}
`;

export const RENDER_CSS = [
	ATELIER_RENDER_TOKENS,
	BASE_CSS,
	MARKDOWN_CSS,
	CSV_CSS,
]
	.join("\n")
	.trim();
