import { expect, test } from "vitest";
import { isRendered, RENDER_CSS, toHtml } from "./render";

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

test("a change renders in the file type's own view", () => {
	const markdown = toHtml({
		path: "/gtm/playbook.md",
		before: bytes("- [ ] Company brain\n"),
		after: bytes("- [ ] Company brain\n- [ ] AI consultants\n"),
	});
	expect(isRendered(markdown)).toBe(true);
	if (!isRendered(markdown)) return;
	expect(markdown.kind).toBe("modified");
	expect(markdown.counts).toEqual({ added: 1, modified: 0, removed: 0 });
	expect(markdown.html).toContain('data-review-status="added"');
	// A view carries its own scope class: a caller inlines the HTML and the
	// stylesheet, and never has to know what either is called. The document
	// class is the editor's too: one stylesheet for both.
	expect(
		markdown.html.startsWith('<div class="md-diff atelier-document">'),
	).toBe(true);

	const csv = toHtml({
		path: "/leads.csv",
		before: bytes("name,stage\nAcme,lead\n"),
		after: bytes("name,stage\nAcme,qualified\nBeta,lead\n"),
	});
	expect(isRendered(csv)).toBe(true);
	if (!isRendered(csv)) return;
	expect(csv.kind).toBe("modified");
	// Rows are what a CSV counts, the way lix counts entities.
	expect(csv.counts).toEqual({ added: 1, modified: 1, removed: 0 });
	expect(csv.html).toContain("<table>");
	expect(csv.html).toContain("qualified");
});

test("which side is missing says what happened", () => {
	const created = toHtml({ path: "/README.md", after: bytes("# Acme\n") });
	const deleted = toHtml({ path: "/old.md", before: bytes("# Old\n") });
	expect(isRendered(created) && created.kind).toBe("added");
	expect(isRendered(deleted) && deleted.kind).toBe("removed");
	// A file that was created is a change like any other, and gets the same
	// view: every line of it marked, not a plain document that happens to be
	// new.
	expect(isRendered(created) && created.html).toContain(
		'data-review-status="added"',
	);
	expect(isRendered(created) && created.counts).toEqual({
		added: 1,
		modified: 0,
		removed: 0,
	});
	expect(isRendered(deleted) && deleted.html).toContain(
		'data-review-status="removed"',
	);
	// An empty file that existed is not a file that did not.
	const emptied = toHtml({
		path: "/README.md",
		before: bytes(""),
		after: bytes("# Acme\n"),
	});
	expect(isRendered(emptied) && emptied.kind).toBe("modified");
});

test("a view that cannot draw a file says so instead of failing", () => {
	expect(toHtml({ path: "/slides.pdf", after: bytes("%PDF") })).toEqual({
		skipped: "unsupported",
	});
	expect(toHtml({ path: "/Makefile", after: bytes("all:\n") })).toEqual({
		skipped: "unsupported",
	});
	expect(
		toHtml({
			path: "/a.md",
			before: bytes("# Same\n"),
			after: bytes("# Same\n"),
		}),
	).toEqual({ skipped: "unchanged" });
	expect(toHtml({ path: "/a.md" })).toEqual({ skipped: "empty" });
	expect(toHtml({ path: "/a.md", after: bytes("x".repeat(200_000)) })).toEqual({
		skipped: "too-large",
	});
	// Bytes that are not text have no diff a reader could read.
	expect(
		toHtml({
			path: "/a.md",
			before: new Uint8Array([0xff, 0xfe, 0x00]),
			after: bytes("# Hi\n"),
		}),
	).toEqual({ skipped: "unsupported" });
});

test("a budget trims the render and says what it left out", () => {
	const rows = Array.from({ length: 60 }, (_, index) => `- Item ${index + 1}`);
	const result = toHtml(
		{
			path: "/list.md",
			before: bytes(`${rows.join("\n")}\n`),
			after: bytes(`${rows.join("\n")}\n- The new one\n`),
		},
		{ maxBytes: 8_000 },
	);
	expect(isRendered(result)).toBe(true);
	if (!isRendered(result)) return;
	expect(result.hidden).toBeGreaterThan(30);
	expect(result.html).toContain("The new one");
	expect(new TextEncoder().encode(result.html).length).toBeLessThanOrEqual(
		8_000,
	);
});

test("a document carries its own styles and nothing else", () => {
	const result = toHtml(
		{ path: "/README.md", after: bytes("# Acme\n\nOne repository.\n") },
		{ document: true },
	);
	expect(isRendered(result)).toBe(true);
	if (!isRendered(result)) return;
	expect(result.html.startsWith("<!doctype html>")).toBe(true);
	expect(result.html).toContain("--atelier-fg");
	expect(result.html).toContain('class="atelier-render"');
	expect(result.html).not.toContain("<script");
	expect(result.html).not.toContain("<link");
});

test("the palette is tokens a host can redefine, not literals in rules", () => {
	const [tokens, ...rules] = RENDER_CSS.split("}\n");
	expect(tokens).toContain("--atelier-fg");
	// Every colour in a rule comes from a token, so a host retints by
	// redefining one custom property and nothing here has to know.
	const literals = rules
		.join("}\n")
		.match(/(?:rgb|rgba|hsl)\(|#[0-9a-fA-F]{3,8}\b/g);
	expect(literals).toBe(null);
});

test("a file created, emptied or deleted is never called unchanged", () => {
	const csv = "id,v\n1,a\n";
	// Created empty, deleted, truncated: three different things, none of them
	// "nothing changed".
	expect(toHtml({ path: "/a.csv", after: bytes("") })).toEqual({
		skipped: "empty",
	});
	expect(toHtml({ path: "/a.csv", before: bytes("") })).toEqual({
		skipped: "empty",
	});
	const truncated = toHtml({
		path: "/a.csv",
		before: bytes(csv),
		after: bytes(""),
	});
	expect(isRendered(truncated) && truncated.kind).toBe("modified");
	// The header was a line too, and it went with the row.
	expect(isRendered(truncated) && truncated.counts).toEqual({
		added: 0,
		modified: 0,
		removed: 2,
	});
	// A file of separators is not a table.
	expect(
		toHtml({ path: "/a.csv", before: bytes(",,\n"), after: bytes(",,,\n") }),
	).toEqual({
		skipped: "empty",
	});
});

test("a renamed column counts as a change, as the table shows it", () => {
	const renamed = toHtml({
		path: "/leads.csv",
		before: bytes("id,name\n1,a\n"),
		after: bytes("id,title\n1,a\n"),
	});

	expect(isRendered(renamed)).toBe(true);
	if (!isRendered(renamed)) return;
	expect(renamed.counts).toEqual({ added: 0, modified: 1, removed: 0 });
	expect(renamed.html).toContain('data-diff-status="added"');
});

test("the budget is measured against the view, document or not", () => {
	// One paragraph, with nothing the trim can leave out: the view is over
	// the budget however it is asked for, and the document wrapper's
	// stylesheet — which the caller asked for — is not what put it there.
	const long = `${"paragraph ".repeat(200)}\n`;
	for (const document of [false, true])
		expect(
			toHtml(
				{ path: "/b.md", after: bytes(long) },
				{ maxBytes: 1_000, document },
			),
		).toEqual({ skipped: "too-large" });
	// A document the trim can shorten fits instead, and says how much it left.
	const many = `${Array.from({ length: 200 }, (_, index) => `Paragraph ${index + 1}.`).join("\n\n")}\n`;
	const trimmed = toHtml(
		{ path: "/b.md", after: bytes(many) },
		{
			maxBytes: 1_000,
		},
	);
	expect(isRendered(trimmed) && trimmed.hidden).toBeGreaterThan(0);
});

test("a path that names a directory has no view", () => {
	expect(toHtml({ path: "/a.md/", after: bytes("# Hi\n") })).toEqual({
		skipped: "unsupported",
	});
	expect(toHtml({ path: "/docs/notes.csv/", after: bytes("id\n") })).toEqual({
		skipped: "unsupported",
	});
	// Case is not part of a file type.
	expect(isRendered(toHtml({ path: "/A.MD", after: bytes("# Hi\n") }))).toBe(
		true,
	);
});

test("a table is measured by the side that has the rows", () => {
	const many = `id,v\n${Array.from({ length: 3_000 }, (_, i) => `${i},a`).join("\n")}\n`;
	expect(
		toHtml({
			path: "/big.csv",
			before: bytes(many),
			after: bytes("id,v\n0,a\n"),
		}),
	).toEqual({ skipped: "too-large" });
});

test("a ledger is trimmed to the rows that changed", () => {
	const rows = Array.from({ length: 120 }, (_, index) => `${index},acme,open`);
	const before = `id,account,state\n${rows.join("\n")}\n`;
	const after = before.replace("60,acme,open", "60,acme,closed");
	const result = toHtml(
		{ path: "/ledger.csv", before: bytes(before), after: bytes(after) },
		{ maxBytes: 11_000 },
	);

	expect(isRendered(result)).toBe(true);
	if (!isRendered(result)) return;
	// The edit survives; the untouched bulk does not.
	expect(result.counts).toEqual({ added: 0, modified: 1, removed: 0 });
	expect(result.html).toContain("closed");
	expect(result.hidden).toBeGreaterThan(100);
	expect(new TextEncoder().encode(result.html).length).toBeLessThanOrEqual(
		11_000,
	);
	// A row is dropped from both sides or from neither, so nothing that
	// stayed reads as a deletion.
	const removed = result.html.match(/data-diff-status="removed"/g) ?? [];
	expect(removed.length).toBeLessThan(3);
});

test("a host retints by redefining a token on an ancestor", () => {
	// The tokens are declared on the root, so the nearest ancestor that
	// redefines one wins. Declared on the render itself they would beat the
	// host every time, and the override would silently do nothing.
	expect(RENDER_CSS.startsWith(":root")).toBe(true);
	expect(RENDER_CSS).not.toContain(".atelier-render {\n\t--atelier-fg:");
});

test("a script the word differ cannot split is compared whole", () => {
	// Arabic has no ASCII word boundaries, so a word-level diff returns the
	// two versions interleaved letter by letter. The cell is marked changed
	// instead, which a reader can actually read.
	const result = toHtml({
		path: "/i18n.csv",
		before: bytes("key,ar\ncancel,إلغاء\n"),
		after: bytes("key,ar\ncancel,إغلاق\n"),
	});

	expect(isRendered(result)).toBe(true);
	if (!isRendered(result)) return;
	expect(result.html).toContain('data-diff-status="modified"');
	expect(result.html).toContain("إغلاق");
	// No fragment of one word wearing the other's colour.
	expect(result.html).not.toMatch(/إ<span/);
	// ASCII cells keep their word-level comparison.
	const latin = toHtml({
		path: "/i18n.csv",
		before: bytes("key,en\ncancel,Cancel now\n"),
		after: bytes("key,en\ncancel,Close now\n"),
	});
	expect(isRendered(latin) && latin.html).toContain('data-diff-mode="words"');
});

test("bytes that are not text are refused, not mangled", () => {
	// One strict reader for every view: a PNG at a .csv path used to reach the
	// grid as replacement characters, because one decoder of four was lenient.
	const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	for (const path of ["/logo.csv", "/logo.md"])
		expect(toHtml({ path, before: bytes("id\n1\n"), after: png })).toEqual({
			skipped: "unsupported",
		});
});
