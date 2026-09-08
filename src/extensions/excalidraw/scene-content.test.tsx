// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { SceneContent } from "./scene-content";

const render = (elements: Record<string, unknown>[], files = {}) =>
	renderToStaticMarkup(
		<SceneContent
			content={JSON.stringify({ type: "excalidraw", elements, files })}
		/>,
	);

test("renders seeded rough fills and strokes deterministically without a browser", () => {
	const elements = [
		{
			id: "box",
			type: "rectangle",
			x: 0,
			y: 0,
			width: 100,
			height: 80,
			seed: 42,
			roughness: 2,
			backgroundColor: "#ff0000",
			fillStyle: "cross-hatch",
			strokeStyle: "dashed",
			strokeWidth: 2,
		},
	];
	const html = render(elements);
	expect(html).toBe(render(elements));
	expect(html).toContain('stroke-dasharray="16 16"');
	expect(html).toContain('stroke="#ff0000"');
	expect(html.match(/<path/g)?.length).toBeGreaterThan(1);
	expect(html).not.toBe(render([{ ...elements[0], seed: 43 }]));
});

test("renders arrowheads, pressure-sensitive freehand, aligned text and rotated bounds", () => {
	const html = render([
		{
			type: "arrow",
			width: 100,
			height: 10,
			points: [
				[0, 0],
				[100, 10],
			],
			startArrowhead: "dot",
			endArrowhead: "triangle",
		},
		{
			type: "freedraw",
			strokeWidth: 2,
			points: [
				[0, 0],
				[10, 5],
				[20, 0],
			],
			pressures: [0.1, 1, 0.1],
			simulatePressure: false,
		},
		{
			type: "text",
			text: "One\nTwo",
			width: 100,
			height: 80,
			textAlign: "center",
			verticalAlign: "middle",
			fontSize: 20,
			lineHeight: 1.5,
		},
	]);
	expect(html).toContain('data-arrowhead="triangle"');
	expect(html).toContain('data-arrowhead="dot"');
	expect(html).toContain('text-anchor="middle"');
	expect(html).toContain('<tspan x="50" y="10">One</tspan>');
	expect(html).toContain('<tspan x="50" y="40">Two</tspan>');
	expect(html).toMatch(/<path d="M [^"]+ Z" fill="#222" stroke="none"/);
	const rotated = render([
		{
			type: "rectangle",
			x: 100,
			y: 100,
			width: 100,
			height: 100,
			angle: Math.PI / 4,
		},
	]);
	const viewBox = rotated
		.match(/viewBox="([^"]+)"/)![1]!
		.split(" ")
		.map(Number);
	expect(viewBox[0]).toBeLessThan(56);
	expect(viewBox[2]).toBeGreaterThan(189);
});

test("embeds safe raster scene images with flips and rejects executable and remote assets", () => {
	const element = {
		type: "image",
		fileId: "asset",
		width: 80,
		height: 60,
		scale: [-1, 1],
	};
	const html = render([element], {
		asset: { dataURL: "data:image/png;base64,YWJj" },
	});
	expect(html).toContain('<image href="data:image/png;base64,YWJj"');
	expect(html).toContain("translate(80 0) scale(-1 1)");
	for (const url of [
		"javascript:alert(1)",
		"https://example.com/track.png",
		"data:image/svg+xml;base64,YWJj",
	]) {
		const unsafe = render([element], { asset: { dataURL: url } });
		expect(unsafe).not.toContain("<image");
		expect(unsafe).toContain("Image unavailable");
	}
});

test("normalizes out-of-range seeds without invoking nondeterministic randomness", () => {
	const random = vi.spyOn(Math, "random").mockImplementation(() => {
		throw new Error("Unseeded randomness during SSR");
	});
	try {
		for (const seed of [0, 2 ** 31, 2 ** 32, -(2 ** 32)]) {
			const elements = [
				{
					type: "rectangle",
					seed,
					width: 100,
					height: 80,
					backgroundColor: "#f00",
					fillStyle: "hachure",
				},
			];
			expect(render(elements)).toBe(render(elements));
		}
	} finally {
		random.mockRestore();
	}
});

test("rejects excessive SVG generation work before entering rough fill loops", () => {
	const html = render([
		{
			type: "rectangle",
			width: 1e100,
			height: 1e100,
			backgroundColor: "#f00",
			fillStyle: "hachure",
		},
	]);
	const excessivePoints = render([
		{ type: "freedraw", points: Array.from({ length: 50_001 }, () => [0, 0]) },
	]);
	expect(html).toContain("too large to preview");
	expect(excessivePoints).toContain("too large to preview");
	expect(html).not.toContain("<svg");
});
