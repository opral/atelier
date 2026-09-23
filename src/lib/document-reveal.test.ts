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
});
