import { expect, test } from "vitest";
import { columnAnchorAfterDelete } from "./csv-grid-anchor";

test("deleting a column leaves the keyboard where that column was", () => {
	// Five columns; the third goes, and its place is taken by the fourth.
	expect(columnAnchorAfterDelete([2], 5)).toBe(2);
	expect(columnAnchorAfterDelete([0], 5)).toBe(0);
	// A run of columns: the first of them names the place.
	expect(columnAnchorAfterDelete([1, 2, 3], 5)).toBe(1);
	// The last column has nothing after it, so the one before it takes over.
	expect(columnAnchorAfterDelete([4], 5)).toBe(3);
	expect(columnAnchorAfterDelete([3, 4], 5)).toBe(2);
	// Every column at once leaves the corner, which is all there is.
	expect(columnAnchorAfterDelete([0, 1, 2, 3, 4], 5)).toBe(0);
	expect(columnAnchorAfterDelete([], 5)).toBe(0);
});
