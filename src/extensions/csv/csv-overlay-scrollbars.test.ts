import { describe, expect, test } from "vitest";
import { nearScrollEdge, thumbGeometry } from "./csv-overlay-scrollbars";

describe("thumbGeometry", () => {
	test("is absent when the content fits", () => {
		expect(
			thumbGeometry({
				scrollSize: 400,
				clientSize: 400,
				scrollPosition: 0,
				trackLength: 380,
			}),
		).toBeNull();
	});

	test("scales the thumb with the visible share and moves it with the scroll", () => {
		const start = thumbGeometry({
			scrollSize: 2000,
			clientSize: 500,
			scrollPosition: 0,
			trackLength: 480,
		});
		expect(start).toEqual({ length: 120, offset: 0 });
		const end = thumbGeometry({
			scrollSize: 2000,
			clientSize: 500,
			scrollPosition: 1500,
			trackLength: 480,
		});
		expect(end).toEqual({ length: 120, offset: 360 });
		const middle = thumbGeometry({
			scrollSize: 2000,
			clientSize: 500,
			scrollPosition: 750,
			trackLength: 480,
		});
		expect(middle).toEqual({ length: 120, offset: 180 });
	});

	test("keeps a graspable minimum on very long content", () => {
		const thumb = thumbGeometry({
			scrollSize: 100_000,
			clientSize: 500,
			scrollPosition: 99_500,
			trackLength: 480,
		});
		expect(thumb).toEqual({ length: 28, offset: 452 });
	});
});

test("the thumbs wake for a pointer at the edge they sit on, not for one in the grid", () => {
	const box = { left: 100, top: 100, right: 500, bottom: 400 };
	const at = (x: number, y: number) =>
		nearScrollEdge({ pointer: { x, y }, box });
	// Reaching for the vertical thumb, and for the horizontal one.
	expect(at(492, 250)).toBe(true);
	expect(at(300, 392)).toBe(true);
	// Reading the table, a long way from either.
	expect(at(300, 250)).toBe(false);
	// The left and top edges carry no thumb.
	expect(at(104, 250)).toBe(false);
	expect(at(300, 104)).toBe(false);
	// Outside the scroller entirely: the grid's own edge, the page beyond it.
	expect(at(520, 250)).toBe(false);
	expect(at(300, 420)).toBe(false);
});
