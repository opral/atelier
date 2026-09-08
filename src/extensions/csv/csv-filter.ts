import type { CsvColumnInfo } from "./csv-metadata";

export function matchesCsvFilter(
	value: string,
	query: string | readonly string[],
	type?: CsvColumnInfo["type"],
): boolean {
	if (typeof query !== "string")
		return (
			query.length === 0 ||
			query.some((item) => matchesCsvFilter(value, item, type))
		);
	if (!query) return true;
	if (type === "select" || type === "date") return value === query;
	if (type === "checkbox") {
		if (query === "empty") return value === "";
		return query === "true"
			? /^(yes|true|1)$/i.test(value)
			: /^(no|false|0)$/i.test(value);
	}
	if (type === "number")
		return (
			value.trim() !== "" &&
			Number.isFinite(Number(value)) &&
			Number(value) === Number(query)
		);
	return value.toLowerCase().includes(query.toLowerCase());
}

export type CsvFilterRule = {
	id: string;
	column: number | null;
	value: string | readonly string[];
};
export type CsvFilterGroup = {
	mode: "all" | "any";
	rules: readonly CsvFilterRule[];
};
export const EMPTY_CSV_FILTER: CsvFilterGroup = { mode: "all", rules: [] };
export function isActiveCsvFilterRule(rule: CsvFilterRule) {
	return rule.column !== null && rule.value.length > 0;
}
export function matchesCsvFilterGroup(
	cells: readonly string[],
	group: CsvFilterGroup,
	columns: readonly (CsvColumnInfo | undefined)[],
) {
	const active = group.rules.filter(isActiveCsvFilterRule);
	if (!active.length) return true;
	const matches = (rule: CsvFilterRule) =>
		matchesCsvFilter(
			cells[rule.column!] ?? "",
			rule.value,
			columns[rule.column!]?.type,
		);
	return group.mode === "all" ? active.every(matches) : active.some(matches);
}
