import { expect, test } from "vitest";
import { matchesCsvFilter } from "./csv-filter";

test("select filters match the whole option while ordinary CSV text supports contains", () => {
	expect(matchesCsvFilter("Trial extended", "Trial", "select")).toBe(false);
	expect(matchesCsvFilter("Trial", "Trial", "select")).toBe(true);
	expect(matchesCsvFilter("Trial extended", "trial")).toBe(true);
	expect(matchesCsvFilter("", "", "select")).toBe(true);
});
test("checkbox filters respect CSV boolean spellings and distinguish empty from unchecked", () => {
	for (const value of ["yes", "TRUE", "1"])
		expect(matchesCsvFilter(value, "true", "checkbox")).toBe(true);
	for (const value of ["no", "FALSE", "0"])
		expect(matchesCsvFilter(value, "false", "checkbox")).toBe(true);
	expect(matchesCsvFilter("", "false", "checkbox")).toBe(false);
	expect(matchesCsvFilter("", "empty", "checkbox")).toBe(true);
});
test("date and numeric filters compare values rather than substrings", () => {
	expect(matchesCsvFilter("2026-09-10", "2026-09-10", "date")).toBe(true);
	expect(matchesCsvFilter("2026-09-11", "2026-09-10", "date")).toBe(false);
	expect(matchesCsvFilter("10.0", "10", "number")).toBe(true);
	expect(matchesCsvFilter("100", "10", "number")).toBe(false);
	expect(matchesCsvFilter("", "0", "number")).toBe(false);
});

test("multi-option filters match any selected value exactly and no selection means all rows", () => {
	expect(matchesCsvFilter("Trial", ["Trial", "Qualified"], "select")).toBe(
		true,
	);
	expect(matchesCsvFilter("Qualified", ["Trial", "Qualified"], "select")).toBe(
		true,
	);
	expect(
		matchesCsvFilter("Trial extended", ["Trial", "Qualified"], "select"),
	).toBe(false);
	expect(matchesCsvFilter("Discovery", [], "select")).toBe(true);
	expect(matchesCsvFilter("", [], "select")).toBe(true);
	expect(matchesCsvFilter("FALSE", ["true", "false"], "checkbox")).toBe(true);
	expect(matchesCsvFilter("", ["true", "false"], "checkbox")).toBe(false);
});

import { matchesCsvFilterGroup, type CsvFilterGroup } from "./csv-filter";
const typedColumns = [
	{ id: "stage", header: "Stage", index: 0, type: "select" as const },
	{ id: "contacted", header: "Contacted", index: 1, type: "checkbox" as const },
];
const compound: CsvFilterGroup = {
	mode: "all",
	rules: [
		{ id: "stage", column: 0, value: ["Trial", "Qualified"] },
		{ id: "contacted", column: 1, value: ["true"] },
	],
};
test("compound All combines a multi-option rule with another column", () => {
	expect(matchesCsvFilterGroup(["Trial", "yes"], compound, typedColumns)).toBe(
		true,
	);
	expect(
		matchesCsvFilterGroup(["Qualified", "TRUE"], compound, typedColumns),
	).toBe(true);
	expect(matchesCsvFilterGroup(["Trial", "no"], compound, typedColumns)).toBe(
		false,
	);
	expect(
		matchesCsvFilterGroup(["Onboarded", "yes"], compound, typedColumns),
	).toBe(false);
});
test("compound Any accepts either rule and incomplete rules never widen matches", () => {
	const any: CsvFilterGroup = {
		...compound,
		mode: "any",
		rules: [
			...compound.rules,
			{ id: "new", column: null, value: "" },
			{ id: "empty", column: 0, value: [] },
		],
	};
	expect(matchesCsvFilterGroup(["Trial", "no"], any, typedColumns)).toBe(true);
	expect(matchesCsvFilterGroup(["Onboarded", "yes"], any, typedColumns)).toBe(
		true,
	);
	expect(matchesCsvFilterGroup(["Onboarded", "no"], any, typedColumns)).toBe(
		false,
	);
	expect(
		matchesCsvFilterGroup(
			["Onboarded", "no"],
			{ mode: "any", rules: [] },
			typedColumns,
		),
	).toBe(true);
});
