import { describe, expect, test } from "vitest";
import { thumbGeometry } from "./csv-overlay-scrollbars";

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
