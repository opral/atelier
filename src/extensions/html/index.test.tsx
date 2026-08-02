import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { findFileHandlerExtension } from "@/extension-runtime/file-handlers";
import { BUILTIN_HIDDEN_EXTENSION_DEFINITIONS } from "@/extension-runtime/builtin-extension-registry";
import {
	HTML_ARTIFACT_CSP,
	HtmlPreview,
	buildSandboxedHtmlDocument,
	collectHtmlWorkspaceImagePaths,
	extension,
	resolveHtmlWorkspaceImagePath,
} from "./index";

describe("HTML extension routing", () => {
	test.each(["/artifacts/report.html", "/artifacts/report.HTM"])(
		"handles %s",
		(path) => {
			expect(findFileHandlerExtension([extension], path)).toBe(extension);
		},
	);

	test("does not handle unrelated files", () => {
		expect(
			findFileHandlerExtension([extension], "/artifacts/report.md"),
		).toBeUndefined();
	});

	test("is registered as a hidden built-in file view", () => {
		expect(BUILTIN_HIDDEN_EXTENSION_DEFINITIONS).toContain(extension);
	});
});

describe("buildSandboxedHtmlDocument", () => {
	test("injects the artifact policy into an existing head", () => {
		const result = buildSandboxedHtmlDocument(
			"<!doctype html><html><head><title>Demo</title></head><body>Hi</body></html>",
		);
		expectPolicyIsFirstInHead(result);
		expect(result).toContain("<title>Demo</title>");
	});

	test("creates a head when the document omits one", () => {
		const result = buildSandboxedHtmlDocument("<html><body>Hi</body></html>");
		expectPolicyIsFirstInHead(result);
		expect(result).toContain("<body>Hi</body>");
	});

	test("allows remote images without opening other network capabilities", () => {
		expect(HTML_ARTIFACT_CSP).toContain("img-src data: blob: http: https:");
		expect(HTML_ARTIFACT_CSP).toContain("connect-src 'none'");
	});

	test("rewrites local image sources to resolved workspace URLs", () => {
		const result = buildSandboxedHtmlDocument(
			'<img src="images/hero.png"><img src="https://example.com/remote.png"><picture><source srcset="images/hero.png 1x, /shared/hero@2x.png 2x"></picture>',
			{
				filePath: "/artifacts/report.html",
				workspaceImageUrls: new Map([
					["/artifacts/images/hero.png", "blob:hero"],
					["/shared/hero@2x.png", "blob:hero-2x"],
				]),
			},
		);
		expect(result).toContain('<img src="blob:hero">');
		expect(result).toContain('src="https://example.com/remote.png"');
		expect(result).toContain('srcset="blob:hero 1x, blob:hero-2x 2x"');
	});

	test.each([
		"<!-- <head>decoy</head> --><html><head><title>Comment</title></head><body></body></html>",
		'<html data-note="x>y"><head data-note="x>y"><title>Attribute</title></head><body></body></html>',
		'<script>const decoy = "<head>";</script><html><head><title>Script</title></head><body></body></html>',
		"<template><head>decoy</head></template><html><head><title>Template</title></head><body></body></html>",
	])("cannot redirect policy injection with decoy markup", (source) => {
		expectPolicyIsFirstInHead(buildSandboxedHtmlDocument(source));
	});
});

describe("HTML workspace images", () => {
	test.each([
		["images/photo.png", "/docs/report.html", "/docs/images/photo.png"],
		["../photo.png?size=2#preview", "/docs/report.html", "/photo.png"],
		["/assets/photo%20one.png", "/docs/report.html", "/assets/photo one.png"],
		["https://example.com/photo.png", "/docs/report.html", null],
		["data:image/png;base64,AAAA", "/docs/report.html", null],
		["#embedded-image", "/docs/report.html", null],
	])("resolves %s from %s", (src, filePath, expected) => {
		expect(resolveHtmlWorkspaceImagePath(src, filePath)).toBe(expected);
	});

	test("collects unique image and srcset workspace paths", () => {
		expect(
			collectHtmlWorkspaceImagePaths(
				'<img src="images/a.png"><img src="images/a.png"><source srcset="images/a.png 1x, ../b.png 2x"><svg><image href="/c.svg"></image></svg>',
				"/docs/report.html",
			),
		).toEqual(["/b.png", "/c.svg", "/docs/images/a.png"]);
	});

	test("does not treat data srcset payloads as workspace paths", () => {
		expect(
			collectHtmlWorkspaceImagePaths(
				'<img srcset="data:image/png;base64,AAAA 1x">',
				"/docs/report.html",
			),
		).toEqual([]);
	});
});

describe("HtmlPreview", () => {
	test("decodes and isolates the HTML document", () => {
		render(
			<HtmlPreview
				data={new TextEncoder().encode(
					"<!doctype html><html><body><h1>Hello</h1></body></html>",
				)}
				filePath="/artifacts/demo.html"
			/>,
		);

		const frame = screen.getByTitle("demo.html HTML preview");
		expect(frame).toHaveAttribute("sandbox", "allow-scripts");
		expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
		expect(frame.getAttribute("srcdoc")).toContain("<h1>Hello</h1>");
		expect(frame.getAttribute("srcdoc")).toContain(HTML_ARTIFACT_CSP);
	});

	test("updates the document when file data changes", () => {
		const { rerender } = render(
			<HtmlPreview
				data={new TextEncoder().encode("<p>Before</p>")}
				filePath="/artifacts/status.html"
			/>,
		);
		rerender(
			<HtmlPreview
				data={new TextEncoder().encode("<p>After</p>")}
				filePath="/artifacts/status.html"
			/>,
		);
		expect(
			screen.getByTitle("status.html HTML preview").getAttribute("srcdoc"),
		).toContain("<p>After</p>");
	});

	test("shows loading again when the iframe document changes", () => {
		const { rerender } = render(
			<HtmlPreview
				data={new TextEncoder().encode("<p>Before</p>")}
				filePath="/artifacts/status.html"
			/>,
		);
		const firstFrame = screen.getByTitle("status.html HTML preview");
		expect(screen.getByText("Loading HTML preview…")).toBeInTheDocument();
		fireEvent.load(firstFrame);
		expect(screen.queryByText("Loading HTML preview…")).toBeNull();

		rerender(
			<HtmlPreview
				data={new TextEncoder().encode("<p>After</p>")}
				filePath="/artifacts/status.html"
			/>,
		);

		const secondFrame = screen.getByTitle("status.html HTML preview");
		expect(secondFrame).not.toBe(firstFrame);
		expect(screen.getByText("Loading HTML preview…")).toBeInTheDocument();
		fireEvent.load(secondFrame);
		expect(screen.queryByText("Loading HTML preview…")).toBeNull();
	});

	test("shows a clear state for unsupported paths", () => {
		render(
			<HtmlPreview
				data={new TextEncoder().encode("<p>Hello</p>")}
				filePath="/artifacts/demo.txt"
			/>,
		);
		expect(
			screen.getByText("This file cannot be displayed as HTML."),
		).toBeInTheDocument();
		expect(screen.queryByTitle(/HTML preview/)).toBeNull();
	});
});

function expectPolicyIsFirstInHead(source: string) {
	const artifactDocument = new DOMParser().parseFromString(source, "text/html");
	const policy = artifactDocument.head.firstElementChild;
	expect(policy?.tagName).toBe("META");
	expect(policy).toHaveAttribute("http-equiv", "Content-Security-Policy");
	expect(policy).toHaveAttribute("content", HTML_ARTIFACT_CSP);
}
