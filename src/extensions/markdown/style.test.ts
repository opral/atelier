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

/**
 * Backspace or Delete beside a table, rule or image selects the whole block,
 * and the next key deletes it. Each of them must look selected, outside a
 * review, with something that actually paints: the image has no border, so
 * a border colour alone showed nothing.
 */
test("a table, rule or image selected whole is visibly selected", () => {
	const looks = (selector: RegExp) => {
		const found: string[] = [];
		sheet.walkRules((rule) => {
			if (!selector.test(rule.selector)) return;
			const paints = rule.some(
				(node) =>
					node.type === "decl" &&
					[
						"outline",
						"box-shadow",
						"background-color",
						"border-color",
					].includes(node.prop) &&
					node.value.includes("var(--atelier-"),
			);
			if (paints) found.push(rule.selector);
		});
		return found;
	};
	const table = looks(/table\.ProseMirror-selectednode/);
	const rule = looks(/hr\.ProseMirror-selectednode/);
	const image = looks(
		/markdown-image-embed\.ProseMirror-selectednode[\s\S]*markdown-image-block-content/,
	);
	for (const selectors of [table, rule, image]) {
		expect(selectors.length).toBeGreaterThan(0);
	}
	for (const selector of [...table, ...rule])
		expect(selector).toContain(".markdown-view:not(.markdown-review)");
	// A ring, not only a border colour, on the image.
	sheet.walkRules((node) => {
		if (!image.includes(node.selector)) return;
		expect(
			node.some((decl) => decl.type === "decl" && decl.prop === "box-shadow"),
		).toBe(true);
	});
});
