/**
 * The Markdown view's static styles.
 *
 * A render lands inside someone else's page, where none of Atelier's stylesheet
 * exists, so every rule is scoped under `.md-diff` and every value comes from
 * an `--atelier-*` token. The tokens themselves are generated from the app's
 * theme, so the two surfaces cannot drift, and a host that defines its own
 * values retints the render with no API at all.
 */
export const MARKDOWN_CSS = `
.md-diff {
	font-family: var(--atelier-font-sans);
	font-size: 14px;
	line-height: 1.62;
	color: var(--atelier-ink);
	overflow-wrap: anywhere;
}

.md-diff > *:first-child { margin-top: 0; }
.md-diff > *:last-child { margin-bottom: 0; }

/* A document is written in whatever direction its language runs. */
.md-diff p, .md-diff li, .md-diff blockquote, .md-diff td, .md-diff th,
.md-diff h1, .md-diff h2, .md-diff h3, .md-diff h4, .md-diff h5, .md-diff h6 {
	unicode-bidi: plaintext;
}

.md-diff p { margin: 0 0 8px; }
.md-diff h1, .md-diff h2, .md-diff h3, .md-diff h4, .md-diff h5, .md-diff h6 {
	margin: 14px 0 6px;
	font-weight: 600;
	line-height: 1.3;
	letter-spacing: -0.006em;
}
.md-diff h1 { font-size: 20px; }
.md-diff h2 { font-size: 17px; }
.md-diff h3 { font-size: 15px; }
.md-diff h4, .md-diff h5, .md-diff h6 { font-size: 14px; }

.md-diff ul, .md-diff ol { margin: 0 0 8px; padding-left: 22px; }
.md-diff li { margin: 1px 0; }
.md-diff li > p { margin: 0; }

/* Task items: the box takes the bullet's place, as in the app.
   It rides with the text rather than sitting at a fixed edge, so a line
   written right-to-left keeps its box beside its words. */
.md-diff li[data-task] {
	list-style: none;
	margin-left: -19px;
}
.md-diff li[data-task] > p::before {
	content: "";
	display: inline-block;
	width: 13px;
	height: 13px;
	margin-inline-end: 6px;
	vertical-align: -2px;
	border: 1.5px solid var(--atelier-ink-subtle);
	border-radius: 3px;
	box-sizing: border-box;
}
.md-diff li[data-task="x"] > p::before {
	border-color: var(--atelier-action);
	background-color: var(--atelier-action);
	/* The tick, drawn rather than positioned: no second pseudo to place. */
	background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.6 6.2l2.2 2.2 4.6-4.6' fill='none' stroke='%23fff' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
	background-repeat: no-repeat;
	background-position: center;
	background-size: 11px 11px;
}
/* A done task reads as done, as in the app: dimmed, struck, box filled. */
.md-diff li[data-task="x"]:not([data-review-status]) > p {
	color: var(--atelier-ink-subtle);
	text-decoration: line-through;
	text-decoration-color: var(--atelier-ink-subtle);
}
/* A line the diff wrote into keeps the dimming and drops the rule: a
   descendant cannot undo an inherited strikethrough, and an added word
   wearing one reads as a word that was deleted. */
.md-diff
	li[data-task="x"]:not([data-review-status]):has(> p [data-review-status])
	> p {
	text-decoration: none;
}


.md-diff blockquote {
	margin: 0 0 8px;
	padding: 3px 0 3px 14px;
	border-left: 3px solid var(--atelier-border);
}

.md-diff pre {
	margin: 0 0 8px;
	padding: 10px 12px;
	border-radius: 8px;
	background: var(--atelier-bg-muted);
	border: 1px solid var(--atelier-border-subtle);
	overflow-x: auto;
}
.md-diff pre, .md-diff code {
	font-family: var(--atelier-font-mono);
	font-size: 12.5px;
}
.md-diff :not(pre) > code {
	padding: 1px 4px;
	border-radius: 4px;
	background: color-mix(in srgb, var(--atelier-ink-subtle) 15%, transparent);
}
.md-diff pre [data-review-status="removed"] { text-decoration: none; }
.md-diff pre code {
	background: none;
	padding: 0;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.md-diff .md-diff-raw { color: var(--atelier-ink-subtle); white-space: pre-wrap; }
.md-diff .md-footnote-ref { font-size: 0.75em; line-height: 0; vertical-align: super; color: var(--atelier-accent); }
.md-diff .md-footnote-def { display: grid; grid-template-columns: 3rem minmax(0, 1fr); column-gap: 0.5rem; align-items: baseline; margin: 0.5em 0; }
.md-diff .md-footnote-def-label { color: var(--atelier-accent); font-size: 0.9em; }
.md-diff .md-footnote-def-body > :first-child { margin-top: 0; }
.md-diff .md-footnote-def-body > :last-child { margin-bottom: 0; }
.md-diff .md-diff-missing { color: var(--atelier-ink-subtle); font-style: italic; }

/* An image, named rather than loaded. */
.md-diff .md-diff-image {
	display: inline-flex;
	align-items: baseline;
	gap: 5px;
	padding: 1px 7px 1px 6px;
	border: 1px solid var(--atelier-border);
	border-radius: 6px;
	color: var(--atelier-ink-muted);
	font-size: 13px;
}
.md-diff .md-diff-image::before {
	content: "▨";
	color: var(--atelier-ink-subtle);
}
.md-diff .md-diff-image { margin: 0 4px 6px 0; }
.md-diff .md-diff-image-src { color: var(--atelier-ink-subtle); font-size: 12px; }

.md-diff a {
	color: inherit;
	text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
	text-decoration-thickness: 1px;
	text-underline-offset: 2px;
}
.md-diff img { max-width: 100%; height: auto; border-radius: 6px; }
.md-diff hr { margin: 12px 0; border: 0; border-top: 1px solid var(--atelier-border); }

.md-diff table {
	display: block;
	width: max-content;
	min-width: 100%;
	max-width: 100%;
	margin: 0 0 8px;
	border: 1px solid var(--atelier-border);
	border-radius: 8px;
	border-collapse: collapse;
	overflow-x: auto;
}
.md-diff table > tbody { display: table; width: 100%; }
.md-diff th, .md-diff td {
	padding: 7px 9px;
	border-bottom: 1px solid var(--atelier-border-subtle);
	text-align: left;
	vertical-align: top;
}
.md-diff tr:first-child > th, .md-diff tr:first-child > td {
	background: var(--atelier-bg-muted);
}
.md-diff tr:last-child > th, .md-diff tr:last-child > td { border-bottom: 0; }
.md-diff th { font-weight: 600; }
.md-diff td[data-align="center"], .md-diff th[data-align="center"] { text-align: center; }
.md-diff td[data-align="right"], .md-diff th[data-align="right"] { text-align: right; }

/* ── The change itself ───────────────────────────────────────────────── */

.md-diff [data-review-status="added"] {
	background: var(--atelier-added-bg);
	color: var(--atelier-added-ink);
	border-radius: 4px;
	/* Nothing struck through: an arriving word is not a leaving one, whatever
	   decoration the line around it carries. */
	text-decoration: none;
	box-decoration-break: clone;
	-webkit-box-decoration-break: clone;
}

.md-diff [data-review-status="removed"] {
	background: var(--atelier-removed-bg);
	color: var(--atelier-removed-ink);
	border-radius: 4px;
	text-decoration: line-through;
	text-decoration-color: var(--atelier-removed-edge);
	box-decoration-break: clone;
	-webkit-box-decoration-break: clone;
}

/* Inline, the two versions sit side by side: without this they read as one
   word — a cell going 3 → 5 renders as "35". */
.md-diff span[data-review-status] {
	padding: 0 2px;
	margin: 0 -1px;
	unicode-bidi: isolate;
}
.md-diff span[data-review-status] > s { text-decoration: none; }
/* A code chip inside a marked run would punch its own ground through the
   colour of the change. */
.md-diff [data-review-status] code { background: none; color: inherit; }

.md-diff [data-review-status="modified"] { background: var(--atelier-modified-bg); border-radius: 4px; }

/* Block-level marks take the row, so the colour reads as the line's. */
.md-diff p[data-review-status],
.md-diff h1[data-review-status], .md-diff h2[data-review-status],
.md-diff h3[data-review-status], .md-diff h4[data-review-status],
.md-diff blockquote[data-review-status] {
	padding-left: 6px;
	padding-right: 6px;
	margin-left: -6px;
	margin-right: -6px;
}
/* A list row takes the colour where it stands: shifting it would pull its
   bullet or its box out of the column its neighbours sit in. */
.md-diff li[data-review-status] { padding-right: 6px; }
/* A code block keeps its own inset and its own ground; the change shows on
   the edge, where it does not turn code into something else. */
.md-diff pre[data-review-status] {
	background: var(--atelier-bg-muted);
	box-shadow: inset 3px 0 0 var(--atelier-accent);
}
.md-diff pre[data-review-status="added"] {
	box-shadow: inset 3px 0 0 var(--atelier-added-edge);
}
.md-diff pre[data-review-status="removed"] {
	box-shadow: inset 3px 0 0 var(--atelier-removed-edge);
}
.md-diff li[data-task="x"][data-review-status="added"] > p::before,
.md-diff li[data-task="x"][data-review-status="removed"] > p::before {
	border-color: currentColor;
	background-color: currentColor;
}
.md-diff tr[data-review-status] > td, .md-diff tr[data-review-status] > th { background: inherit; }

/* The gap a pruned run leaves, named rather than silent. */
.md-diff .md-diff-gap {
	display: block;
	margin: 4px 0;
	padding: 2px 0;
	color: var(--atelier-ink-subtle);
	font-size: 12px;
	list-style: none;
}
.md-diff li.md-diff-gap { margin-left: -22px; }
.md-diff tr.md-diff-gap { display: table-row; }
.md-diff tr.md-diff-gap > td { color: var(--atelier-ink-subtle); font-size: 12px; }
`;
