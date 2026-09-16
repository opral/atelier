/**
 * The promise `@opral/atelier/render` makes: it runs where there is no DOM.
 *
 * The guarantee is about an entry point, so it has to be tested as one — a
 * barrel import or an editor extension pulled in by accident is invisible in
 * source review and costs megabytes in a worker. This walks the built
 * closure, the way a bundler would.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const entry = join(root, "dist/render.js");

/** Room for the views that render statically, and none for an editor. */
const MAX_CLOSURE_BYTES = 700 * 1024;

function closure(file, seen = new Set()) {
	if (seen.has(file)) return seen;
	seen.add(file);
	const source = readFileSync(file, "utf8");
	for (const match of source.matchAll(/from\s*"(\.\/[^"]+)"/g))
		closure(join(dirname(file), match[1]), seen);
	for (const match of source.matchAll(/import\s*\(\s*"(\.\/[^"]+)"\s*\)/g))
		closure(join(dirname(file), match[1]), seen);
	return seen;
}

test("the render entry is built", () => {
	assert.ok(existsSync(entry), "run pnpm build first");
	assert.ok(existsSync(join(root, "dist/render.css")));
});

/**
 * Code only. The bundler writes `//#region src/…/csv-document.ts` banners,
 * and a scan that reads those finds a DOM in a file name.
 */
function code(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.split("\n")
		.filter((line) => !line.trimStart().startsWith("//"))
		.join("\n");
}

test("the render entry needs no browser and no React", () => {
	const files = [...closure(entry)];
	const source = files
		.map((file) => code(readFileSync(file, "utf8")))
		.join("\n");
	assert.doesNotMatch(source, /from\s*"react/, "React reached the entry");
	// Any property access on the browser globals, whatever it is called, plus
	// the constructors a parser reaches for when it thinks it has a DOM. A
	// hyphenated name (`.atelier-document .md-diff-gap`, in the inlined
	// stylesheet) is a class, not the global.
	assert.doesNotMatch(source, /(?<![\w-])document\s*\.\s*\w/);
	assert.doesNotMatch(source, /(?<![\w-])window\s*\.\s*\w/);
	assert.doesNotMatch(source, /\b(DOMParser|XMLSerializer|HTMLElement)\b/);
	assert.doesNotMatch(source, /globalThis\s*\.\s*(document|window)\b/);
	const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
	assert.ok(
		bytes <= MAX_CLOSURE_BYTES,
		`closure is ${(bytes / 1024) | 0}kB, ceiling ${MAX_CLOSURE_BYTES / 1024}kB — check what was imported`,
	);
});

test("every view renders in plain node", async () => {
	const { toHtml, isRendered } = await import(entry);
	const encode = (value) => new TextEncoder().encode(value);

	const markdown = toHtml({ path: "/README.md", after: encode("# Acme\n") });
	assert.ok(isRendered(markdown));
	assert.equal(markdown.kind, "added");
	assert.match(markdown.html, /<h1>Acme<\/h1>/);

	// Each view separately: they are separate chunks, and a DOM dependency
	// arriving in one of them is invisible if only the other is exercised.
	const csv = toHtml({
		path: "/leads.csv",
		before: encode("id,v\n1,a\n"),
		after: encode("id,v\n1,b\n"),
	});
	assert.ok(isRendered(csv));
	assert.match(csv.html, /<table>/);
	assert.deepEqual(csv.counts, { added: 0, modified: 1, removed: 0 });
});
