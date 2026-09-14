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

test("the render entry needs no browser and no React", () => {
	const files = [...closure(entry)];
	const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
	assert.doesNotMatch(source, /from\s*"react/, "React reached the entry");
	assert.doesNotMatch(source, /\bdocument\.(createElement|querySelector)\b/);
	assert.doesNotMatch(source, /\bwindow\.[a-z]/);
	const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
	assert.ok(
		bytes <= MAX_CLOSURE_BYTES,
		`closure is ${(bytes / 1024) | 0}kB, ceiling ${MAX_CLOSURE_BYTES / 1024}kB — check what was imported`,
	);
});

test("the entry renders in plain node", async () => {
	const { toHtml, isRendered } = await import(entry);
	const result = toHtml({
		path: "/README.md",
		after: new TextEncoder().encode("# Acme\n"),
	});
	assert.ok(isRendered(result));
	assert.equal(result.kind, "added");
	assert.match(result.html, /<h1>Acme<\/h1>/);
});
