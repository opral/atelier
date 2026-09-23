import { describe, expect, test } from "vitest";
import { documentReveal, documentRevealState } from "./document-reveal";

describe("documentReveal", () => {
	test("reads a request from a view's state, keyed so each request is new", () => {
		const first = documentRevealState({ rowId: "row-1", rowNumber: 14 });
		const reveal = documentReveal({ fileId: "f", reveal: first });
		expect(reveal).toMatchObject({ rowId: "row-1", rowNumber: 14 });
		const again = documentReveal({
			reveal: { ...first, at: first.at + 1 },
		});
		expect(again?.key).not.toBe(reveal?.key);
	});

	test("ignores a state without a usable request", () => {
		expect(documentReveal({})).toBeNull();
		expect(documentReveal({ reveal: { at: 1 } })).toBeNull();
		expect(documentReveal({ reveal: { rowNumber: 1.5, at: 1 } })).toBeNull();
		expect(documentReveal(null)).toBeNull();
	});

	test("a request is for the moment it was made", () => {
		const request = documentRevealState({ rowId: "row-1" });
		expect(
			documentReveal({ reveal: request }, () => {}, request.at),
		).not.toBeNull();
		// A view remounted, or a workspace restored, later: not a request.
		expect(
			documentReveal({ reveal: request }, () => {}, request.at + 60_000),
		).toBeNull();
		// Cleared once consumed.
		expect(documentReveal({ reveal: null })).toBeNull();
	});
});
