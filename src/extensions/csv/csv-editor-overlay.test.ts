import { describe, expect, test } from "vitest";
import { editorOverlayFollow } from "./csv-editor-overlay";

const viewport = { left: 100, top: 50, right: 700, bottom: 450 };

describe("editorOverlayFollow", () => {
	test("stays put and clips to the viewport before any scroll", () => {
		expect(
			editorOverlayFollow({
				origin: { x: 0, y: 0 },
				scroll: { x: 0, y: 0 },
				viewport,
			}),
		).toEqual({
			transform: "",
			clipPath: "polygon(100px 50px, 700px 50px, 700px 450px, 100px 450px)",
		});
	});

	test("moves opposite to the scroll and keeps the clip on screen", () => {
		const follow = editorOverlayFollow({
			origin: { x: 20, y: 300 },
			scroll: { x: 50, y: 420 },
			viewport,
		});
		expect(follow.transform).toBe("translate(-30px, -120px)");
		// The clip is expressed in the translated box's own coordinates, so
		// it lands on the same screen rectangle after the transform.
		expect(follow.clipPath).toBe(
			"polygon(130px 170px, 730px 170px, 730px 570px, 130px 570px)",
		);
	});

	test("returns to rest when the scroller comes back to where it opened", () => {
		expect(
			editorOverlayFollow({
				origin: { x: 40, y: 80 },
				scroll: { x: 40, y: 80 },
				viewport,
			}).transform,
		).toBe("");
	});
});
