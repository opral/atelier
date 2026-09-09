import { expect, test } from "vitest";
import { compareCsvValues } from "./csv-sort";

const options = [
	{ value: "High", color: "red" },
	{ value: "Medium", color: "yellow" },
	{ value: "Low", color: "gray" },
];

test("select values sort in option order, unknown values after them", () => {
	const sorted = ["Low", "Zeta", "High", "Alpha", "Medium", ""].sort((a, b) =>
		compareCsvValues(a, b, "select", options),
	);
	expect(sorted).toEqual(["High", "Medium", "Low", "", "Alpha", "Zeta"]);
});

test("select columns without options fall back to alphabetical order", () => {
	expect(
		["b", "a"].sort((a, b) => compareCsvValues(a, b, "select", [])),
	).toEqual(["a", "b"]);
	expect(["b", "a"].sort((a, b) => compareCsvValues(a, b, "select"))).toEqual([
		"a",
		"b",
	]);
});

test("numbers compare numerically and sort before non-numbers", () => {
	expect(
		["10", "9", "x", "2"].sort((a, b) => compareCsvValues(a, b, "number")),
	).toEqual(["2", "9", "10", "x"]);
});
