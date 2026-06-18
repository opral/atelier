import "@/index.css";
import "../style.css";
import { renderMarkdownReviewDiffHtml } from "../render-review-diff-html";
import { MARKDOWN_DIFF_FIXTURES } from ".";

const root = document.getElementById("root");

if (!root) {
	throw new Error("Missing #root");
}

root.innerHTML = `
	<main class="min-h-dvh bg-background px-8 py-8 text-foreground">
		<div class="mx-auto max-w-5xl space-y-6">
			<header class="flex items-center justify-between gap-4">
				<h1 class="text-xl font-semibold tracking-normal">Markdown Diff Fixtures</h1>
				<nav class="flex flex-wrap gap-2 text-sm">
					${MARKDOWN_DIFF_FIXTURES.map(
						(fixture) =>
							`<a class="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted" href="#${fixture.id}">${fixture.title}</a>`,
					).join("")}
				</nav>
			</header>
			${MARKDOWN_DIFF_FIXTURES.map(
				(fixture) => `
					<section id="${fixture.id}" class="space-y-3">
						<h2 class="text-sm font-medium text-muted-foreground">${fixture.title}</h2>
						<div class="grid gap-3 lg:grid-cols-2">
							<div class="space-y-2">
								<h3 class="text-xs font-medium uppercase tracking-normal text-muted-foreground">Before</h3>
								<pre class="max-h-80 overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed text-foreground"><code>${escapeHtml(fixture.beforeMarkdown.trimEnd())}</code></pre>
							</div>
							<div class="space-y-2">
								<h3 class="text-xs font-medium uppercase tracking-normal text-muted-foreground">After</h3>
								<pre class="max-h-80 overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed text-foreground"><code>${escapeHtml(fixture.afterMarkdown.trimEnd())}</code></pre>
							</div>
						</div>
						<div class="markdown-view markdown-review rounded-lg border border-border bg-background">
							<div class="tiptap-container bg-background p-6">
								<div class="ProseMirror tiptap mx-auto w-full">
									${renderMarkdownReviewDiffHtml(fixture)}
								</div>
							</div>
						</div>
					</section>
				`,
			).join("")}
		</div>
	</main>
`;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
