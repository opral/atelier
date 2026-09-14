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
	// stylesheet, and never has to know what either is called.
	expect(markdown.html.startsWith('<div class="md-diff">')).toBe(true);

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
	expect(result.html).toContain("--atelier-ink");
	expect(result.html).toContain('class="atelier-render"');
	expect(result.html).not.toContain("<script");
	expect(result.html).not.toContain("<link");
});

test("the palette is tokens a host can redefine, not literals in rules", () => {
	const [tokens, ...rules] = RENDER_CSS.split("}\n");
	expect(tokens).toContain("--atelier-ink");
	// Every colour in a rule comes from a token, so a host retints by
	// redefining one custom property and nothing here has to know.
	const literals = rules
		.join("}\n")
		.match(/(?:rgb|rgba|hsl)\(|#[0-9a-fA-F]{3,8}\b/g);
	expect(literals).toBe(null);
});
