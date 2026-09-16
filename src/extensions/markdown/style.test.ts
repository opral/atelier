import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { expect, test } from "vitest";

const sheet = postcss.parse(
	readFileSync(join(import.meta.dirname, "style.css"), "utf8"),
);

/**
 * The selection ring on the frontmatter panel warns that typing would replace
 * the whole node. A review cannot be typed into, and its document opens with
 * the selection on that first node, so the ring must not apply there: the
 * panel's fields carry the diff's own marks and nothing else.
 */
test("the frontmatter selection ring does not apply in a review", () => {
	const rules: string[] = [];
	sheet.walkRules((rule) => {
		if (
			rule.selector.includes('.markdown-frontmatter[data-selected="true"]') &&
			rule.some((node) => node.type === "decl" && node.prop === "box-shadow")
		) {
			rules.push(rule.selector);
		}
	});
	expect(rules).toHaveLength(1);
	expect(rules[0]).toContain(".markdown-view:not(.markdown-review)");
});
