import { describe, expect, test } from "vitest";
import { scrollLeavesEditorBehind } from "./csv-editor-overlay";

/** A stand-in for the list inside an editor, scrollable or not. */
function list(scrollHeight: number, clientHeight: number): Element {
	const node = document.createElement("div");
	node.className = "csv-option-list";
	Object.defineProperty(node, "scrollHeight", { value: scrollHeight });
	Object.defineProperty(node, "clientHeight", { value: clientHeight });
	return node;
}

function inEditor(child: Element): Element {
	const editor = document.createElement("div");
	editor.className = "csv-property-popover";
	editor.append(child);
	return child;
}

describe("scrollLeavesEditorBehind", () => {
	test("the grid scrolling under the editor leaves it behind", () => {
		const scroller = document.createElement("div");
		scroller.className = "dvn-scroller";
		expect(scrollLeavesEditorBehind({ type: "scroll", target: scroller })).toBe(
			true,
		);
	});

	test("an option list scrolling inside the editor does not", () => {
		const node = inEditor(list(400, 200));
		expect(scrollLeavesEditorBehind({ type: "scroll", target: node })).toBe(
			false,
		);
	});

	test("a list with nothing left to scroll still counts as the grid", () => {
		const node = inEditor(list(200, 200));
		expect(scrollLeavesEditorBehind({ type: "scroll", target: node })).toBe(
			true,
		);
	});

	test("a wheel over the editor closes it, since no grid scroll follows", () => {
		const node = inEditor(list(200, 200));
		expect(scrollLeavesEditorBehind({ type: "wheel", target: node })).toBe(
			true,
		);
	});

	test("a wheel a scrollable list can still use is left to the list", () => {
		const node = inEditor(list(400, 200));
		expect(scrollLeavesEditorBehind({ type: "wheel", target: node })).toBe(
			false,
		);
	});

	test("a wheel over the grid waits for the scroll it causes", () => {
		const scroller = document.createElement("div");
		scroller.className = "dvn-scroller";
		expect(scrollLeavesEditorBehind({ type: "wheel", target: scroller })).toBe(
			false,
		);
	});
});
