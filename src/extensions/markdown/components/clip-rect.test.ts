// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import {
	clampLeft,
	clampToClipRect,
	getClipRect,
	isAnchorClipped,
} from "./clip-rect";

/** The editor's scroll viewport in the app shell: chrome above and below. */
const CLIP = { top: 100, left: 0, bottom: 600, right: 1000 };

describe("getClipRect", () => {
	test("narrows the window by every scrolling ancestor that has a size", () => {
		const outer = document.createElement("div");
		outer.style.overflowY = "auto";
		outer.getBoundingClientRect = () =>
			({
				top: 40,
				bottom: 700,
				left: 10,
				right: 900,
				width: 890,
				height: 660,
			}) as DOMRect;
		const scroller = document.createElement("div");
		scroller.style.overflowY = "scroll";
		scroller.getBoundingClientRect = () =>
			({
				top: CLIP.top,
				bottom: CLIP.bottom,
				left: CLIP.left,
				right: CLIP.right,
				width: 1000,
				height: 500,
			}) as DOMRect;
		const editor = document.createElement("div");
		outer.append(scroller);
		scroller.append(editor);
		document.body.append(outer);

		expect(getClipRect(editor)).toEqual({
			top: 100,
			left: 10,
			bottom: 600,
			right: 900,
		});
		outer.remove();
	});

	test("falls back to the window when nothing scrolls", () => {
		const editor = document.createElement("div");
		document.body.append(editor);
		expect(getClipRect(editor)).toEqual({
			top: 0,
			left: 0,
			bottom: window.innerHeight,
			right: window.innerWidth,
		});
		editor.remove();
	});
});

describe("clampToClipRect", () => {
	test("opens below the caret while there is room for the whole panel", () => {
		const placed = clampToClipRect({
			coords: { top: 140, bottom: 160 },
			clip: CLIP,
			preferredHeight: 420,
			gap: 8,
		});
		expect(placed.placement).toBe("below");
		expect(placed.top).toBe(168);
		expect(placed.maxHeight).toBe(420);
	});

	test("shrinks rather than reaching past the viewport it opened above", () => {
		// 292px between the caret line and the top of the editor's viewport;
		// the 420px the panel would like would put 128px of it over the
		// formatting toolbar and the tab strip.
		const placed = clampToClipRect({
			coords: { top: 400, bottom: 420 },
			clip: CLIP,
			preferredHeight: 420,
			gap: 8,
		});
		expect(placed.placement).toBe("above");
		expect(placed.maxHeight).toBe(292);
		const topEdge = window.innerHeight - placed.bottom! - placed.maxHeight;
		expect(topEdge).toBe(CLIP.top);
	});

	test("shrinks downwards too rather than running under the chrome below", () => {
		const placed = clampToClipRect({
			coords: { top: 80, bottom: 100 },
			clip: CLIP,
			preferredHeight: 420,
			gap: 8,
		});
		expect(placed.placement).toBe("below");
		expect(placed.top! + placed.maxHeight).toBeLessThanOrEqual(CLIP.bottom);
	});
});

describe("isAnchorClipped", () => {
	test("is true once the caret line has left the viewport", () => {
		expect(isAnchorClipped({ top: -480, bottom: -460 }, CLIP)).toBe(true);
		expect(isAnchorClipped({ top: 900, bottom: 920 }, CLIP)).toBe(true);
	});

	test("is false while any part of the caret line is still inside", () => {
		expect(isAnchorClipped({ top: 300, bottom: 320 }, CLIP)).toBe(false);
		expect(isAnchorClipped({ top: 90, bottom: 110 }, CLIP)).toBe(false);
	});
});

describe("clampLeft", () => {
	test("keeps the panel inside the editor's horizontal bounds", () => {
		expect(clampLeft({ left: 900, width: 304, clip: CLIP, gap: 8 })).toBe(688);
		expect(clampLeft({ left: -40, width: 304, clip: CLIP, gap: 8 })).toBe(0);
		expect(clampLeft({ left: 200, width: 304, clip: CLIP, gap: 8 })).toBe(200);
	});

	test("gives up on the gap rather than going negative in a narrow editor", () => {
		const narrow = { top: 0, left: 20, bottom: 500, right: 220 };
		expect(clampLeft({ left: 100, width: 304, clip: narrow, gap: 8 })).toBe(20);
	});
});
