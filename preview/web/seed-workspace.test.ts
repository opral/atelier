import { describe, expect, test, vi } from "vitest";
import {
	decodeSeedAssetDataUrl,
	embedSeedAssets,
	seedWorkspace,
} from "./seed-workspace";

describe("seedWorkspace", () => {
	test("stores the seeded PDF as its original binary bytes", async () => {
		const inserts: unknown[][] = [];
		const lix = {
			execute: vi.fn(async (sql: string, parameters?: unknown[]) => {
				if (sql.startsWith("INSERT INTO lix_file ") && parameters) {
					inserts.push(parameters);
				}
			}),
			createBranch: vi.fn(async () => undefined),
		};

		await seedWorkspace(lix as never);

		const pdf = inserts.find((parameters) =>
			String(parameters[1]).endsWith("/assets/example.pdf"),
		);
		expect(pdf).toBeDefined();
		expect(pdf?.[2]).toBeInstanceOf(Uint8Array);
		const bytes = pdf?.[2] as Uint8Array;
		expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.4");
		expect(bytes.byteLength).toBeGreaterThan(2_000);
	});
});

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
			"./seed/markdown-extension/PDF-embed.md",
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
