import { describe, expect, test } from "vitest";
import {
	foldComments,
	formatCommentTime,
	renderCommentHtml,
	sharesCommentHeader,
	type ThreadComment,
} from "./comment-thread";
import { avatarTone, isClaudeAuthor } from "./comment-avatar";

const at = (minutes: number) =>
	new Date(Date.UTC(2026, 0, 1, 12, minutes)).toISOString();

function comment(
	id: string,
	author: string | null,
	createdAt: string | null,
): ThreadComment {
	return { id, body: null, author_name: author, lixcol_created_at: createdAt };
}

describe("foldComments", () => {
	test("shows up to four comments without folding", () => {
		const four = [1, 2, 3, 4];
		expect(foldComments(four, false)).toEqual({
			head: four,
			hidden: [],
			tail: [],
		});
	});

	test("keeps the first and the latest two past four, folding the middle", () => {
		expect(foldComments([1, 2, 3, 4, 5, 6], false)).toEqual({
			head: [1],
			hidden: [2, 3, 4],
			tail: [5, 6],
		});
	});

	test("an unfolded thread shows everything", () => {
		expect(foldComments([1, 2, 3, 4, 5], true).head).toEqual([1, 2, 3, 4, 5]);
	});
});

describe("sharesCommentHeader", () => {
	test("groups one author's comments within five minutes", () => {
		expect(
			sharesCommentHeader(
				comment("a", "Mara", at(0)),
				comment("b", "Mara", at(4)),
			),
		).toBe(true);
	});

	test("starts a new header after five minutes or another author", () => {
		expect(
			sharesCommentHeader(
				comment("a", "Mara", at(0)),
				comment("b", "Mara", at(6)),
			),
		).toBe(false);
		expect(
			sharesCommentHeader(
				comment("a", "Mara", at(0)),
				comment("b", "Nils", at(1)),
			),
		).toBe(false);
	});

	test("never groups anonymous comments", () => {
		expect(
			sharesCommentHeader(comment("a", null, at(0)), comment("b", null, at(1))),
		).toBe(false);
	});
});

describe("formatCommentTime", () => {
	const now = Date.parse(at(0)) + 0;
	test("uses the compact form of the design", () => {
		expect(formatCommentTime(at(0), now + 30_000)).toBe("now");
		expect(formatCommentTime(at(0), now + 5 * 60_000)).toBe("5m");
		expect(formatCommentTime(at(0), now + 2 * 3_600_000)).toBe("2h");
		expect(formatCommentTime(at(0), now + 3 * 86_400_000)).toBe("3d");
	});
});

describe("avatars", () => {
	test("one author keeps one tone", () => {
		expect(avatarTone("Samuel")).toBe(avatarTone("Samuel"));
	});

	test("recognizes Claude by name", () => {
		expect(isClaudeAuthor(" claude ")).toBe(true);
		expect(isClaudeAuthor("Claudette")).toBe(false);
	});
});

describe("renderCommentHtml", () => {
	test("shows raw HTML stored in a comment as its text, not a code chip", () => {
		const html = renderCommentHtml({
			_type: "zettel_doc",
			blocks: [
				{
					_type: "zettel_block",
					_key: "a",
					style: "normal",
					markDefs: [],
					children: [
						{ _type: "zettel_span", _key: "b", text: "Hello", marks: [] },
						{
							_type: "zettel_html_inline",
							_key: "c",
							value: "<o:p></o:p>",
							marks: [],
						},
					],
				},
				{ _type: "zettel_html", _key: "d", value: "<x-custom>b</x-custom>" },
			],
		});
		expect(html).not.toMatch(/<code|<pre|o:p|x-custom/);
		expect(html).toContain("Hello");
		expect(html).toMatch(/<p[^>]*><span[^>]*>b<\/span><\/p>/);
	});
});
