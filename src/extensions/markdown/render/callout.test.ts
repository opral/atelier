import { expect, test } from "vitest";
import { RENDER_CSS } from "../../../render/styles";
import { calloutIconSvg } from "../editor/tiptap-markdown-bridge/callout";
import { renderMarkdownDiff, renderMarkdownDocument } from "./index";

test("a callout renders with the editor's structure and classes", () => {
	const html = renderMarkdownDocument(
		"> [!WARNING] Mind the gap\n> Stand back.\n",
	);

	expect(html).toBe(
		[
			'<div class="markdown-callout" data-callout-family="warning" data-callout-kind="warning" role="note">',
			`<span class="markdown-callout-icon" aria-hidden="true">${calloutIconSvg("warning")}</span>`,
			'<div class="markdown-callout-content">',
			'<div class="markdown-callout-title">Mind the gap</div>',
			"<p>Stand back.</p>",
			"</div></div>",
		].join(""),
	);
	expect(RENDER_CSS).toContain(".markdown-callout");
});

test("an untitled callout writes its kind's name into the title", () => {
	const html = renderMarkdownDocument("> [!example]\n> Body\n");

	expect(html).toContain('data-callout-family="default"');
	expect(html).toContain('data-callout-kind="example"');
	expect(html).toContain('<div class="markdown-callout-title">Example</div>');
	expect(html).not.toContain("data-empty");
	expect(html).not.toContain("[!");
});

test("a foldable callout is a details element the browser folds", () => {
	const open = renderMarkdownDocument("> [!tip]+ Shortcuts\n> Press ?\n");
	const closed = renderMarkdownDocument("> [!faq]- Why?\n> Because.\n");

	expect(open).toMatch(
		/^<details class="markdown-callout" data-callout-family="tip" data-callout-kind="tip" open><summary class="markdown-callout-summary"><span class="markdown-callout-icon"/,
	);
	expect(open).toContain(
		'<span class="markdown-callout-title">Shortcuts</span></summary><div class="markdown-callout-content"><p>Press ?</p></div></details>',
	);
	expect(closed).toMatch(
		/^<details class="markdown-callout" data-callout-family="warning" data-callout-kind="faq"><summary/,
	);
	expect(closed).not.toMatch(/<details[^>]* open>/);
	// The list marker is hidden and a chevron drawn in its place.
	expect(RENDER_CSS).toContain(
		".markdown-callout-summary::-webkit-details-marker",
	);
	expect(RENDER_CSS).toContain(".markdown-callout-summary::after");
});

test("a callout's title and inline marks escape like any other text", () => {
	const html = renderMarkdownDocument(
		'> [!NOTE] <b>"hi"</b> **bold**\n> Body\n',
	);

	expect(html).toContain("&lt;b&gt;");
	expect(html).toContain("<strong>bold</strong>");
	expect(html).not.toContain("<b>");
});

test("a changed kind shows as a modified callout with a 'was' pill", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: "> [!NOTE] Before you deploy\n> Run the migrations.\n",
		afterMarkdown: "> [!WARNING] Before you deploy\n> Run the migrations.\n",
	});

	expect(diff.unchanged).toBe(false);
	expect(diff.stats).toEqual({ added: 0, removed: 0, modified: 1 });
	expect(diff.html).toContain(
		'<div class="markdown-callout" data-callout-family="warning" data-callout-kind="warning" data-review-status="modified" role="note">',
	);
	expect(diff.html).toContain(
		'<div class="markdown-callout-title">Before you deploy<span class="markdown-callout-was" title="Was Note">was <s>Note</s></span></div>',
	);
	expect(RENDER_CSS).toContain(".markdown-callout-was");
});

test("a callout's body and title diff word by word inside it", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: "> [!TIP] Ship on Friday\n> Run the checks first.\n",
		afterMarkdown: "> [!TIP] Ship on Monday\n> Run the smoke checks first.\n",
	});

	expect(diff.stats).toEqual({ added: 0, removed: 0, modified: 2 });
	expect(diff.html).not.toContain(
		'class="markdown-callout" data-callout-family="tip" data-callout-kind="tip" data-review-status',
	);
	expect(diff.html).toContain(
		'<div class="markdown-callout-title">Ship on <span data-review-status="removed">Friday</span><span data-review-status="added">Monday</span></div>',
	);
	expect(diff.html).toContain('<span data-review-status="added">smoke </span>');
	expect(diff.html).not.toContain("markdown-callout-was");
});

test("a removed title leaves the kind's name after it, struck title first", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: "> [!NOTE] Old title\n> Body\n",
		afterMarkdown: "> [!NOTE]\n> Body\n",
	});

	expect(diff.html).toContain(
		'<div class="markdown-callout-title"><span data-review-status="removed">Old title</span> Note</div>',
	);
});

test("a marker's spelling alone is not painted", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: "> [!NOTE]\n> Body\n",
		afterMarkdown: "> [!note]\n> Body\n",
	});

	expect(diff.html).not.toContain("data-review-status");
	expect(diff.stats).toEqual({ added: 0, removed: 0, modified: 0 });
});

test("a folded callout whose body changed renders open", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: "> [!faq]- Why?\n> Because.\n",
		afterMarkdown: "> [!faq]- Why?\n> Because it is.\n",
	});

	expect(diff.html).toMatch(/^<details [^>]* open>/);
	expect(diff.html).toContain('<span data-review-status="added"> it is</span>');
});

test("an added callout is marked whole and counts its lines", () => {
	const diff = renderMarkdownDiff({
		beforeMarkdown: "Intro.\n",
		afterMarkdown: "Intro.\n\n> [!CAUTION] Heads up\n> Data loss.\n",
	});

	expect(diff.stats).toEqual({ added: 2, removed: 0, modified: 0 });
	expect(diff.html).toContain(
		'data-callout-family="caution" data-callout-kind="caution" data-review-status="added" role="note"',
	);
});

test("a long callout is trimmed like a quote and keeps its title", () => {
	const body = Array.from({ length: 30 }, (_, index) => `> Line ${index}.`);
	const before = ["> [!NOTE] Checklist", ...body.flatMap((line) => [line, ">"])]
		.slice(0, -1)
		.join("\n");
	const after = before.replace("> Line 25.", "> Line twenty-five.");
	const diff = renderMarkdownDiff({
		beforeMarkdown: `${before}\n`,
		afterMarkdown: `${after}\n`,
		maxLines: 5,
	});

	expect(diff.html).toContain(
		'<div class="markdown-callout-title">Checklist</div>',
	);
	expect(diff.html).toContain("twenty-five");
	expect(diff.html).toContain('class="md-diff-gap"');
	expect(diff.html).not.toContain("Line 2.");
	expect(diff.hidden).toBeGreaterThan(0);
});
