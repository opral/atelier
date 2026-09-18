import { expect, test } from "vitest";
import { anchorAfterDelete } from "./csv-grid-anchor";

test("deleting a column leaves the keyboard where that column was", () => {
	// Five columns; the third goes, and its place is taken by the fourth.
	expect(anchorAfterDelete([2], 5)).toBe(2);
	expect(anchorAfterDelete([0], 5)).toBe(0);
	// A run of columns: the first of them names the place.
	expect(anchorAfterDelete([1, 2, 3], 5)).toBe(1);
	// The last column has nothing after it, so the one before it takes over.
	expect(anchorAfterDelete([4], 5)).toBe(3);
	expect(anchorAfterDelete([3, 4], 5)).toBe(2);
	// Every column at once leaves the corner, which is all there is.
	expect(anchorAfterDelete([0, 1, 2, 3, 4], 5)).toBe(0);
	expect(anchorAfterDelete([], 5)).toBe(0);
});

test("deleting a row leaves the keyboard where that row was", () => {
	// Ten rows, the last one deleted: the ninth is the end of the table now.
	expect(anchorAfterDelete([9], 10)).toBe(8);
	expect(anchorAfterDelete([8, 9], 10)).toBe(7);
	// A row in the middle is replaced by the one that moved up into it.
	expect(anchorAfterDelete([3], 10)).toBe(3);
	// A table emptied of rows has nowhere to land but the top.
	expect(anchorAfterDelete([0], 1)).toBe(0);
});
