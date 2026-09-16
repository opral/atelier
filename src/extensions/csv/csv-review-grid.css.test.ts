import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { expect, test } from "vitest";

const sheet = postcss.parse(
	readFileSync(join(import.meta.dirname, "csv-review-grid.css"), "utf8"),
);

function declarations(selector: string): Record<string, string> {
	const found: Record<string, string> = {};
	sheet.walkRules((rule) => {
		if (rule.selector !== selector) return;
		rule.walkDecls((decl) => {
			found[decl.prop] = decl.value;
		});
	});
	return found;
}

/**
 * The review lands in the live grid's box to the pixel. The grid's canvas is
 * its header (40px) plus the rule it draws under it, then the rows, then two
 * pixels of slack past the last column and one below the last row.
 */
test("the review table occupies the live grid's box", () => {
	const header = declarations(".csv-review-table thead th");
	expect(header.height).toBe("41px");
	const table = declarations(".csv-review-table");
	expect(table["border-right"]).toBe("2px solid transparent");
	expect(table["border-bottom"]).toBe("1px solid transparent");
	expect(declarations(".csv-review-header-content").height).toBe("40px");
});
