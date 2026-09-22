import { expect, test } from "vitest";
import { rowsEqual } from "./lix-react";

test("rows holding the same file bytes are equal without spelling the bytes out", () => {
	const bytes = new Uint8Array(1_000_000).map((_, index) => index % 251);
	const row = (content: Uint8Array) => [
		{ id: "a", path: "/a.md", content, meta: { size: content.length } },
	];
	const started = performance.now();
	expect(rowsEqual(row(bytes), row(bytes.slice()))).toBe(true);
	// The JSON comparison this replaces took hundreds of milliseconds here.
	expect(performance.now() - started).toBeLessThan(50);

	const changed = bytes.slice();
	changed[654_321] = 0;
	expect(rowsEqual(row(bytes), row(changed))).toBe(false);
	expect(rowsEqual(row(bytes), row(bytes.slice(1)))).toBe(false);
	expect(
		rowsEqual([{ c: new Uint8Array([1]) }], [{ c: new Int8Array([1]) }]),
	).toBe(false);
});

test("rows compare field by field", () => {
	expect(rowsEqual([{ a: 1, b: null }], [{ b: null, a: 1 }])).toBe(true);
	expect(rowsEqual([{ a: 1 }], [{ a: 1, b: 2 }])).toBe(false);
	expect(rowsEqual([{ a: "1" }], [{ a: 1 }])).toBe(false);
	expect(rowsEqual([{ a: [1, 2] }], [{ a: [1, 2] }])).toBe(true);
	expect(rowsEqual([{ a: [1, 2] }], [{ a: [2, 1] }])).toBe(false);
	expect(rowsEqual([], [])).toBe(true);
});
