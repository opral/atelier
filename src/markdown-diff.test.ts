import { expect, test } from "vitest";
import {
	MARKDOWN_DIFF_CSS,
	renderMarkdownDiff,
	renderMarkdownDocument,
} from "./markdown-diff";

const PLAYBOOK = [
	"## Sales Experiments",
	"",
	"- [ ] Company brain",
	"- [ ] GTM as code: who runs GTM from a repo?",
	"- [ ] CAD vibe coders: where do they store projects?",
	"- [ ] Remotion creators. Where do they store projects?",
	"- [ ] n8n automation engineers: are they switching to scripts?",
	"",
].join("\n");

const WITH_CONSULTANTS = PLAYBOOK.replace(
	"- [ ] n8n automation engineers: are they switching to scripts?\n",
	[
		"- [ ] n8n automation engineers: are they switching to scripts?",
		"- [ ] AI consultants: learn what companies' P0s are.",
		"  - Hypothesis: they see urgent needs across many clients at once.",
		"",
	].join("\n"),
);

test("an addition is marked, counted, and left renderable on its own", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: PLAYBOOK,
		afterMarkdown: WITH_CONSULTANTS,
	});

	expect(diff.unchanged).toBe(false);
	expect(diff.stats).toEqual({ added: 2, removed: 0, modified: 0 });
	expect(diff.html).toContain('<li data-task=" " data-review-status="added">');
	expect(diff.html).toContain("AI consultants");
	// Unchanged neighbours stay plain, so the eye lands on the change.
	expect(diff.html).toContain('<li data-task=" ">');
	expect(diff.html).not.toContain("<script");
	expect(MARKDOWN_DIFF_CSS).toContain('[data-review-status="added"]');
});

test("a removal keeps the line, struck, where it stood", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: WITH_CONSULTANTS,
		afterMarkdown: PLAYBOOK,
	});

	expect(diff.stats).toEqual({ added: 0, removed: 2, modified: 0 });
	expect(diff.html).toContain('data-review-status="removed"');
	expect(diff.html).toContain("AI consultants");
	expect(MARKDOWN_DIFF_CSS).toContain("line-through");
});

test("an edit inside a line marks the words, not the line", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: "Read the positioning before drafting.\n",
		afterMarkdown: "Read the positioning before writing.\n",
	});

	expect(diff.stats).toEqual({ added: 0, removed: 0, modified: 1 });
	expect(diff.html).toContain('<span data-review-status="removed">');
	expect(diff.html).toContain('<span data-review-status="added">');
	expect(diff.html).toMatch(/^<p>Read the positioning before/);
});

test("identical snapshots render nothing to review", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: PLAYBOOK,
		afterMarkdown: PLAYBOOK,
	});

	expect(diff.unchanged).toBe(true);
	expect(diff.stats).toEqual({ added: 0, removed: 0, modified: 0 });
	expect(diff.hidden).toBe(0);
});

test("a long list collapses to the change, and says what it left out", () => {
	const items = Array.from(
		{ length: 40 },
		(_, index) => `- Item ${index + 1}`,
	).join("\n");
	const after = `${items}\n- The new one\n`;
	const diff = renderMarkdownDiff({
		beforeMarkdown: `${items}\n`,
		afterMarkdown: after,
		context: 1,
		maxLines: 6,
	});

	expect(diff.stats.added).toBe(1);
	expect(diff.html).toContain("The new one");
	expect(diff.html).toContain("md-diff-gap");
	expect(diff.hidden).toBeGreaterThan(30);
	// The kept window stays small: the card has a height budget.
	expect(diff.html.match(/<li/g)?.length).toBeLessThanOrEqual(7);
	// `full` opts out and renders everything.
	const whole = renderMarkdownDiff({
		beforeMarkdown: `${items}\n`,
		afterMarkdown: after,
		full: true,
	});
	expect(whole.hidden).toBe(0);
	expect(whole.html.match(/<li/g)?.length).toBe(41);
});

test("a document that already fits is shown whole", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: "- one\n- two\n",
		afterMarkdown: "- one\n- two\n- three\n",
	});

	expect(diff.hidden).toBe(0);
	expect(diff.html).toContain("one");
	expect(diff.html).not.toContain("md-diff-gap");
});

test("a document renders without a diff for the read side", () => {
	const html = renderMarkdownDocument(
		"# Acme\n\nOne company. One shared repository.\n",
	);
	expect(html).toBe("<h1>Acme</h1><p>One company. One shared repository.</p>");
});

test("markup in a document is text, and only navigable links survive", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: "Plain.\n",
		afterMarkdown: [
			"Plain.",
			"",
			"<img src=x onerror=alert(1)>",
			"",
			"[ok](https://example.com) and [no](javascript:alert(1))",
			"",
			'5 < 6 & "quoted"',
			"",
		].join("\n"),
	});

	// The tag is shown as source, not parsed into one.
	expect(diff.html).not.toContain("<img");
	expect(diff.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
	expect(diff.html).toContain('<a href="https://example.com"');
	expect(diff.html).not.toContain("javascript:");
	expect(diff.html).toContain("5 &lt; 6 &amp; &quot;quoted&quot;");
});

test("a table's changed row is marked, and its cells keep their alignment", () => {
	const before = [
		"| Team | What's here |",
		"| --- | ---: |",
		"| Sales | Pipeline |",
		"",
	].join("\n");
	const after = before.replace(
		"| Sales | Pipeline |",
		"| Sales | Pipeline and ICP |",
	);
	const diff = renderMarkdownDiff({
		beforeMarkdown: before,
		afterMarkdown: after,
	});

	expect(diff.html).toContain("<table>");
	expect(diff.html).toContain('data-align="right"');
	expect(diff.html).toContain('<span data-review-status="added">');
	expect(diff.stats.modified).toBe(1);
});

test("a checked task keeps its box, and a marked one is not struck twice", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: "- [ ] Ship it\n",
		afterMarkdown: "- [x] Ship it\n",
	});

	expect(diff.html).toContain('data-task="x"');
	// A done task is struck, as in the app; a word the diff marks inside it
	// takes its own colour, and an added one is never struck.
	expect(MARKDOWN_DIFF_CSS).toContain(
		'li[data-task="x"]:not([data-review-status]) > p',
	);
	expect(MARKDOWN_DIFF_CSS).toContain(
		'li[data-task="x"] > p span[data-review-status]',
	);
});

test("an image is named, not fetched, unless the caller asks for the tag", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: "Plain.\n",
		afterMarkdown:
			"Plain.\n\n![The funnel](https://tracker.example/pixel.gif)\n",
	});

	// A document's author picks the address; rendering the tag would have the
	// reader's client call it.
	expect(diff.html).not.toContain("<img");
	expect(diff.html).not.toContain("tracker.example/pixel.gif");
	expect(diff.html).toContain("The funnel");
	expect(diff.html).toContain("tracker.example");
	expect(MARKDOWN_DIFF_CSS).toContain(".md-diff-image");
});

test("a rewrite is trimmed like anything else, and says what is missing", () => {
	const before = Array.from(
		{ length: 40 },
		(_, index) => `Paragraph ${index + 1}.`,
	).join("\n\n");
	const after = Array.from(
		{ length: 40 },
		(_, index) => `Rewritten paragraph ${index + 1}.`,
	).join("\n\n");
	const diff = renderMarkdownDiff({
		beforeMarkdown: `${before}\n`,
		afterMarkdown: `${after}\n`,
		maxLines: 8,
	});

	// Every line changed, so there is no context to drop: the budget has to
	// cut into the change itself rather than render the whole document.
	expect(diff.hidden).toBeGreaterThan(20);
	expect(diff.html).toContain("md-diff-gap");
	expect(diff.html).toMatch(/⋯ \d+ more lines/);
	expect(diff.html).not.toMatch(/⋯ \d+ unchanged lines/);
	expect(diff.html.match(/<p/g)?.length).toBeLessThanOrEqual(8);
});

test("a run of dropped context still reads as unchanged", () => {
	const items = Array.from(
		{ length: 40 },
		(_, index) => `- Item ${index + 1}`,
	).join("\n");
	const diff = renderMarkdownDiff({
		beforeMarkdown: `${items}\n`,
		afterMarkdown: `${items}\n- The new one\n`,
		maxLines: 6,
	});

	expect(diff.html).toMatch(/⋯ \d+ unchanged lines/);
});
