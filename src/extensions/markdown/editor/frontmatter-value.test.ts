import { describe, expect, test } from "vitest";
import {
	frontmatterSourceFromInput,
	parseFrontmatterSource,
	stringifyFrontmatterValue,
} from "./frontmatter-value";

describe("frontmatter values", () => {
	test("parses common scalar, list, and nested fields", () => {
		const parsed = parseFrontmatterSource(
			"title: Demo\npublished: true\ntags:\n  - markdown\nauthor:\n  name: Atelier",
		);
		expect(parsed.error).toBeNull();
		expect(parsed.value).toEqual({
			title: "Demo",
			published: true,
			tags: ["markdown"],
			author: { name: "Atelier" },
		});
	});

	test("serializes edited fields as YAML without delimiters", () => {
		expect(
			stringifyFrontmatterValue({
				title: "Demo",
				published: false,
				tags: ["markdown", "atelier"],
			}),
		).toBe("title: Demo\npublished: false\ntags:\n  - markdown\n  - atelier");
	});

	test("accepts programmatic objects and complete YAML blocks", () => {
		expect(frontmatterSourceFromInput({ title: "Post" })).toBe("title: Post");
		expect(frontmatterSourceFromInput("---\ntitle: Post\n---")).toBe(
			"title: Post",
		);
	});

	test("starts an interactive frontmatter flow without a default property", () => {
		expect(frontmatterSourceFromInput(undefined)).toBe("");
	});

	test("reports non-map YAML as invalid for the fields editor", () => {
		const parsed = parseFrontmatterSource("- one\n- two");
		expect(parsed.value).toBeNull();
		expect(parsed.error).toMatch(/key-value fields/i);
	});
});
