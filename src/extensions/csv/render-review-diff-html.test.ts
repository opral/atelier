import { describe, expect, test } from "vitest";
import { renderCsvReviewDiffHtml } from "./render-review-diff-html";

const enc = new TextEncoder();

function reviewData(before: string, after: string) {
	return {
		beforeData: enc.encode(before),
		afterData: enc.encode(after),
	};
}

describe("renderCsvReviewDiffHtml", () => {
	test("an edited first cell diffs in place instead of splitting the row", () => {
		const html = renderCsvReviewDiffHtml(
			reviewData("Column 1\nalpha\n", "Column 1\nalpha-9000\n"),
		);
		// The row keeps one identity, so the change renders as a word-level
		// cell diff — not an added row plus a removed one.
		expect(html).not.toMatch(/<tr[^>]*data-diff-status="added"/);
		expect(html).not.toMatch(/<tr[^>]*data-diff-status="removed"/);
		// The word diff keeps the shared prefix and marks only the suffix.
		expect(html).toMatch(/alpha<span data-diff-status="added">-9000<\/span>/);
		// Nothing may leak outside the table: a removed <tr> appended after
		// </table> gets re-parented by the browser into stray text.
		expect(html.slice(html.indexOf("</table>"))).toBe("</table>");
	});

	test("a genuinely added row still reports as added", () => {
		const html = renderCsvReviewDiffHtml(
			reviewData("Column 1\nalpha\n", "Column 1\nalpha\nbeta\n"),
		);
		expect(html).toContain('data-diff-status="added"');
		expect(html.slice(html.indexOf("</table>"))).toBe("</table>");
	});

	test("a removed row renders inside the table as removed", () => {
		const html = renderCsvReviewDiffHtml(
			reviewData("Column 1\nalpha\nbeta\n", "Column 1\nalpha\n"),
		);
		expect(html).toContain("beta");
		expect(html.slice(html.indexOf("</table>"))).toBe("</table>");
	});
});
