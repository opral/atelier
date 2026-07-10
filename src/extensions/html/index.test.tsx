import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { findFileHandlerExtension } from "@/extension-runtime/file-handlers";
import { BUILTIN_HIDDEN_EXTENSION_DEFINITIONS } from "@/extension-runtime/builtin-extension-registry";
import {
	HTML_ARTIFACT_CSP,
	HtmlPreview,
	buildSandboxedHtmlDocument,
	extension,
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

	test.each([
		"<!-- <head>decoy</head> --><html><head><title>Comment</title></head><body></body></html>",
		'<html data-note="x>y"><head data-note="x>y"><title>Attribute</title></head><body></body></html>',
		'<script>const decoy = "<head>";</script><html><head><title>Script</title></head><body></body></html>',
		"<template><head>decoy</head></template><html><head><title>Template</title></head><body></body></html>",
	])("cannot redirect policy injection with decoy markup", (source) => {
		expectPolicyIsFirstInHead(buildSandboxedHtmlDocument(source));
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

	test("replaces the iframe when the preview is refreshed", () => {
		render(
			<HtmlPreview
				data={new TextEncoder().encode("<button>Count</button>")}
				filePath="/artifacts/counter.html"
			/>,
		);

		const firstFrame = screen.getByTitle("counter.html HTML preview");
		fireEvent.click(
			screen.getByRole("button", { name: "Refresh HTML preview" }),
		);
		expect(screen.getByTitle("counter.html HTML preview")).not.toBe(firstFrame);
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
