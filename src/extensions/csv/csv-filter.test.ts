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

import {
	csvFilterOperators,
	defaultCsvFilterOperator,
	isActiveCsvFilterRule,
} from "./csv-filter";

test("text conditions compare case-insensitively: is, is not, starts, ends, does not contain", () => {
	expect(matchesCsvFilter("Trial", "trial", "text", "is")).toBe(true);
	expect(matchesCsvFilter("Trial extended", "trial", "text", "is")).toBe(false);
	expect(matchesCsvFilter("Trial", "trial", "text", "is_not")).toBe(false);
	expect(matchesCsvFilter("", "trial", "text", "is_not")).toBe(true);
	expect(
		matchesCsvFilter("Trial extended", "ext", "text", "not_contains"),
	).toBe(false);
	expect(matchesCsvFilter("Trial", "ext", "text", "not_contains")).toBe(true);
	expect(matchesCsvFilter("Trial extended", "tri", "text", "starts_with")).toBe(
		true,
	);
	expect(matchesCsvFilter("Trial extended", "ded", "text", "ends_with")).toBe(
		true,
	);
	expect(matchesCsvFilter("Trial extended", "tri", "text", "ends_with")).toBe(
		false,
	);
});
test("empty conditions look at the cell alone, and blank whitespace counts as empty", () => {
	expect(matchesCsvFilter("  ", "", "text", "empty")).toBe(true);
	expect(matchesCsvFilter("x", "", "select", "empty")).toBe(false);
	expect(matchesCsvFilter("x", "", "number", "not_empty")).toBe(true);
	expect(matchesCsvFilter("", "", "date", "not_empty")).toBe(false);
});
test("number and date conditions compare values", () => {
	expect(matchesCsvFilter("10", "5", "number", "gt")).toBe(true);
	expect(matchesCsvFilter("10", "10", "number", "gt")).toBe(false);
	expect(matchesCsvFilter("10", "10", "number", "gte")).toBe(true);
	expect(matchesCsvFilter("9.5", "10", "number", "lt")).toBe(true);
	expect(matchesCsvFilter("10", "10", "number", "lte")).toBe(true);
	expect(matchesCsvFilter("10", "10", "number", "is_not")).toBe(false);
	expect(matchesCsvFilter("", "10", "number", "is_not")).toBe(true);
	expect(matchesCsvFilter("abc", "10", "number", "gt")).toBe(false);
	expect(matchesCsvFilter("2026-09-09", "2026-09-10", "date", "before")).toBe(
		true,
	);
	expect(matchesCsvFilter("2026-09-10", "2026-09-10", "date", "before")).toBe(
		false,
	);
	expect(
		matchesCsvFilter("2026-09-10", "2026-09-10", "date", "on_or_before"),
	).toBe(true);
	expect(matchesCsvFilter("2026-09-11", "2026-09-10", "date", "after")).toBe(
		true,
	);
	expect(
		matchesCsvFilter("2026-09-10", "2026-09-10", "date", "on_or_after"),
	).toBe(true);
	expect(matchesCsvFilter("soon", "2026-09-10", "date", "after")).toBe(false);
});
test("select and checkbox is not excludes every chosen value and keeps blanks", () => {
	expect(
		matchesCsvFilter("Trial", ["Trial", "Qualified"], "select", "is_not"),
	).toBe(false);
	expect(matchesCsvFilter("Onboarded", ["Trial"], "select", "is_not")).toBe(
		true,
	);
	expect(matchesCsvFilter("", ["Trial"], "select", "is_not")).toBe(true);
	expect(matchesCsvFilter("Trial", [], "select", "is_not")).toBe(true);
	expect(matchesCsvFilter("yes", ["true"], "checkbox", "is_not")).toBe(false);
	expect(matchesCsvFilter("no", ["true"], "checkbox", "is_not")).toBe(true);
});
test("each type offers Notion's conditions and a rule without one means the type's default", () => {
	expect(csvFilterOperators("text").map((option) => option.value)).toEqual([
		"is",
		"is_not",
		"contains",
		"not_contains",
		"starts_with",
		"ends_with",
		"empty",
		"not_empty",
	]);
	expect(csvFilterOperators("select").map((option) => option.label)).toEqual([
		"Is",
		"Is not",
		"Is empty",
		"Is not empty",
	]);
	expect(csvFilterOperators("checkbox")).toHaveLength(2);
	expect(csvFilterOperators("date").map((option) => option.value)).toContain(
		"on_or_after",
	);
	expect(csvFilterOperators("number").map((option) => option.label)).toContain(
		"≥",
	);
	expect(defaultCsvFilterOperator("text")).toBe("contains");
	expect(defaultCsvFilterOperator("email")).toBe("contains");
	expect(defaultCsvFilterOperator(undefined)).toBe("contains");
	expect(defaultCsvFilterOperator("select")).toBe("is");
	expect(defaultCsvFilterOperator("date")).toBe("is");
});
test("an empty condition is active without a value; a condition the column lacks falls back", () => {
	expect(
		isActiveCsvFilterRule({ id: "a", column: 0, operator: "empty", value: "" }),
	).toBe(true);
	expect(
		isActiveCsvFilterRule({ id: "a", column: 0, operator: "is", value: "" }),
	).toBe(false);
	const group: CsvFilterGroup = {
		mode: "all",
		rules: [
			{ id: "a", column: 0, operator: "not_empty", value: "" },
			// starts_with is a text condition; on a checkbox it reads as "is".
			{ id: "b", column: 1, operator: "starts_with", value: ["true"] },
		],
	};
	expect(matchesCsvFilterGroup(["Trial", "yes"], group, typedColumns)).toBe(
		true,
	);
	expect(matchesCsvFilterGroup(["", "yes"], group, typedColumns)).toBe(false);
	expect(matchesCsvFilterGroup(["Trial", "no"], group, typedColumns)).toBe(
		false,
	);
});
