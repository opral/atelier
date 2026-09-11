import type { CsvColumnInfo } from "./csv-metadata";

/**
 * Filter conditions, the set a Notion database offers per property type.
 * Text-like columns compare case-insensitively; select and checkbox rules
 * carry a set of values ("is" any of them, "is not" none of them); number
 * and date rules compare values, not strings; empty tests need no value.
 */
export type CsvFilterOperator =
	| "is"
	| "is_not"
	| "contains"
	| "not_contains"
	| "starts_with"
	| "ends_with"
	| "gt"
	| "lt"
	| "gte"
	| "lte"
	| "before"
	| "after"
	| "on_or_before"
	| "on_or_after"
	| "empty"
	| "not_empty";

export type CsvFilterOperatorOption = {
	readonly value: CsvFilterOperator;
	readonly label: string;
};

const TEXT_OPERATORS: readonly CsvFilterOperatorOption[] = [
	{ value: "is", label: "Is" },
	{ value: "is_not", label: "Is not" },
	{ value: "contains", label: "Contains" },
	{ value: "not_contains", label: "Does not contain" },
	{ value: "starts_with", label: "Starts with" },
	{ value: "ends_with", label: "Ends with" },
	{ value: "empty", label: "Is empty" },
	{ value: "not_empty", label: "Is not empty" },
];
const NUMBER_OPERATORS: readonly CsvFilterOperatorOption[] = [
	{ value: "is", label: "=" },
	{ value: "is_not", label: "≠" },
	{ value: "gt", label: ">" },
	{ value: "lt", label: "<" },
	{ value: "gte", label: "≥" },
	{ value: "lte", label: "≤" },
	{ value: "empty", label: "Is empty" },
	{ value: "not_empty", label: "Is not empty" },
];
const SELECT_OPERATORS: readonly CsvFilterOperatorOption[] = [
	{ value: "is", label: "Is" },
	{ value: "is_not", label: "Is not" },
	{ value: "empty", label: "Is empty" },
	{ value: "not_empty", label: "Is not empty" },
];
const CHECKBOX_OPERATORS: readonly CsvFilterOperatorOption[] = [
	{ value: "is", label: "Is" },
	{ value: "is_not", label: "Is not" },
];
const DATE_OPERATORS: readonly CsvFilterOperatorOption[] = [
	{ value: "is", label: "Is" },
	{ value: "before", label: "Is before" },
	{ value: "after", label: "Is after" },
	{ value: "on_or_before", label: "Is on or before" },
	{ value: "on_or_after", label: "Is on or after" },
	{ value: "empty", label: "Is empty" },
	{ value: "not_empty", label: "Is not empty" },
];

export const CSV_FILTER_OPERATORS: readonly CsvFilterOperator[] = [
	...new Set(
		[
			...TEXT_OPERATORS,
			...NUMBER_OPERATORS,
			...SELECT_OPERATORS,
			...CHECKBOX_OPERATORS,
			...DATE_OPERATORS,
		].map((option) => option.value),
	),
];

/** The conditions a column of this type offers, in menu order. */
export function csvFilterOperators(
	type?: CsvColumnInfo["type"],
): readonly CsvFilterOperatorOption[] {
	switch (type) {
		case "number":
			return NUMBER_OPERATORS;
		case "select":
			return SELECT_OPERATORS;
		case "checkbox":
			return CHECKBOX_OPERATORS;
		case "date":
			return DATE_OPERATORS;
		default:
			return TEXT_OPERATORS;
	}
}

/** What a fresh rule on this column means before a condition is chosen. */
export function defaultCsvFilterOperator(
	type?: CsvColumnInfo["type"],
): CsvFilterOperator {
	return csvFilterOperators(type) === TEXT_OPERATORS ? "contains" : "is";
}

export function csvFilterOperatorNeedsValue(
	operator: CsvFilterOperator,
): boolean {
	return operator !== "empty" && operator !== "not_empty";
}

export type CsvFilterRule = {
	id: string;
	column: number | null;
	/** Absent means the column type's default: contains for text, is otherwise. */
	operator?: CsvFilterOperator;
	value: string | readonly string[];
};
export type CsvFilterGroup = {
	mode: "all" | "any";
	rules: readonly CsvFilterRule[];
};
export const EMPTY_CSV_FILTER: CsvFilterGroup = { mode: "all", rules: [] };

/** The rule's condition, falling back to the type's default when it names one the type lacks. */
export function csvFilterRuleOperator(
	rule: Pick<CsvFilterRule, "operator">,
	type?: CsvColumnInfo["type"],
): CsvFilterOperator {
	const operator = rule.operator;
	if (
		operator &&
		csvFilterOperators(type).some((option) => option.value === operator)
	)
		return operator;
	return defaultCsvFilterOperator(type);
}

export function isActiveCsvFilterRule(rule: CsvFilterRule) {
	if (rule.column === null) return false;
	if (rule.operator && !csvFilterOperatorNeedsValue(rule.operator)) return true;
	return rule.value.length > 0;
}

function parseTime(value: string): number | null {
	const time = Date.parse(value.trim());
	return Number.isFinite(time) ? time : null;
}

export function matchesCsvFilter(
	value: string,
	query: string | readonly string[],
	type?: CsvColumnInfo["type"],
	operator: CsvFilterOperator = defaultCsvFilterOperator(type),
): boolean {
	const blank = value.trim() === "";
	if (operator === "empty") return blank;
	if (operator === "not_empty") return !blank;
	if (typeof query !== "string") {
		if (query.length === 0) return true;
		const any = query.some((item) => matchesCsvFilter(value, item, type, "is"));
		return operator === "is_not" ? !any : any;
	}
	if (!query) return true;
	if (operator === "is_not") return !matchesCsvFilter(value, query, type, "is");
	if (operator === "not_contains")
		return !matchesCsvFilter(value, query, type, "contains");
	if (type === "select") return value === query;
	if (type === "checkbox") {
		if (query === "empty") return blank;
		return query === "true"
			? /^(yes|true|1)$/i.test(value)
			: /^(no|false|0)$/i.test(value);
	}
	if (type === "number") {
		const actual = Number(value);
		const expected = Number(query);
		if (blank || !Number.isFinite(actual) || !Number.isFinite(expected))
			return false;
		switch (operator) {
			case "gt":
				return actual > expected;
			case "lt":
				return actual < expected;
			case "gte":
				return actual >= expected;
			case "lte":
				return actual <= expected;
			default:
				return actual === expected;
		}
	}
	if (type === "date") {
		const actual = parseTime(value);
		const expected = parseTime(query);
		if (actual === null || expected === null)
			return operator === "is" && value === query;
		switch (operator) {
			case "before":
				return actual < expected;
			case "after":
				return actual > expected;
			case "on_or_before":
				return actual <= expected;
			case "on_or_after":
				return actual >= expected;
			default:
				return actual === expected;
		}
	}
	const actual = value.toLowerCase();
	const expected = query.toLowerCase();
	switch (operator) {
		case "is":
			return actual === expected;
		case "starts_with":
			return actual.startsWith(expected);
		case "ends_with":
			return actual.endsWith(expected);
		default:
			return actual.includes(expected);
	}
}

export function matchesCsvFilterGroup(
	cells: readonly string[],
	group: CsvFilterGroup,
	columns: readonly (CsvColumnInfo | undefined)[],
) {
	const active = group.rules.filter(isActiveCsvFilterRule);
	if (!active.length) return true;
	const matches = (rule: CsvFilterRule) => {
		const type = columns[rule.column!]?.type;
		return matchesCsvFilter(
			cells[rule.column!] ?? "",
			rule.value,
			type,
			csvFilterRuleOperator(rule, type),
		);
	};
	return group.mode === "all" ? active.every(matches) : active.some(matches);
}
