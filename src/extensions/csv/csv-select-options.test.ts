import { describe, expect, test } from "vitest";
import { inferredOptionColor } from "./csv-infer";
import { selectOptionColor, selectOptions } from "./csv-select-options";

describe("selectOptions", () => {
	const info = {
		options: [
			{ value: "Discovery", color: "gray" },
			{ value: "Qualified", color: "orange" },
		],
	};

	test("declared options come first, then every other value the column holds", () => {
		const options = selectOptions(info, [
			"Qualified",
			"Research",
			"",
			"Discovery",
			"Demo scheduled",
			"Research",
			" Research ",
		]);
		expect(options.map((option) => option.value)).toEqual([
			"Discovery",
			"Qualified",
			"Demo scheduled",
			"Research",
		]);
		expect(options[0]?.color).toBe("gray");
		expect(options[3]?.color).toBe(inferredOptionColor("Research"));
	});

	test("works without metadata and keeps unused declared options", () => {
		expect(selectOptions(undefined, ["b", "a"]).map((o) => o.value)).toEqual([
			"a",
			"b",
		]);
		expect(selectOptions(info, []).map((o) => o.value)).toEqual([
			"Discovery",
			"Qualified",
		]);
	});

	test("a value's colour is its declared one, else the stable hash", () => {
		expect(selectOptionColor(info, "Qualified")).toBe("orange");
		expect(selectOptionColor(info, "Research")).toBe(
			inferredOptionColor("Research"),
		);
	});
});
