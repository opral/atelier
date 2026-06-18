import quickFactsBefore from "./quick-facts-list.before.md?raw";
import quickFactsAfter from "./quick-facts-list.after.md?raw";
import planTableBefore from "./plan-table.before.md?raw";
import planTableAfter from "./plan-table.after.md?raw";
import gfmTableInlineBefore from "./gfm-table-inline.before.md?raw";
import gfmTableInlineAfter from "./gfm-table-inline.after.md?raw";
import gfmTableRowsBefore from "./gfm-table-rows.before.md?raw";
import gfmTableRowsAfter from "./gfm-table-rows.after.md?raw";
import gfmTableStructureBefore from "./gfm-table-structure.before.md?raw";
import gfmTableStructureAfter from "./gfm-table-structure.after.md?raw";
import releaseChecklistBefore from "./release-checklist.before.md?raw";
import releaseChecklistAfter from "./release-checklist.after.md?raw";
import duplicateTaskListBefore from "./duplicate-task-list.before.md?raw";
import duplicateTaskListAfter from "./duplicate-task-list.after.md?raw";
import gfmEdgeBlocksBefore from "./gfm-edge-blocks.before.md?raw";
import gfmEdgeBlocksAfter from "./gfm-edge-blocks.after.md?raw";
import blockMediaLinkBefore from "./block-media-link.before.md?raw";
import blockMediaLinkAfter from "./block-media-link.after.md?raw";
import blockStructureMovesBefore from "./block-structure-moves.before.md?raw";
import blockStructureMovesAfter from "./block-structure-moves.after.md?raw";
import mixedGfmDocumentBefore from "./mixed-gfm-document.before.md?raw";
import mixedGfmDocumentAfter from "./mixed-gfm-document.after.md?raw";
import inlineMediaLinkBefore from "./inline-media-link.before.md?raw";
import inlineMediaLinkAfter from "./inline-media-link.after.md?raw";
import type { MarkdownBlockSnapshot } from "../review-diff";

export type MarkdownDiffFixture = {
	readonly id: string;
	readonly title: string;
	readonly beforeMarkdown: string;
	readonly afterMarkdown: string;
	readonly beforeBlocks: readonly MarkdownBlockSnapshot[];
	readonly afterBlocks: readonly MarkdownBlockSnapshot[];
};

export const MARKDOWN_DIFF_FIXTURES: readonly MarkdownDiffFixture[] = [
	{
		id: "quick-facts-list",
		title: "Quick Facts list item edit and add",
		beforeMarkdown: quickFactsBefore,
		afterMarkdown: quickFactsAfter,
		beforeBlocks: [
			{
				id: "quick_facts_list",
				orderKey: "40",
				block: quickFactsBefore.trimEnd(),
			},
		],
		afterBlocks: [
			{
				id: "quick_facts_list",
				orderKey: "40",
				block: quickFactsAfter.trimEnd(),
			},
		],
	},
	{
		id: "plan-table",
		title: "Plan table cell edits",
		beforeMarkdown: planTableBefore,
		afterMarkdown: planTableAfter,
		beforeBlocks: [
			{
				id: "plan_table",
				orderKey: "80",
				block: planTableBefore.trimEnd(),
			},
		],
		afterBlocks: [
			{
				id: "plan_table",
				orderKey: "80",
				block: planTableAfter.trimEnd(),
			},
		],
	},
	{
		id: "gfm-table-inline",
		title: "GFM table inline formatting edits",
		beforeMarkdown: gfmTableInlineBefore,
		afterMarkdown: gfmTableInlineAfter,
		beforeBlocks: [
			{
				id: "gfm_table_inline",
				orderKey: "120",
				block: gfmTableInlineBefore.trimEnd(),
			},
		],
		afterBlocks: [
			{
				id: "gfm_table_inline",
				orderKey: "120",
				block: gfmTableInlineAfter.trimEnd(),
			},
		],
	},
	{
		id: "gfm-table-rows",
		title: "GFM table row reorder, add, remove, and duplicate labels",
		beforeMarkdown: gfmTableRowsBefore,
		afterMarkdown: gfmTableRowsAfter,
		beforeBlocks: [
			{
				id: "gfm_table_rows",
				orderKey: "140",
				block: gfmTableRowsBefore.trimEnd(),
			},
		],
		afterBlocks: [
			{
				id: "gfm_table_rows",
				orderKey: "140",
				block: gfmTableRowsAfter.trimEnd(),
			},
		],
	},
	{
		id: "gfm-table-structure",
		title: "GFM table column changes, empty cells, and pipe literals",
		beforeMarkdown: gfmTableStructureBefore,
		afterMarkdown: gfmTableStructureAfter,
		beforeBlocks: [
			{
				id: "gfm_table_structure",
				orderKey: "160",
				block: gfmTableStructureBefore.trimEnd(),
			},
		],
		afterBlocks: [
			{
				id: "gfm_table_structure",
				orderKey: "160",
				block: gfmTableStructureAfter.trimEnd(),
			},
		],
	},
	{
		id: "release-checklist",
		title: "Task list checked state and nested item edits",
		beforeMarkdown: releaseChecklistBefore,
		afterMarkdown: releaseChecklistAfter,
		beforeBlocks: [
			{
				id: "release_checklist_heading",
				orderKey: "40",
				block: "# Release checklist",
			},
			{
				id: "release_checklist_tasks",
				orderKey: "80",
				block: releaseChecklistBefore
					.replace(/^# Release checklist\n\n/, "")
					.trimEnd(),
			},
		],
		afterBlocks: [
			{
				id: "release_checklist_heading",
				orderKey: "40",
				block: "# Release checklist",
			},
			{
				id: "release_checklist_tasks",
				orderKey: "80",
				block: releaseChecklistAfter
					.replace(/^# Release checklist\n\n/, "")
					.trimEnd(),
			},
		],
	},
	{
		id: "duplicate-task-list",
		title: "Duplicate task labels, reorder, and nested task edits",
		beforeMarkdown: duplicateTaskListBefore,
		afterMarkdown: duplicateTaskListAfter,
		beforeBlocks: [
			{
				id: "duplicate_task_list_heading",
				orderKey: "40",
				block: "# Duplicate task list",
			},
			{
				id: "duplicate_task_list_tasks",
				orderKey: "80",
				block: duplicateTaskListBefore
					.replace(/^# Duplicate task list\n\n/, "")
					.trimEnd(),
			},
		],
		afterBlocks: [
			{
				id: "duplicate_task_list_heading",
				orderKey: "40",
				block: "# Duplicate task list",
			},
			{
				id: "duplicate_task_list_tasks",
				orderKey: "80",
				block: duplicateTaskListAfter
					.replace(/^# Duplicate task list\n\n/, "")
					.trimEnd(),
			},
		],
	},
	{
		id: "gfm-edge-blocks",
		title: "GFM edge block edits",
		beforeMarkdown: gfmEdgeBlocksBefore,
		afterMarkdown: gfmEdgeBlocksAfter,
		beforeBlocks: [
			{
				id: "gfm_code_fence",
				orderKey: "40",
				block: [
					"```ts",
					'const route = "/draft";',
					"return fetch(route);",
					"```",
				].join("\n"),
			},
			{
				id: "gfm_blockquote",
				orderKey: "80",
				block: [
					"> Keep the customer quote.",
					"> Ship the current onboarding checklist.",
				].join("\n"),
			},
			{
				id: "gfm_raw_html",
				orderKey: "120",
				block: [
					'<aside data-kind="tip">',
					"Keep a short migration note.",
					"</aside>",
				].join("\n"),
			},
			{
				id: "gfm_strikethrough",
				orderKey: "160",
				block: "~~Deprecated: invite-only beta~~",
			},
			{
				id: "gfm_autolink",
				orderKey: "200",
				block: "See <https://example.com/docs>.",
			},
		],
		afterBlocks: [
			{
				id: "gfm_code_fence",
				orderKey: "40",
				block: [
					"```ts",
					'const route = "/launch";',
					'return fetch(route, { cache: "no-store" });',
					"```",
				].join("\n"),
			},
			{
				id: "gfm_blockquote",
				orderKey: "80",
				block: [
					"> Keep the customer quote.",
					"> Ship the revised onboarding checklist.",
					"> Add a rollout owner.",
				].join("\n"),
			},
			{
				id: "gfm_raw_html",
				orderKey: "120",
				block: [
					'<aside data-kind="tip">',
					"Keep a short migration note and link to support.",
					"</aside>",
				].join("\n"),
			},
			{
				id: "gfm_strikethrough",
				orderKey: "160",
				block: "~~Deprecated: private beta~~",
			},
			{
				id: "gfm_autolink",
				orderKey: "200",
				block: "See <https://example.com/guides>.",
			},
		],
	},
	{
		id: "block-media-link",
		title: "Block, media, link, and HTML edits",
		beforeMarkdown: blockMediaLinkBefore,
		afterMarkdown: blockMediaLinkAfter,
		beforeBlocks: [
			{
				id: "launch_heading",
				orderKey: "40",
				block: "# Launch notes",
			},
			{
				id: "dashboard_image",
				orderKey: "80",
				block:
					'![Old dashboard](https://example.com/dashboard-old.png "Old title")',
			},
			{
				id: "theme_break",
				orderKey: "120",
				block: "---",
			},
			{
				id: "metrics_heading",
				orderKey: "160",
				block: "## Metrics",
			},
			{
				id: "language_fence",
				orderKey: "200",
				block: ["```js", "export const enabled = false;", "```"].join("\n"),
			},
			{
				id: "nested_quote",
				orderKey: "240",
				block: [
					"> Keep **bold signal** and [support link](https://example.com/support).",
					"> Nested _quote detail_ stays calm.",
				].join("\n"),
			},
			{
				id: "autolinks",
				orderKey: "280",
				block:
					"The docs live at <https://example.com/docs> and <team@example.com>.",
			},
			{
				id: "inline_html",
				orderKey: "320",
				block:
					'Use <kbd>Cmd</kbd> + `K` for search and <span data-kind="badge">beta</span>.',
			},
			{
				id: "raw_html_block",
				orderKey: "360",
				block: [
					'<section data-panel="old">',
					"Raw block content",
					"</section>",
				].join("\n"),
			},
		],
		afterBlocks: [
			{
				id: "metrics_heading",
				orderKey: "40",
				block: "## Metrics renamed",
			},
			{
				id: "autolinks",
				orderKey: "80",
				block:
					"The docs live at <https://example.com/guides> and <help@example.com>.",
			},
			{
				id: "dashboard_image",
				orderKey: "120",
				block:
					'![New dashboard](https://example.com/dashboard-new.png "New title")',
			},
			{
				id: "theme_break",
				orderKey: "160",
				block: "***",
			},
			{
				id: "launch_heading",
				orderKey: "200",
				block: "# Launch notes",
			},
			{
				id: "language_fence",
				orderKey: "240",
				block: ["```ts", "export const enabled = true;", "```"].join("\n"),
			},
			{
				id: "nested_quote",
				orderKey: "280",
				block: [
					"> Keep **strong signal** and [support link](https://example.com/help).",
					"> Nested _quote detail_ stays focused.",
					"> Add `owner` callout.",
				].join("\n"),
			},
			{
				id: "inline_html",
				orderKey: "320",
				block:
					'Use <kbd>Ctrl</kbd> + `K` for search and <span data-kind="badge">stable</span>.',
			},
			{
				id: "raw_html_block",
				orderKey: "360",
				block: [
					'<section data-panel="new">',
					"Raw block content plus owner",
					"</section>",
				].join("\n"),
			},
		],
	},
	{
		id: "block-structure-moves",
		title: "Block moves, repeated text, and structural add/remove cases",
		beforeMarkdown: blockStructureMovesBefore,
		afterMarkdown: blockStructureMovesAfter,
		beforeBlocks: [
			{
				id: "overview_heading",
				orderKey: "40",
				block: "# Overview",
			},
			{
				id: "shared_paragraph",
				orderKey: "80",
				block: "Shared paragraph.",
			},
			{
				id: "moved_paragraph",
				orderKey: "120",
				block: "Move this paragraph below the checklist.",
			},
			{
				id: "details_heading",
				orderKey: "160",
				block: "## Details",
			},
			{
				id: "repeated_heading_first",
				orderKey: "200",
				block: "Repeated heading",
			},
			{
				id: "repeated_paragraph_first",
				orderKey: "240",
				block: "Keep the same repeated paragraph.",
			},
			{
				id: "nested_blockquote",
				orderKey: "280",
				block: [
					"> Parent quote stays.",
					">",
					"> > Nested quote detail stays calm.",
				].join("\n"),
			},
			{
				id: "changed_language_fence",
				orderKey: "320",
				block: ["```js", 'console.log("keep");', "```"].join("\n"),
			},
			{
				id: "removed_code_fence",
				orderKey: "360",
				block: ["```ts", 'console.log("remove me");', "```"].join("\n"),
			},
			{
				id: "changed_theme_break",
				orderKey: "400",
				block: "---",
			},
			{
				id: "paragraph_before_list",
				orderKey: "440",
				block: "Paragraph before list.",
			},
			{
				id: "list_between_paragraphs",
				orderKey: "480",
				block: ["- Keep list item", "- Move list with paragraph boundary"].join(
					"\n",
				),
			},
			{
				id: "paragraph_after_list",
				orderKey: "520",
				block: "Paragraph after list.",
			},
			{
				id: "removed_html_block",
				orderKey: "560",
				block: ["<aside>", "Remove this HTML block.", "</aside>"].join("\n"),
			},
			{
				id: "repeated_heading_second",
				orderKey: "600",
				block: "Repeated heading",
			},
			{
				id: "repeated_paragraph_second",
				orderKey: "640",
				block: "Keep the same repeated paragraph.",
			},
		],
		afterBlocks: [
			{
				id: "overview_heading",
				orderKey: "40",
				block: "## Overview",
			},
			{
				id: "shared_paragraph",
				orderKey: "80",
				block: "Shared paragraph.",
			},
			{
				id: "repeated_heading_first",
				orderKey: "120",
				block: "Repeated heading",
			},
			{
				id: "repeated_paragraph_first",
				orderKey: "160",
				block: "Keep the same repeated paragraph.",
			},
			{
				id: "details_heading",
				orderKey: "200",
				block: "### Details",
			},
			{
				id: "paragraph_before_list",
				orderKey: "240",
				block: "Paragraph before list.",
			},
			{
				id: "list_between_paragraphs",
				orderKey: "280",
				block: [
					"- Keep list item",
					"- Move list with paragraph boundary",
					"- Add list item between paragraphs",
				].join("\n"),
			},
			{
				id: "moved_paragraph",
				orderKey: "320",
				block: "Move this paragraph below the checklist.",
			},
			{
				id: "paragraph_after_list",
				orderKey: "360",
				block: "Paragraph after list.",
			},
			{
				id: "nested_blockquote",
				orderKey: "400",
				block: [
					"> Parent quote stays.",
					">",
					"> > Nested quote detail stays focused.",
					"> >",
					"> > Nested quote owner added.",
				].join("\n"),
			},
			{
				id: "changed_language_fence",
				orderKey: "440",
				block: ["```ts", 'console.log("keep");', "```"].join("\n"),
			},
			{
				id: "changed_theme_break",
				orderKey: "480",
				block: "***",
			},
			{
				id: "added_html_block",
				orderKey: "520",
				block: ["<section>", "Add this HTML block.", "</section>"].join("\n"),
			},
			{
				id: "repeated_heading_second",
				orderKey: "560",
				block: "Repeated heading",
			},
			{
				id: "repeated_paragraph_second",
				orderKey: "600",
				block: "Keep the same repeated paragraph.",
			},
			{
				id: "added_code_fence",
				orderKey: "640",
				block: ["```sh", 'echo "new fence"', "```"].join("\n"),
			},
		],
	},
	{
		id: "mixed-gfm-document",
		title: "Mixed GFM document table, list, code, and links",
		beforeMarkdown: mixedGfmDocumentBefore,
		afterMarkdown: mixedGfmDocumentAfter,
		beforeBlocks: [
			{
				id: "mixed_launch_heading",
				orderKey: "40",
				block: "# Launch review",
			},
			{
				id: "mixed_link_paragraph",
				orderKey: "80",
				block:
					"Read the [runbook](https://example.com/runbook) and ping <ops@example.com>.",
			},
			{
				id: "mixed_table",
				orderKey: "120",
				block: [
					"| Area | Owner | Status |",
					"| --- | --- | --- |",
					"| API | Dee | Ready |",
					"| Web | Mo | Draft |",
				].join("\n"),
			},
			{
				id: "mixed_task_list",
				orderKey: "160",
				block: [
					"- [x] Confirm launch owner",
					"- [ ] Update docs",
					"  - Keep migration note",
					"  - Verify search index",
				].join("\n"),
			},
			{
				id: "mixed_code_fence",
				orderKey: "200",
				block: [
					"```ts",
					'export const rollout = "staged";',
					'notify("ops");',
					"```",
				].join("\n"),
			},
		],
		afterBlocks: [
			{
				id: "mixed_launch_heading",
				orderKey: "40",
				block: "# Launch review",
			},
			{
				id: "mixed_link_paragraph",
				orderKey: "80",
				block:
					"Read the [runbook](https://example.com/runbook-v2) and ping <ops@example.com>.",
			},
			{
				id: "mixed_table",
				orderKey: "120",
				block: [
					"| Area | Owner | Status |",
					"| --- | --- | --- |",
					"| API | Dee | Ready |",
					"| Web | Mo | Approved |",
					"| Billing | Ada | Watching |",
				].join("\n"),
			},
			{
				id: "mixed_task_list",
				orderKey: "160",
				block: [
					"- [x] Confirm launch owner",
					"- [x] Update docs",
					"  - Keep migration note",
					"  - Verify search index",
					"  - Add rollback note",
				].join("\n"),
			},
			{
				id: "mixed_code_fence",
				orderKey: "200",
				block: [
					"```ts",
					'export const rollout = "global";',
					'notify("ops");',
					'notify("support");',
					"```",
				].join("\n"),
			},
		],
	},
	{
		id: "inline-media-link",
		title: "Inline media, reference links, autolinks, escapes, and breaks",
		beforeMarkdown: inlineMediaLinkBefore,
		afterMarkdown: inlineMediaLinkAfter,
		beforeBlocks: [
			{
				id: "inline_media_link_heading",
				orderKey: "40",
				block: "# Inline media and links",
			},
			{
				id: "inline_punctuation",
				orderKey: "80",
				block:
					"Opening line keeps emoji :) around **bold**, `code`, ~~strike~~, and punctuation!",
			},
			{
				id: "inline_links",
				orderKey: "120",
				block:
					"Change [Docs](https://example.com/docs) text, but keep [API](https://example.com/api-v1) text with a URL-only edit.",
			},
			{
				id: "reference_links",
				orderKey: "160",
				block: [
					"Reference [Guide][guide-v1] and logo ![Reference logo][logo-v1].",
					"",
					"[guide-v1]: https://example.com/guide-v1",
					'[logo-v1]: https://example.com/logo-v1.png "Logo v1"',
				].join("\n"),
			},
			{
				id: "bare_autolinks",
				orderKey: "200",
				block:
					"Bare links: https://example.com/bare-v1 and ops-v1@example.com.",
			},
			{
				id: "escaped_markdown",
				orderKey: "240",
				block: String.raw`Escaped markdown: \*literal stars\* and \[literal link\].`,
			},
			{
				id: "breaks",
				orderKey: "280",
				block: [
					"Soft break stays here",
					"with the next line, and hard break stays here  ",
					"with the forced line.",
				].join("\n"),
			},
			{
				id: "removed_image",
				orderKey: "320",
				block:
					'![Removed chart](https://example.com/chart-old.png "Removed title")',
			},
			{
				id: "changed_image",
				orderKey: "360",
				block:
					'![Screenshot old alt](https://example.com/screenshot.png "Old screenshot title")',
			},
		],
		afterBlocks: [
			{
				id: "inline_media_link_heading",
				orderKey: "40",
				block: "# Inline media and links",
			},
			{
				id: "inline_punctuation",
				orderKey: "80",
				block:
					"Opening line keeps emoji :) around **strong**, `snippet`, ~~retired~~, and punctuation?",
			},
			{
				id: "inline_links",
				orderKey: "120",
				block:
					"Change [Guides](https://example.com/docs) text, but keep [API](https://example.com/api-v2) text with a URL-only edit.",
			},
			{
				id: "reference_links",
				orderKey: "160",
				block: [
					"Reference [Guidebook][guide-v2] and logo ![Reference logo new][logo-v2].",
					"",
					"[guide-v2]: https://example.com/guide-v2",
					'[logo-v2]: https://example.com/logo-v2.png "Logo v2"',
				].join("\n"),
			},
			{
				id: "bare_autolinks",
				orderKey: "200",
				block:
					"Bare links: https://example.com/bare-v2 and ops-v2@example.com.",
			},
			{
				id: "escaped_markdown",
				orderKey: "240",
				block: String.raw`Escaped markdown: \*literal asterisks\* and \[literal reference\].`,
			},
			{
				id: "breaks",
				orderKey: "280",
				block: [
					"Soft break stays here",
					"with the next line updated, and hard break stays here  ",
					"with the forced line updated.",
				].join("\n"),
			},
			{
				id: "added_image",
				orderKey: "320",
				block:
					'![Added chart](https://example.com/chart-new.png "Added title")',
			},
			{
				id: "changed_image",
				orderKey: "360",
				block:
					'![Screenshot new alt](https://example.com/screenshot.png "New screenshot title")',
			},
		],
	},
];
