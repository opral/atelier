import assert from "node:assert/strict";
import test from "node:test";
import { openLix } from "@lix-js/sdk";
import { Atelier, loadAtelier } from "@opral/atelier";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// Import the published build in real Node, without a bundler or DOM globals.
// This catches browser conditional exports and external CSS imports that source
// Vitest tests do not exercise.
test("the published package renders a closed Lix snapshot in Node", async () => {
	const lix = await openLix();
	let initialState;
	try {
		await lix.execute("INSERT INTO lix_file(path, content) VALUES($1, $2)", [
			"/README.md",
			new TextEncoder().encode(
				"# Production &amp; SSR\n\n**Rendered before JavaScript.**",
			),
		]);
		initialState = await loadAtelier({
			lix,
			location: { path: "/README.md" },
			readOnly: true,
		});
	} finally {
		await lix.close();
	}
	const html = renderToString(
		createElement(Atelier, {
			initialState: JSON.parse(JSON.stringify(initialState)),
		}),
	);
	assert.match(html, /<h1[^>]*>Production &amp; SSR<\/h1>/);
	assert.match(html, /<strong>Rendered before JavaScript\.<\/strong>/);
	assert.doesNotMatch(html, /Switched to client rendering/);
});

test("published drawing and large media previews render without browser globals", async () => {
	const lix = await openLix();
	let drawing, media;
	try {
		await lix.execute("INSERT INTO lix_file(path, content) VALUES($1, $2)", [
			"/drawing.excalidraw",
			new TextEncoder().encode(
				JSON.stringify({
					type: "excalidraw",
					elements: [
						{
							id: "box",
							type: "rectangle",
							x: 0,
							y: 0,
							width: 100,
							height: 80,
							seed: 42,
							roughness: 1,
							strokeColor: "#333333",
							backgroundColor: "#aaffcc",
							fillStyle: "hachure",
						},
					],
				}),
			),
		]);
		await lix.execute("INSERT INTO lix_file(path, content) VALUES($1, $2)", [
			"/large.mp4",
			new Uint8Array(2 * 1024 * 1024),
		]);
		drawing = await loadAtelier({
			lix,
			location: { path: "/drawing.excalidraw" },
			readOnly: true,
		});
		media = await loadAtelier({
			lix,
			location: { path: "/large.mp4" },
			readOnly: true,
		});
	} finally {
		await lix.close();
	}
	const render = (initialState) =>
		renderToString(
			createElement(Atelier, {
				initialState: JSON.parse(JSON.stringify(initialState)),
				navigation: { href: () => "/", fileHref: () => "/raw/large.mp4" },
			}),
		);
	assert.match(render(drawing), /<svg[^>]*[\s\S]*<path/);
	const html = render(media);
	assert.match(html, /<video[^>]*src="\/raw\/large.mp4"/);
	assert.doesNotMatch(html, /Switched to client rendering|Preview loads when/);
	assert.ok(
		JSON.stringify(media).length < 100000,
		"large binary is absent from serialized state",
	);
});
