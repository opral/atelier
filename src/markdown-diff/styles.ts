/**
 * The diff card's stylesheet, self-contained.
 *
 * The card renders inside someone else's page — a chat client's frame — where
 * none of Atelier's tokens or resets exist, so the values are literal here and
 * every rule is scoped under `.md-diff`. The palette is the app's: the same
 * warm neutrals, the same added/removed grounds, the same dot-hybrid glyph
 * colours, so a change reads the same in the thread as it does in the app.
 */
export const MARKDOWN_DIFF_CSS = `
.md-diff {
	--md-diff-ink: rgb(28, 25, 23);
	--md-diff-ink-2: rgb(68, 64, 60);
	--md-diff-ink-3: rgb(120, 113, 108);
	--md-diff-ink-4: rgb(168, 162, 158);
	--md-diff-rule: rgb(236, 232, 226);
	--md-diff-rule-soft: rgb(244, 241, 236);
	--md-diff-panel: #fff;
	--md-diff-added-bg: rgb(237, 250, 242);
	--md-diff-added-ink: rgb(22, 101, 52);
	--md-diff-added-edge: rgb(21, 128, 61);
	--md-diff-removed-bg: rgb(254, 243, 243);
	--md-diff-removed-ink: rgb(153, 27, 27);
	--md-diff-removed-edge: rgb(185, 28, 28);
	--md-diff-brand: rgb(234, 88, 12);
	--md-diff-action: rgb(194, 65, 12);
	--md-diff-modified-bg: rgb(251, 239, 228);
	font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
	font-size: 14px;
	line-height: 1.62;
	color: var(--md-diff-ink);
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

/* Task items: the box takes the bullet's place, as in the app. */
.md-diff li[data-task] {
	list-style: none;
	margin-left: -22px;
	padding-left: 24px;
	position: relative;
}
.md-diff li[data-task]::before {
	content: "";
	position: absolute;
	left: 2px;
	top: 5px;
	width: 13px;
	height: 13px;
	border: 1.5px solid var(--md-diff-ink-3);
	border-radius: 3px;
	box-sizing: border-box;
}
.md-diff li[data-task="x"]::before {
	border-color: var(--md-diff-action);
	background: var(--md-diff-action);
}
.md-diff li[data-task="x"]::after {
	content: "";
	position: absolute;
	left: 5px;
	top: 8px;
	width: 6px;
	height: 3px;
	border: 1.6px solid #fff;
	border-top: 0;
	border-right: 0;
	transform: rotate(-45deg);
}
/* A done task reads as done, as in the app — unless the diff is already
   colouring the whole row. Inside it, a marked word takes its own colour and
   an added one is never struck. */
.md-diff li[data-task="x"]:not([data-review-status]) > p {
	color: var(--md-diff-ink-3);
	text-decoration: line-through;
	text-decoration-color: rgba(120, 113, 108, 0.6);
}
.md-diff li[data-task="x"] > p span[data-review-status] {
	color: var(--md-diff-ink);
	text-decoration-color: currentColor;
}

.md-diff blockquote {
	margin: 0 0 8px;
	padding: 3px 0 3px 14px;
	border-left: 3px solid currentColor;
}

.md-diff pre {
	margin: 0 0 8px;
	padding: 10px 12px;
	border-radius: 8px;
	background: rgb(250, 250, 249);
	border: 1px solid var(--md-diff-rule-soft);
	overflow-x: auto;
}
.md-diff pre, .md-diff code {
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 12.5px;
}
.md-diff :not(pre) > code {
	padding: 1px 4px;
	border-radius: 4px;
	background: color-mix(in srgb, rgb(120, 113, 108) 15%, transparent);
}
.md-diff pre code {
	background: none;
	padding: 0;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.md-diff .md-diff-raw { color: var(--md-diff-ink-3); white-space: pre-wrap; }
.md-diff .md-diff-missing { color: var(--md-diff-ink-4); font-style: italic; }

/* An image, named rather than loaded. */
.md-diff .md-diff-image {
	display: inline-flex;
	align-items: baseline;
	gap: 5px;
	padding: 1px 7px 1px 6px;
	border: 1px solid var(--md-diff-rule);
	border-radius: 6px;
	color: var(--md-diff-ink-2);
	font-size: 13px;
}
.md-diff .md-diff-image::before {
	content: "▨";
	color: var(--md-diff-ink-4);
}
.md-diff .md-diff-image-src { color: var(--md-diff-ink-4); font-size: 12px; }

.md-diff a {
	color: inherit;
	text-decoration-color: color-mix(in srgb, currentColor 40%, transparent);
	text-decoration-thickness: 1px;
	text-underline-offset: 2px;
}
.md-diff img { max-width: 100%; height: auto; border-radius: 6px; }
.md-diff hr { margin: 12px 0; border: 0; border-top: 1px solid var(--md-diff-rule); }

.md-diff table {
	display: block;
	width: max-content;
	min-width: 100%;
	max-width: 100%;
	margin: 0 0 8px;
	border: 1px solid var(--md-diff-rule);
	border-radius: 8px;
	border-collapse: collapse;
	overflow-x: auto;
}
.md-diff table > tbody { display: table; width: 100%; }
.md-diff th, .md-diff td {
	padding: 7px 9px;
	border-bottom: 1px solid var(--md-diff-rule-soft);
	text-align: left;
	vertical-align: top;
}
.md-diff tr:first-child > th, .md-diff tr:first-child > td {
	background: rgb(250, 250, 249);
}
.md-diff tr:last-child > th, .md-diff tr:last-child > td { border-bottom: 0; }
.md-diff th { font-weight: 600; }
.md-diff td[data-align="center"], .md-diff th[data-align="center"] { text-align: center; }
.md-diff td[data-align="right"], .md-diff th[data-align="right"] { text-align: right; }

/* ── The change itself ───────────────────────────────────────────────── */

.md-diff [data-review-status="added"] {
	background: var(--md-diff-added-bg);
	color: var(--md-diff-added-ink);
	border-radius: 4px;
	/* Nothing struck through: an arriving word is not a leaving one, whatever
	   decoration the line around it carries. */
	text-decoration: none;
	box-decoration-break: clone;
	-webkit-box-decoration-break: clone;
}

.md-diff [data-review-status="removed"] {
	background: var(--md-diff-removed-bg);
	color: var(--md-diff-removed-ink);
	border-radius: 4px;
	text-decoration: line-through;
	text-decoration-color: var(--md-diff-removed-edge);
	box-decoration-break: clone;
	-webkit-box-decoration-break: clone;
}

/* Inline, the two versions sit side by side: without this they read as one
   word — a cell going 3 → 5 renders as "35". */
.md-diff span[data-review-status] { padding: 0 2px; margin: 0 -1px; }
.md-diff span[data-review-status] > s { text-decoration: none; }
/* A code chip inside a marked run would punch its own ground through the
   colour of the change. */
.md-diff [data-review-status] code { background: none; color: inherit; }

.md-diff [data-review-status="modified"] { background: var(--md-diff-modified-bg); border-radius: 4px; }

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
	background: rgb(250, 250, 249);
	box-shadow: inset 3px 0 0 var(--md-diff-brand);
}
.md-diff pre[data-review-status="added"] {
	box-shadow: inset 3px 0 0 var(--md-diff-added-edge);
}
.md-diff pre[data-review-status="removed"] {
	box-shadow: inset 3px 0 0 var(--md-diff-removed-edge);
}
.md-diff li[data-task="x"][data-review-status="added"]::before,
.md-diff li[data-task="x"][data-review-status="removed"]::before {
	border-color: currentColor;
	background: currentColor;
}
.md-diff tr[data-review-status] > td, .md-diff tr[data-review-status] > th { background: inherit; }

/* The gap a pruned run leaves, named rather than silent. */
.md-diff .md-diff-gap {
	display: block;
	margin: 4px 0;
	padding: 2px 0;
	color: var(--md-diff-ink-3);
	font-size: 12px;
	list-style: none;
}
.md-diff li.md-diff-gap { margin-left: -22px; }
.md-diff tr.md-diff-gap { display: table-row; }
.md-diff tr.md-diff-gap > td { color: var(--md-diff-ink-3); font-size: 12px; }
`;
