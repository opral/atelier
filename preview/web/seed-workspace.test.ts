import { describe, expect, test } from "vitest";
import { decodeSeedAssetDataUrl, embedSeedAssets } from "./seed-workspace";

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

describe("embedSeedAssets", () => {
	test("keeps PDF embeds workspace-relative while inlining image assets", () => {
		const markdown = embedSeedAssets(
			"./seed/PDF-embed.md",
			[
				"![PDF](assets/example.pdf#page=1)",
				"![Image](assets/example.svg)",
			].join("\n"),
		);

		expect(markdown).toContain("![PDF](assets/example.pdf#page=1)");
		expect(markdown).not.toContain("![Image](assets/example.svg)");
		expect(markdown).toContain("![Image](data:image/svg+xml");
	});
});
