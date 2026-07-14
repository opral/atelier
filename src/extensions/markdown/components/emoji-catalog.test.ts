import { describe, expect, test } from "vitest";
import {
	filterEmojiCatalog,
	loadEmojiCatalog,
	popularEmojiCatalog,
} from "./emoji-catalog";

describe("emoji catalog", () => {
	test("shows familiar emoji first when the query is empty", () => {
		expect(
			filterEmojiCatalog(popularEmojiCatalog, "", 4).map((item) => item.emoji),
		).toEqual(["😀", "😂", "❤️", "👍"]);
	});

	test("supports common shortcode aliases", () => {
		expect(filterEmojiCatalog(popularEmojiCatalog, "thumbsup")[0]?.emoji).toBe(
			"👍",
		);
		expect(filterEmojiCatalog(popularEmojiCatalog, "+1")[0]?.emoji).toBe("👍");
		expect(filterEmojiCatalog(popularEmojiCatalog, "tada")[0]?.emoji).toBe(
			"🎉",
		);
	});

	test("loads and searches the full Unicode catalog", async () => {
		const catalog = await loadEmojiCatalog();
		expect(catalog.length).toBeGreaterThan(1_800);
		expect(filterEmojiCatalog(catalog, "woman_technologist")[0]?.emoji).toBe(
			"👩‍💻",
		);
	});
});
