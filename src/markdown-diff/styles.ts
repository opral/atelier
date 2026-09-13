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
	--md-diff-added-bg: rgb(240, 249, 242);
	--md-diff-added-ink: rgb(22, 101, 52);
	--md-diff-added-edge: rgb(21, 128, 61);
	--md-diff-removed-bg: rgb(253, 242, 242);
	--md-diff-removed-ink: rgb(153, 27, 27);
	--md-diff-removed-edge: rgb(185, 28, 28);
	--md-diff-brand: rgb(234, 88, 12);
	--md-diff-modified-bg: rgb(251, 239, 228);
	font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
	font-size: 14px;
	line-height: 1.62;
	color: var(--md-diff-ink);
	overflow-wrap: anywhere;
}

.md-diff > *:first-child { margin-top: 0; }
.md-diff > *:last-child { margin-bottom: 0; }

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
	border: 1.5px solid var(--md-diff-ink-4);
	border-radius: 3px;
	box-sizing: border-box;
}
.md-diff li[data-task="x"]::before {
	border-color: var(--md-diff-brand);
	background: var(--md-diff-brand);
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
/* A done task reads as done — unless the diff is already colouring it.
   A line whose words changed keeps them legible: two strikethroughs in one
   line make an added word look deleted. */
.md-diff
	li[data-task="x"]:not([data-review-status]):not(:has(> p [data-review-status]))
	> p {
	color: var(--md-diff-ink-3);
	text-decoration: line-through;
	text-decoration-color: rgba(120, 113, 108, 0.6);
}

.md-diff blockquote {
	margin: 0 0 8px;
	padding-left: 12px;
	border-left: 2px solid var(--md-diff-rule);
	color: var(--md-diff-ink-2);
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
	background: rgb(245, 242, 237);
}
.md-diff pre code { background: none; padding: 0; }
.md-diff .md-diff-raw { color: var(--md-diff-ink-3); white-space: pre-wrap; }
.md-diff .md-diff-missing { color: var(--md-diff-ink-4); font-style: italic; }

.md-diff a { color: rgb(194, 65, 12); text-underline-offset: 2px; }
.md-diff img { max-width: 100%; height: auto; border-radius: 6px; }
.md-diff hr { margin: 12px 0; border: 0; border-top: 1px solid var(--md-diff-rule); }

.md-diff table {
	width: 100%;
	margin: 0 0 8px;
	border-collapse: collapse;
	font-size: 13px;
}
.md-diff th, .md-diff td {
	padding: 5px 8px;
	border-bottom: 1px solid var(--md-diff-rule-soft);
	text-align: left;
	vertical-align: top;
}
.md-diff th { font-weight: 600; color: var(--md-diff-ink-2); }
.md-diff td[data-align="center"], .md-diff th[data-align="center"] { text-align: center; }
.md-diff td[data-align="right"], .md-diff th[data-align="right"] { text-align: right; }

/* ── The change itself ───────────────────────────────────────────────── */

.md-diff [data-review-status="added"] {
	background: var(--md-diff-added-bg);
	color: var(--md-diff-added-ink);
	border-radius: 4px;
	box-decoration-break: clone;
	-webkit-box-decoration-break: clone;
}

.md-diff [data-review-status="removed"] {
	background: var(--md-diff-removed-bg);
	color: var(--md-diff-removed-ink);
	border-radius: 4px;
	text-decoration: line-through;
	text-decoration-color: rgba(185, 28, 28, 0.45);
	box-decoration-break: clone;
	-webkit-box-decoration-break: clone;
}

.md-diff [data-review-status="modified"] { background: var(--md-diff-modified-bg); border-radius: 4px; }

/* Block-level marks take the row, so the colour reads as the line's. */
.md-diff p[data-review-status],
.md-diff h1[data-review-status], .md-diff h2[data-review-status],
.md-diff h3[data-review-status], .md-diff h4[data-review-status],
.md-diff li[data-review-status], .md-diff pre[data-review-status],
.md-diff blockquote[data-review-status] {
	padding-left: 6px;
	padding-right: 6px;
	margin-left: -6px;
	margin-right: -6px;
}
.md-diff li[data-task][data-review-status] { margin-left: -28px; padding-left: 30px; }
.md-diff li[data-task="x"][data-review-status]::before { border-color: currentColor; background: currentColor; }
.md-diff tr[data-review-status] > td, .md-diff tr[data-review-status] > th { background: inherit; }

/* The gap a pruned run leaves, named rather than silent. */
.md-diff .md-diff-gap {
	display: block;
	margin: 4px 0;
	padding: 2px 0 2px 6px;
	color: var(--md-diff-ink-4);
	font-size: 12px;
	list-style: none;
}
.md-diff li.md-diff-gap { margin-left: -22px; }
`;
