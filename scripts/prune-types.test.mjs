/**
 * `prune-types.mjs` keeps an allowlist of declarations. A new public export
 * whose declaration is missing from it still builds, and reaches consumers
 * as `any`. This walks the published declarations from each entry point, as
 * a consumer's compiler would, and fails on any import that no longer
 * resolves.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const typesRoot = join(root, "dist/types");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function entryDeclarations() {
	return Object.values(packageJson.exports)
		.map((target) => (typeof target === "object" ? target.types : undefined))
		.filter((types) => typeof types === "string" && types.startsWith("./dist/types/"))
		.map((types) => types.slice("./dist/types/".length));
}

function unresolvedImports() {
	const seen = new Set();
	const queue = entryDeclarations();
	const unresolved = [];
	while (queue.length > 0) {
		const file = queue.pop();
		if (seen.has(file)) continue;
		seen.add(file);
		const source = readFileSync(join(typesRoot, file), "utf8");
		for (const match of source.matchAll(
			/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g,
		)) {
			const specifier = match[1];
			// Side-effect stylesheet imports carry no types.
			if (specifier.endsWith(".css")) continue;
			const base = posix
				.normalize(posix.join(posix.dirname(file), specifier))
				.replace(/\.js$/, "");
			const candidate = [`${base}.d.ts`, `${base}/index.d.ts`].find((path) =>
				existsSync(join(typesRoot, path)),
			);
			if (candidate) queue.push(candidate);
			else unresolved.push(`${file} -> ${specifier}`);
		}
	}
	return unresolved;
}

test("every declaration a public entry reaches survives pruning", (t) => {
	if (!existsSync(typesRoot)) {
		t.skip("dist/types is missing; run pnpm build first");
		return;
	}
	assert.deepEqual(unresolvedImports(), []);
});
