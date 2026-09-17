import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { toHtml } from "@opral/atelier/render";
import * as atelier from "@opral/atelier";

// Exercise published conditional exports in Node without a DOM or database.
test("the explicit static renderer renders Markdown without a workspace snapshot", () => {
	const result = toHtml({
		path: "/README.md",
		after: new TextEncoder().encode(
			"# Production &amp; SSR\n\n**Rendered before JavaScript.**",
		),
	});
	assert.ok("html" in result);
	assert.match(result.html, /<h1[^>]*>Production &amp; SSR<\/h1>/);
	assert.match(result.html, /<strong>Rendered before JavaScript\.<\/strong>/);
});

test("the workspace API exposes no prepared startup compatibility entry", () => {
	assert.equal(typeof atelier.Atelier, "function");
	assert.equal("loadAtelier" in atelier, false);
	assert.equal("createAtelier" in atelier, false);
});

test("the opening skeleton renders without a Lix session", () => {
	const html = renderToString(
		createElement(atelier.AtelierSkeleton, null, "Opening repository…"),
	);
	assert.match(html, /Opening repository…/);
	assert.match(html, /<header/);
});
