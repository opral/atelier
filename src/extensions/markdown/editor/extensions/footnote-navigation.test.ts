// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { MarkdownWc, astToTiptapDoc } from "../tiptap-markdown-bridge";
import { parseMarkdown } from "../markdown";
import { FOOTNOTE_TARGET_CLASS } from "./footnote-navigation";

const markdown = [
	"Claim one.[^1] Claim two.[^2]",
	"",
	"[^1]: The source.",
	"",
	"[^2]: Soon to go.",
	"",
].join("\n");

/** Deletes the definition block for `label`, leaving its marker behind. */
function removeDefinition(editor: Editor, label: string) {
	let range: { from: number; to: number } | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (range) return false;
		if (node.type.name === "footnoteDef" && node.attrs.label === label) {
			range = { from: pos, to: pos + node.nodeSize };
		}
		return !range;
	});
	if (!range) throw new Error(`no definition for ${label}`);
	editor.commands.deleteRange(range);
}

function mountEditor(source: string) {
	const element = document.createElement("div");
	document.body.appendChild(element);
	const editor = new Editor({
		element,
		extensions: MarkdownWc(),
		content: astToTiptapDoc(parseMarkdown(source)),
	});
	return { editor, element };
}

function click(target: Element) {
	target.dispatchEvent(
		new MouseEvent("mousedown", { bubbles: true, button: 0 }),
	);
	target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
	target.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
}

describe("footnote navigation", () => {
	let editor: Editor;
	let element: HTMLElement;
	let scrolled: Element[];

	beforeEach(() => {
		vi.useFakeTimers();
		scrolled = [];
		Element.prototype.scrollIntoView = function () {
			scrolled.push(this);
		};
		({ editor, element } = mountEditor(markdown));
	});

	afterEach(() => {
		editor.destroy();
		element.remove();
		vi.useRealTimers();
	});

	test("a marker renders its label, and a definition its row", () => {
		const marker = element.querySelector("[data-footnote-ref='1']")!;
		expect(marker.textContent).toBe("[1]");
		expect(marker.querySelector("a")).toHaveAttribute(
			"aria-label",
			"Go to footnote 1",
		);
		const definition = element.querySelector("[data-footnote-def='1']")!;
		expect(
			definition.querySelector(".markdown-footnote-def-label")?.textContent,
		).toBe("[1]");
		expect(
			definition.querySelector(".markdown-footnote-def-body")?.textContent,
		).toBe("The source.");
		expect(
			definition.querySelector("[data-footnote-backref='1']"),
		).not.toBeNull();
		// The body is the editable part; the label and the way back are not.
		expect(
			definition.querySelector(".markdown-footnote-def-label"),
		).toHaveAttribute("contenteditable", "false");
	});

	test("clicking a marker scrolls to its definition and tints it", () => {
		const marker = element.querySelector("[data-footnote-ref='1'] a")!;
		click(marker);
		const definition = element.querySelector("[data-footnote-def='1']")!;
		expect(scrolled).toEqual([definition]);
		expect(definition.classList.contains(FOOTNOTE_TARGET_CLASS)).toBe(true);
		vi.advanceTimersByTime(1500);
		expect(definition.classList.contains(FOOTNOTE_TARGET_CLASS)).toBe(false);
	});

	test("the way back lands on the first marker", () => {
		const backref = element.querySelector("[data-footnote-backref='1']")!;
		click(backref);
		const marker = element.querySelector("[data-footnote-ref='1']")!;
		expect(scrolled).toEqual([marker]);
		expect(marker.classList.contains(FOOTNOTE_TARGET_CLASS)).toBe(true);
	});

	test("a marker without a definition is drawn as one and goes nowhere", () => {
		expect(
			element.querySelector("[data-footnote-ref='2']"),
		).not.toHaveAttribute("data-footnote-orphan");
		removeDefinition(editor, "2");
		const orphan = element.querySelector("[data-footnote-ref='2']")!;
		expect(orphan).toHaveAttribute("data-footnote-orphan", "true");
		expect(orphan.classList.contains("markdown-footnote-ref--orphan")).toBe(
			true,
		);
		expect(
			element.querySelector("[data-footnote-ref='1']"),
		).not.toHaveAttribute("data-footnote-orphan");
		click(orphan.querySelector("a")!);
		expect(scrolled).toEqual([]);
		expect(element.querySelector(`.${FOOTNOTE_TARGET_CLASS}`)).toBeNull();
	});

	test("adding the definition back un-marks the orphan", () => {
		removeDefinition(editor, "2");
		expect(element.querySelector("[data-footnote-ref='2']")).toHaveAttribute(
			"data-footnote-orphan",
			"true",
		);
		editor.commands.insertContentAt(editor.state.doc.content.size, {
			type: "footnoteDef",
			attrs: { label: "2", identifier: "2" },
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "Back again." }],
				},
			],
		});
		expect(
			element.querySelector("[data-footnote-ref='2']"),
		).not.toHaveAttribute("data-footnote-orphan");
	});
});
