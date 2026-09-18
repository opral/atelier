import { DOCUMENT_CSS } from "../shell/document.generated";
import { THEME_CSS } from "../shell/theme.generated";

/**
 * Everything a static render needs to look like Atelier.
 *
 * The palette is the app's own theme.css and the document rules are the
 * app's own document.css, both copied verbatim by scripts/tokens/emit-css.mjs
 * (the build checks the copies), so a card cannot disagree with the editor
 * about a colour or a heading size; and a host that redefines an `--atelier-*`
 * token on any ancestor retints the render through the cascade: no theming
 * API, no configuration. Comments are stripped so the tokens block is the
 * first thing in the sheet.
 */
const uncommented = (css: string): string =>
	css.replace(/\/\*[\s\S]*?\*\//g, "").trim();

const THEME_TOKENS = uncommented(THEME_CSS);
const DOCUMENT = uncommented(DOCUMENT_CSS);

/**
 * Shared frame: the scope, the type, and the density. A card is denser than
 * the app: the one declaration below sets the document's whole scale.
 */
const BASE_CSS = `
.atelier-render {
	--atelier-doc-font-size: 14px;
	font-family: var(--atelier-font-sans);
	font-size: 14px;
	line-height: 1.62;
	color: var(--atelier-fg);
}
.atelier-render *, .atelier-render *::before, .atelier-render *::after {
	box-sizing: border-box;
}
`;

/**
 * What only a static render has: no editor, so nothing here restyles an
 * element document.css already styles — only the chrome the render adds.
 */
const MARKDOWN_CSS = `
/* A card is narrow, and a word it cannot break would push the change off
   it; the editor scrolls instead. */
.md-diff { overflow-wrap: anywhere; }
.md-diff pre code { white-space: pre-wrap; overflow-wrap: anywhere; }

/* A card has no page around it: the document starts and ends flush. */
.md-diff > *:first-child { margin-top: 0; }
.md-diff > *:last-child { margin-bottom: 0; }

/* Raw source (frontmatter, inline HTML) is shown as source, quietly. */
.md-diff .md-diff-raw { color: var(--atelier-fg-subtle); white-space: pre-wrap; }
.md-diff .md-diff-missing { color: var(--atelier-fg-subtle); font-style: italic; }

/* An image, named rather than loaded. */
.md-diff .md-diff-image {
	display: inline-flex;
	align-items: baseline;
	gap: 5px;
	margin: 0 4px 6px 0;
	padding: 1px 7px 1px 6px;
	border: 1px solid var(--atelier-border);
	border-radius: 6px;
	color: var(--atelier-fg-muted);
	font-size: 0.93em;
}
.md-diff .md-diff-image::before {
	content: "▨";
	color: var(--atelier-fg-subtle);
}
.md-diff .md-diff-image-src { color: var(--atelier-fg-subtle); font-size: 0.86em; }
`;

/** CSV renders through html-diff, which marks status with its own attribute. */
const CSV_CSS = `
/* The frame belongs to the wrapper: a collapsed table ignores a radius, and
   the wrapper is what clips. */
.csv-diff {
	overflow-x: auto;
	border: 1px solid var(--atelier-border);
	border-radius: var(--atelier-radius-panel);
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
	background: var(--atelier-bg-subtle);
	font-weight: 600;
}
.csv-diff tbody tr:last-child > td { border-bottom: 0; }
/* The rows the trim left out, named where they were — the table's own
   version of a document's pruned run. */
.csv-diff tr.csv-diff-gap > td {
	background: var(--atelier-bg-subtle);
	color: var(--atelier-fg-subtle);
	font-size: 12px;
	max-width: none;
}
.csv-diff [data-diff-status="added"] {
	background: var(--atelier-diff-added-subtle);
	color: var(--atelier-diff-added);
}
.csv-diff [data-diff-status="removed"] {
	background: var(--atelier-diff-removed-subtle);
	color: var(--atelier-diff-removed);
}
.csv-diff [data-diff-mode="words"] [data-diff-status="removed"],
.csv-diff tr[data-diff-status="removed"] > td {
	text-decoration: line-through;
	text-decoration-color: var(--atelier-diff-removed);
}
.csv-diff [data-diff-mode="words"] [data-diff-status="added"] {
	text-decoration: none;
}
.csv-diff [data-diff-status="modified"] { background: var(--atelier-accent-subtle); }
/* Two versions of a cell sit side by side: without this "lead" and
   "qualified" read as one word. */
.csv-diff td span[data-diff-status], .csv-diff th span[data-diff-status] {
	padding: 0 2px;
	margin: 0 -1px;
	border-radius: var(--atelier-radius-tag);
	/* Each version is its own run: without isolation, a removed and an added
	   Arabic word reorder into each other, letter by letter. */
	unicode-bidi: isolate;
}
.csv-diff td[data-diff-status], .csv-diff th[data-diff-status] { border-radius: 0; }
/* The row a gap stands for, named rather than silently missing. */
.csv-diff tr.csv-diff-gap > td {
	color: var(--atelier-fg-subtle);
	font-size: 12px;
	text-align: center;
}
`;

export const RENDER_CSS = [
	THEME_TOKENS,
	BASE_CSS,
	DOCUMENT,
	MARKDOWN_CSS,
	CSV_CSS,
]
	.join("\n")
	.trim();
