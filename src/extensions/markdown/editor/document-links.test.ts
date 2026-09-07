import { afterEach, expect, test, vi } from "vitest";
import { bindDocumentLinks, documentLinkPath } from "./document-links";
import { createEditor } from "./create-editor";
import type { Lix } from "@lix-js/sdk";

test("the Markdown editor routes rendered document links through its host opener", async () => {
	const open = vi.fn();
	const editor = createEditor({
		lix: {} as Lix,
		initialMarkdown: "Read [the brief](../brief.md).",
		sourceFilePath: "/docs/source.md",
		openWorkspaceFile: open,
		persistState: false,
	});
	document.body.append(editor.view.dom);
	try {
		editor.view.dom
			.querySelector("a")!
			.dispatchEvent(
				new MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		await Promise.resolve();
		expect(open).toHaveBeenCalledWith({
			filePath: "/brief.md",
			focus: true,
			newTab: true,
		});
	} finally {
		editor.destroy();
	}
});

afterEach(() => {
	vi.useRealTimers();
	document.body.replaceChildren();
});

test("resolves document-relative and root paths without treating URLs or fragments as documents", () => {
	expect(
		documentLinkPath("../plans/brief%20v2.md#goals", "/docs/discovery.md"),
	).toBe("/plans/brief v2.md");
	expect(documentLinkPath("guide.md", "/docs/discovery.md")).toBe(
		"/docs/guide.md",
	);
	expect(documentLinkPath("/README.md", "/docs/discovery.md")).toBe(
		"/README.md",
	);
	for (const href of [
		"#intro",
		"?mode=raw",
		"https://example.com/a.md",
		"//example.com/a.md",
		"javascript:alert(1)",
		"../../escape.md",
	]) {
		expect(documentLinkPath(href, "/docs/discovery.md")).toBeNull();
	}
});

test("opens document tabs, preserves checkpoint context, and leaves external links alone", async () => {
	const root = document.createElement("div");
	root.innerHTML =
		'<a href="./guide.md"><em>Guide</em></a><a href="https://example.com">External</a>';
	document.body.append(root);
	const open = vi.fn();
	const cleanup = bindDocumentLinks(
		root,
		"/docs/source.md",
		open,
		"checkpoint",
	);
	const click = new MouseEvent("click", { bubbles: true, cancelable: true });
	root.querySelector("em")!.dispatchEvent(click);
	await Promise.resolve();
	expect(click.defaultPrevented).toBe(true);
	expect(open).toHaveBeenCalledWith({
		filePath: "/docs/guide.md",
		newTab: true,
		focus: true,
		state: { sourceCommitId: "checkpoint" },
	});
	root.querySelector("a")!.dispatchEvent(
		new MouseEvent("auxclick", {
			button: 1,
			bubbles: true,
			cancelable: true,
		}),
	);
	await Promise.resolve();
	expect(open).toHaveBeenLastCalledWith(
		expect.objectContaining({ newTab: true, focus: true }),
	);
	root.querySelectorAll("a")[1]!.click();
	await Promise.resolve();
	expect(open).toHaveBeenCalledTimes(2);
	cleanup();
});

test("shows a destination on hover and focus, dismisses with Escape, and cleans up", () => {
	vi.useFakeTimers();
	const root = document.createElement("div");
	root.innerHTML = '<a href="./guide.md" aria-describedby="existing">Guide</a>';
	document.body.append(root);
	const cleanup = bindDocumentLinks(root, "/docs/source.md", vi.fn());
	const link = root.querySelector("a")!;
	link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
	vi.advanceTimersByTime(250);
	const card = document.querySelector('[role="tooltip"]')!;
	link.dispatchEvent(
		new MouseEvent("mouseout", { bubbles: true, relatedTarget: root }),
	);
	root.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
	card.dispatchEvent(new MouseEvent("mouseenter"));
	vi.advanceTimersByTime(150);
	expect(document.querySelector('[role="tooltip"]')).toBe(card);
	card.dispatchEvent(new MouseEvent("mouseleave"));
	link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
	vi.advanceTimersByTime(150);
	expect(document.querySelector('[role="tooltip"]')).toBe(card);
	expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
		"In this repository/docs/guide.mdOpen in a tab",
	);
	window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
	expect(document.querySelector('[role="tooltip"]')).toBeNull();
	expect(link.getAttribute("aria-describedby")).toBe("existing");
	link.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
	vi.advanceTimersByTime(0);
	expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
	cleanup();
	expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
