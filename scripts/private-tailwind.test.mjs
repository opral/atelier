import assert from "node:assert/strict";
import test from "node:test";
import { isolateTailwind } from "./private-tailwind.mjs";

test("scopes Tailwind's universal variable fallback to Atelier", () => {
	const css = isolateTailwind(
		"@layer properties { *, ::before, ::after, ::backdrop { --tw-ring-inset: ; } }",
	);
	assert.match(css, /:where\(\.atelier-root, \.atelier-portal\) \*/);
	assert.doesNotMatch(css, /\{ \*,/);
});

test("keeps utilities that only set private variables on their class", () => {
	const css = isolateTailwind(
		".atw\\:ring-accent { --tw-ring-color: var(--atelier-accent); }\n.atw\\:ring-inset { --tw-ring-inset: inset; }",
	);
	assert.match(css, /\.atw\\:ring-accent \{ --atw-tw-ring-color/);
	assert.match(css, /\.atw\\:ring-inset \{ --atw-tw-ring-inset: inset/);
	assert.doesNotMatch(css, /atelier-root/);
});

test("leaves nested and mixed selectors alone", () => {
	const css = isolateTailwind(
		".x { &:focus-visible { --tw-ring-color: red; } }\n*, .foo { --tw-a: 1; }",
	);
	assert.match(css, /&:focus-visible \{ --atw-tw-ring-color: red/);
	assert.match(css, /\*, \.foo \{ --atw-tw-a: 1/);
	assert.doesNotMatch(css, /atelier-root/);
});
