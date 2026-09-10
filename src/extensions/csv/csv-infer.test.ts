import { describe, expect, test } from "vitest";
import { GridCellKind } from "@glideapps/glide-data-grid";
import {
	inferColumnInfo,
	inferColumnKind,
	inferredOptionColor,
} from "./csv-infer";
import { providePropertyEditor, type PropertyCell } from "./csv-properties";

describe("inferColumnKind", () => {
	test("reads a checkbox from spelled-out booleans, not from 0/1 alone", () => {
		expect(inferColumnKind(["yes", "no", "", "YES"]).type).toBe("checkbox");
		expect(inferColumnKind(["1", "0", "1"]).type).toBe("number");
		expect(inferColumnKind(["true", "1", "0"]).type).toBe("checkbox");
	});

	test("reads numbers, ISO dates, emails, and URLs when every value agrees", () => {
		expect(inferColumnKind(["1,200", "3.5", "-7", "12%"]).type).toBe("number");
		expect(inferColumnKind(["2026-08-21", "", "2026-07-10T09:30"]).type).toBe(
			"date",
		);
		expect(inferColumnKind(["a@b.co", "felix@ultrahost.ai"]).type).toBe(
			"email",
		);
		expect(inferColumnKind(["https://x.y/z", "http://a.b"]).type).toBe("url");
		expect(inferColumnKind(["2026-08-21", "tomorrow"]).type).toBe("text");
	});

	test("reads a select from a small vocabulary that repeats", () => {
		const kind = inferColumnKind([
			"onboarded",
			"onboarded",
			"trial",
			"qualified",
			"qualified",
			"discovery",
			"",
		]);
		expect(kind.type).toBe("select");
		expect(kind.options?.map((option) => option.value)).toEqual([
			"onboarded",
			"trial",
			"qualified",
			"discovery",
		]);
		expect(kind.options?.every((option) => option.color)).toBe(true);
	});

	test("keeps unique or long vocabularies as text", () => {
		expect(inferColumnKind(["Kian", "Felix", "Zac", "Aniket"]).type).toBe(
			"text",
		);
		expect(
			inferColumnKind([
				"a sentence that is much longer than a chip",
				"a sentence that is much longer than a chip",
				"another",
			]).type,
		).toBe("text");
	});

	test("wraps text whose typical value is long", () => {
		const long = "x".repeat(90);
		expect(inferColumnKind([long, long, "short"])).toEqual({
			type: "text",
			wrap: true,
		});
		expect(inferColumnKind(["short", "short", long])).toEqual({
			type: "text",
		});
		expect(inferColumnKind(["", ""])).toEqual({ type: "text" });
	});

	test("assigns each value a stable palette colour", () => {
		expect(inferredOptionColor("trial")).toBe(inferredOptionColor("trial"));
		expect([
			"gray",
			"brown",
			"orange",
			"yellow",
			"green",
			"blue",
			"purple",
			"pink",
			"red",
		]).toContain(inferredOptionColor("trial"));
	});
});

describe("inferColumnInfo", () => {
	test("keeps metadata and infers only the columns without it", () => {
		const info = inferColumnInfo(
			["name", "stage"],
			[
				{ rowNumber: 1, cells: ["Kian", "trial"] },
				{ rowNumber: 2, cells: ["Felix", "trial"] },
				{ rowNumber: 3, cells: ["Zac", "onboarded"] },
				{ rowNumber: 4, cells: ["Aniket", "onboarded"] },
			],
			[{ id: "c0", header: "name", index: 0, type: "text" }, undefined],
		);
		expect(info[0]).toEqual({
			id: "c0",
			header: "name",
			index: 0,
			type: "text",
		});
		expect(info[1]).toMatchObject({
			id: "inferred:1",
			header: "stage",
			index: 1,
			type: "select",
			inferred: true,
		});
	});
});

describe("providePropertyEditor", () => {
	test("edits an inferred select as the plain text it is", () => {
		const cell = {
			kind: GridCellKind.Text,
			data: "trial",
			displayData: "trial",
			allowOverlay: true,
			csvInfo: {
				id: "inferred:1",
				header: "stage",
				index: 1,
				type: "select",
				options: [{ value: "trial", color: "blue" }],
			},
			csvInferred: true,
		} as PropertyCell;
		expect(providePropertyEditor(cell)).toMatchObject({
			disablePadding: false,
		});
		expect(
			providePropertyEditor({ ...cell, csvInferred: false } as PropertyCell),
		).toMatchObject({ disableStyling: true });
	});
});
