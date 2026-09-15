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

/** First node of `typeName` carrying `label`, with its position. */
function findNode(editor: Editor, typeName: string, label: string) {
	let found: { pos: number; node: any } | null = null;
	editor.state.doc.descendants((node, pos) => {
		if (found) return false;
		if (node.type.name === typeName && node.attrs.label === label) {
			found = { pos, node };
			return false;
		}
		return true;
	});
	if (!found) throw new Error(`no ${typeName} for ${label}`);
	return found as { pos: number; node: any };
}

/** Tab the way the editor's keymap sees it. */
function sendTab(editor: Editor): boolean {
	return (
		editor.view.someProp("handleKeyDown", (handler) =>
			handler(
				editor.view,
				new KeyboardEvent("keydown", {
					key: "Tab",
					bubbles: true,
					cancelable: true,
				}),
			),
		) === true
	);
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
		// The caret went along, to the end of the note.
		const { $from } = editor.state.selection;
		expect($from.node($from.depth - 1).type.name).toBe("footnoteDef");
		expect($from.parentOffset).toBe("The source.".length);
		vi.advanceTimersByTime(1500);
		expect(definition.classList.contains(FOOTNOTE_TARGET_CLASS)).toBe(false);
	});

	test("the way back lands on the first marker", () => {
		const backref = element.querySelector("[data-footnote-backref='1']")!;
		click(backref);
		const marker = element.querySelector("[data-footnote-ref='1']")!;
		expect(scrolled).toEqual([marker]);
		expect(marker.classList.contains(FOOTNOTE_TARGET_CLASS)).toBe(true);
		// The caret is back in the sentence, right after the marker.
		const { $from } = editor.state.selection;
		expect($from.parent.type.name).toBe("paragraph");
		expect($from.nodeBefore?.type.name).toBe("footnoteRef");
		expect($from.parent.textContent.startsWith("Claim one.")).toBe(true);
	});

	test("the marker is the button it says it is", () => {
		const link = element.querySelector<HTMLElement>(
			"[data-footnote-ref='1'] a",
		)!;
		expect(link).toHaveAttribute("role", "button");
		expect(link).toHaveAttribute("tabindex", "0");

		link.focus();
		expect(element.ownerDocument.activeElement).toBe(link);

		// Enter on it jumps, exactly as a click does, and does not fall through
		// to the editor to split the paragraph the marker sits in.
		const blocks = editor.state.doc.childCount;
		const enter = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		link.dispatchEvent(enter);
		expect(enter.defaultPrevented).toBe(true);
		expect(editor.state.doc.childCount).toBe(blocks);
		expect(scrolled).toEqual([
			element.querySelector("[data-footnote-def='1']"),
		]);
	});

	test("Tab beside a marker reaches it, and Tab in a note reaches the way back", () => {
		// Caret straight after the first marker. Tab has nothing to indent
		// there, so it hands focus to the marker instead of doing nothing.
		const marker = findNode(editor, "footnoteRef", "1");
		editor.commands.setTextSelection(marker.pos + marker.node.nodeSize);
		sendTab(editor);
		expect(element.ownerDocument.activeElement).toBe(
			element.querySelector("[data-footnote-ref='1'] a"),
		);

		// Space on the way back returns to the marker: the round trip closes
		// without ever needing the mouse.
		const definition = findNode(editor, "footnoteDef", "1");
		editor.commands.setTextSelection(definition.pos + 2);
		sendTab(editor);
		const backref = element.querySelector("[data-footnote-backref='1']");
		expect(element.ownerDocument.activeElement).toBe(backref);

		scrolled.length = 0;
		backref!.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: " ",
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(scrolled).toEqual([
			element.querySelector("[data-footnote-ref='1']"),
		]);
	});

	test("Tab is still swallowed in plain prose", () => {
		editor.commands.setTextSelection(3);
		const before = editor.state.doc.toJSON();
		expect(sendTab(editor)).toBe(true);
		expect(editor.state.doc.toJSON()).toEqual(before);
		expect(element.ownerDocument.activeElement).not.toHaveAttribute(
			"data-footnote-backref",
		);
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
