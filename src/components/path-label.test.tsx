import { expect, test } from "vitest";
import { pathLabelText, splitPathLabel } from "./path-label";

test("root files show only their name", () => {
	expect(splitPathLabel("/README.md")).toEqual({
		parent: null,
		name: "README.md",
	});
	expect(pathLabelText("README.md")).toBe("README.md");
});

test("one parent folder precedes the name", () => {
	expect(splitPathLabel("/.lix/README.md")).toEqual({
		parent: ".lix/",
		name: "README.md",
	});
});

test("deeper paths collapse to the nearest parent", () => {
	expect(pathLabelText("/docs/extensions/plan.md")).toBe(
		"…/extensions/plan.md",
	);
	expect(pathLabelText("/a/b/c/d.csv")).toBe("…/c/d.csv");
});
