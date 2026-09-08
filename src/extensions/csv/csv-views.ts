import type { CsvColumnInfo } from "./csv-metadata";
import {
	EMPTY_CSV_FILTER,
	isActiveCsvFilterRule,
	type CsvFilterGroup,
} from "./csv-filter";

export type CsvViewSettings = {
	filter: CsvFilterGroup;
	sort: { column: number; direction: 1 | -1 } | null;
	search: string;
	widths: readonly number[];
	wrapped?: readonly boolean[];
};
export type CsvSavedView = {
	id: string;
	name: string;
	filter: {
		mode: "all" | "any";
		rules: { columnId: string; value: string | readonly string[] }[];
	};
	sort: { columnId: string; direction: 1 | -1 } | null;
	search: string;
	widths: { columnId: string; width: number; wrap?: boolean }[];
};

export function captureCsvView(
	id: string,
	name: string,
	settings: CsvViewSettings,
	columns: readonly CsvColumnInfo[],
): CsvSavedView {
	return {
		id,
		name: name.trim(),
		filter: {
			mode: settings.filter.mode,
			rules: settings.filter.rules
				.filter(isActiveCsvFilterRule)
				.flatMap((rule) =>
					columns[rule.column!]
						? [{ columnId: columns[rule.column!]!.id, value: rule.value }]
						: [],
				),
		},
		sort:
			settings.sort && columns[settings.sort.column]
				? {
						columnId: columns[settings.sort.column]!.id,
						direction: settings.sort.direction,
					}
				: null,
		search: settings.search,
		widths: columns.flatMap((column, index) =>
			settings.widths[index] === undefined
				? []
				: [
						{
							columnId: column.id,
							width: settings.widths[index]!,
							...(settings.wrapped
								? { wrap: settings.wrapped[index] ?? false }
								: {}),
						},
					],
		),
	};
}

/** Missing columns are ignored, never silently rebound to another column. */
export function restoreCsvView(
	view: CsvSavedView | undefined,
	columns: readonly (CsvColumnInfo | undefined)[],
	defaultWidths: readonly number[],
): CsvViewSettings {
	if (!view)
		return {
			filter: EMPTY_CSV_FILTER,
			sort: null,
			search: "",
			widths: defaultWidths,
			wrapped: columns.map((column) => column?.wrap ?? false),
		};
	const indexOf = (id: string) =>
		columns.findIndex((column) => column?.id === id);
	const sortColumn = view.sort ? indexOf(view.sort.columnId) : -1;
	return {
		filter: {
			mode: view.filter.mode,
			rules: view.filter.rules.flatMap((rule, i) => {
				const column = indexOf(rule.columnId);
				return column < 0
					? []
					: [{ id: `${view.id}-${i}`, column, value: rule.value }];
			}),
		},
		sort:
			view.sort && sortColumn >= 0
				? { column: sortColumn, direction: view.sort.direction }
				: null,
		search: view.search,
		wrapped: columns.map(
			(column) =>
				view.widths.find((width) => width.columnId === column?.id)?.wrap ??
				column?.wrap ??
				false,
		),
		widths: columns.map(
			(column, i) =>
				view.widths.find((width) => width.columnId === column?.id)?.width ??
				defaultWidths[i]!,
		),
	};
}

export function csvViewSettingsKey(settings: CsvViewSettings): string {
	return JSON.stringify({
		search: settings.search,
		sort: settings.sort,
		widths: settings.widths,
		wrapped: settings.widths.map(
			(_, index) => settings.wrapped?.[index] ?? false,
		),
		filter: {
			mode: settings.filter.mode,
			rules: settings.filter.rules
				.filter(isActiveCsvFilterRule)
				.map(({ column, value }) => ({
					column,
					value: typeof value === "string" ? value : [...value].sort(),
				})),
		},
	});
}

/** Validate views independently so one malformed view cannot disable column types. */
export function readCsvViews(value: unknown): CsvSavedView[] {
	if (!Array.isArray(value)) return [];
	const object = (v: unknown): v is Record<string, unknown> =>
		v !== null && typeof v === "object" && !Array.isArray(v);
	const ids = new Set<string>();
	return value.flatMap((view) => {
		if (
			!object(view) ||
			typeof view.id !== "string" ||
			!view.id ||
			ids.has(view.id) ||
			typeof view.name !== "string" ||
			!view.name.trim() ||
			typeof view.search !== "string" ||
			!object(view.filter) ||
			!["all", "any"].includes(String(view.filter.mode)) ||
			!Array.isArray(view.filter.rules) ||
			!Array.isArray(view.widths)
		)
			return [];
		if (
			view.sort !== null &&
			(!object(view.sort) ||
				typeof view.sort.columnId !== "string" ||
				![1, -1].includes(Number(view.sort.direction)) ||
				typeof view.sort.direction !== "number")
		)
			return [];
		if (
			!view.filter.rules.every(
				(rule) =>
					object(rule) &&
					typeof rule.columnId === "string" &&
					(typeof rule.value === "string" ||
						(Array.isArray(rule.value) &&
							rule.value.every((v) => typeof v === "string"))),
			)
		)
			return [];
		if (
			!view.widths.every(
				(width) =>
					object(width) &&
					typeof width.columnId === "string" &&
					typeof width.width === "number" &&
					Number.isFinite(width.width) &&
					width.width >= 40 &&
					width.width <= 2000 &&
					(width.wrap === undefined || typeof width.wrap === "boolean"),
			)
		)
			return [];
		ids.add(view.id);
		return [view as unknown as CsvSavedView];
	});
}
