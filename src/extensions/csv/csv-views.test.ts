import { expect, test } from "vitest";
import {
	captureCsvView,
	restoreCsvView,
	csvViewSettingsKey,
	type CsvViewSettings,
} from "./csv-views";
import { readCsvMetadata, type CsvColumnInfo } from "./csv-metadata";
const columns: CsvColumnInfo[] = [
	{ id: "name", header: "Name", index: 0, type: "text" },
	{ id: "stage", header: "Stage", index: 1, type: "select" },
	{ id: "contacted", header: "Contacted", index: 2, type: "checkbox" },
];
const settings: CsvViewSettings = {
	filter: {
		mode: "all",
		rules: [
			{ id: "a", column: 1, value: ["Trial", "Qualified"] },
			{ id: "b", column: 2, value: ["true"] },
			{ id: "draft", column: null, value: "" },
		],
	},
	sort: { column: 0, direction: -1 },
	search: "team",
	widths: [220, 160, 130],
};
const view = captureCsvView("followup", "Needs follow-up", settings, columns);

test("saved views survive a metadata round-trip and restore compound conditions, sorting, search, and widths", () => {
	const metadata = readCsvMetadata(
		JSON.parse(
			JSON.stringify({ atelier_csv: { version: 1, columns, views: [view] } }),
		),
	)!;
	expect(metadata.views).toEqual([view]);
	expect(view.filter.rules).toHaveLength(2);
	expect(
		csvViewSettingsKey(
			restoreCsvView(metadata.views![0], columns, [100, 100, 100]),
		),
	).toBe(csvViewSettingsKey(settings));
});
test("column IDs keep view settings attached after a rename, insertion, or reorder", () => {
	const changed = [
		columns[2],
		{ ...columns[1]!, header: "Status" },
		{ id: "new", header: "New", index: 2, type: "text" as const },
		columns[0],
	];
	const restored = restoreCsvView(view, changed, [112, 112, 112, 112]);
	expect(restored.filter.rules.map((rule) => rule.column)).toEqual([1, 0]);
	expect(restored.sort).toEqual({ column: 3, direction: -1 });
	expect(restored.widths).toEqual([130, 160, 112, 220]);
});
test("missing columns never bind filters or sort to a neighboring column", () => {
	const restored = restoreCsvView(view, [columns[2]], [112]);
	expect(restored.filter.rules).toEqual([
		{ id: "followup-1", column: 0, value: ["true"] },
	]);
	expect(restored.sort).toBeNull();
	expect(restored.widths).toEqual([130]);
});
test("malformed and duplicate views are skipped without disabling column definitions", () => {
	const metadata = readCsvMetadata({
		atelier_csv: {
			version: 1,
			columns,
			views: [
				null,
				{ ...view, widths: [{ columnId: "name", width: -10 }] },
				{ ...view, sort: { columnId: "name", direction: "1" } },
				view,
				view,
			],
		},
	});
	expect(metadata?.columns).toEqual(columns);
	expect(metadata?.views).toEqual([view]);
});
test("default view clears predicates and restores automatic widths", () => {
	expect(restoreCsvView(undefined, columns, [120, 130, 140])).toEqual({
		filter: { mode: "all", rules: [] },
		sort: null,
		search: "",
		widths: [120, 130, 140],
		wrapped: [false, false, false],
	});
});

test("saved views restore per-column wrapping independently of the default layout", () => {
	const wrappedView = captureCsvView(
		"wrapped",
		"Wrapped",
		{ ...settings, wrapped: [true, false, false] },
		columns,
	);
	const parsed = readCsvMetadata({
		atelier_csv: { version: 1, columns, views: [wrappedView] },
	})!;
	expect(
		restoreCsvView(parsed.views![0], [columns[2], columns[0]], [112, 112])
			.wrapped,
	).toEqual([false, true]);
	expect(restoreCsvView(undefined, columns, [112, 112, 112]).wrapped).toEqual([
		false,
		false,
		false,
	]);
});

test("saved views keep each rule's condition and drop a view naming an unknown one", () => {
	const conditioned = captureCsvView(
		"open",
		"Still open",
		{
			...settings,
			filter: {
				mode: "all",
				rules: [
					{ id: "a", column: 1, operator: "is_not", value: ["Onboarded"] },
					{ id: "b", column: 0, operator: "not_empty", value: "" },
					{ id: "c", column: 2, value: ["true"] },
				],
			},
		},
		columns,
	);
	expect(conditioned.filter.rules).toEqual([
		{ columnId: "stage", operator: "is_not", value: ["Onboarded"] },
		{ columnId: "name", operator: "not_empty", value: "" },
		{ columnId: "contacted", value: ["true"] },
	]);
	const restored = restoreCsvView(conditioned, columns, [100, 100, 100]);
	expect(restored.filter.rules).toEqual([
		{ id: "open-0", column: 1, operator: "is_not", value: ["Onboarded"] },
		{ id: "open-1", column: 0, operator: "not_empty", value: "" },
		{ id: "open-2", column: 2, value: ["true"] },
	]);
	expect(csvViewSettingsKey(restored)).not.toBe(
		csvViewSettingsKey({
			...restored,
			filter: {
				...restored.filter,
				rules: restored.filter.rules.map((rule) => ({
					...rule,
					operator: undefined,
				})),
			},
		}),
	);
	const metadata = readCsvMetadata(
		JSON.parse(
			JSON.stringify({
				atelier_csv: {
					version: 1,
					columns,
					views: [
						conditioned,
						{
							...conditioned,
							id: "bogus",
							filter: {
								mode: "all",
								rules: [{ columnId: "stage", operator: "unlike", value: "x" }],
							},
						},
					],
				},
			}),
		),
	)!;
	expect(metadata.views?.map((saved) => saved.id)).toEqual(["open"]);
});
