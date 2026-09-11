// @vitest-environment jsdom
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, expect, test } from "vitest";
import { MarkdownWc } from "../tiptap-markdown-bridge";
import { parseMarkdown } from "../markdown";
import { astToTiptapDoc } from "../tiptap-markdown-bridge/mdwc-to-tiptap";
import { DocumentLinkIconsExtension } from "./document-link-icons";

const editors: Editor[] = [];
afterEach(() => {
	for (const editor of editors.splice(0)) editor.destroy();
});

test("links to existing files get an icon; missing targets are marked", () => {
	const known = new Map<string, boolean>([
		["/docs/pipeline.csv", true],
		["/docs/missing.md", false],
	]);
	const listeners = new Set<() => void>();
	const element = document.createElement("div");
	document.body.appendChild(element);
	const editor = new Editor({
		element,
		extensions: [
			...(MarkdownWc() as any[]),
			DocumentLinkIconsExtension.configure({
				sourceFilePath: "/docs/readme.md",
				exists: (path) => known.get(path),
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				// The host's permanent URL for the pipeline file.
				resolveHostHref: (href) =>
					href === "https://host.test/@acme/repo/file/abc/pipeline.csv"
						? "/docs/pipeline.csv"
						: null,
			}),
		],
		content: astToTiptapDoc(
			parseMarkdown(
				"See [pipeline](./pipeline.csv), [gone](./missing.md), [later](./later.md), [perma](https://host.test/@acme/repo/file/abc/pipeline.csv) and [web](https://example.com).",
			),
		) as JSONContent,
	});
	editors.push(editor);
	const icons = () => element.querySelectorAll(".markdown-document-link-icon");
	const missing = () =>
		element.querySelectorAll(".markdown-document-link-missing");
	// The relative link and the host's permanent URL both show the icon.
	expect(icons()).toHaveLength(2);
	expect(icons()[0]?.closest("a")?.getAttribute("href")).toBe("./pipeline.csv");
	expect(icons()[1]?.closest("a")?.getAttribute("href")).toBe(
		"https://host.test/@acme/repo/file/abc/pipeline.csv",
	);
	expect(missing()).toHaveLength(1);
	expect(missing()[0]?.textContent).toBe("gone");
	// An answer that arrives later repaints without a document change.
	known.set("/docs/later.md", true);
	for (const listener of listeners) listener();
	expect(icons()).toHaveLength(3);
	expect(
		element.querySelectorAll("a[href='https://example.com'] img"),
	).toHaveLength(0);
});
