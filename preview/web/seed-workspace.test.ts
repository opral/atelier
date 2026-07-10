import { describe, expect, test } from "vitest";
import { decodeSeedAssetDataUrl } from "./seed-workspace";

describe("decodeSeedAssetDataUrl", () => {
	test("decodes base64 binary assets without converting them to text", () => {
		expect(
			Array.from(decodeSeedAssetDataUrl("data:image/jpeg;base64,/9j/2Q==")),
		).toEqual([255, 216, 255, 217]);
	});

	test("decodes percent-encoded inline assets", () => {
		expect(
			new TextDecoder().decode(
				decodeSeedAssetDataUrl("data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E"),
			),
		).toBe("<svg></svg>");
	});

	test("rejects non-data URLs", () => {
		expect(() => decodeSeedAssetDataUrl("/assets/example.jpeg")).toThrow(
			"Seed asset must be an inline data URL.",
		);
	});
});
