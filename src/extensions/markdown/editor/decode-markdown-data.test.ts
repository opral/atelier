import { describe, expect, test } from "vitest";
import { decodeMarkdownData } from "./decode-markdown-data";

describe("decodeMarkdownData", () => {
	test("decodes Uint8Array bytes", () => {
		const value = new TextEncoder().encode("hello");
		expect(decodeMarkdownData(value)).toBe("hello");
	});

	test("decodes string values", () => {
		expect(decodeMarkdownData("hello")).toBe("hello");
	});
});
