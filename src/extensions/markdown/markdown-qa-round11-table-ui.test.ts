import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss, { type Rule } from "postcss";
import { expect, test } from "vitest";

const sheet = postcss.parse(
	readFileSync(join(import.meta.dirname, "style.css"), "utf8"),
);

/** The declarations of every rule matching `selector`, under `media`. */
function declarations(selector: RegExp, media: RegExp | null = null) {
	const found: Record<string, string> = {};
	sheet.walkRules((rule: Rule) => {
		if (!selector.test(rule.selector)) return;
		const parent = rule.parent;
		const inMedia =
			parent?.type === "atrule" && (parent as any).name === "media"
				? String((parent as any).params)
				: null;
		if (media ? !inMedia || !media.test(inMedia) : inMedia) return;
		rule.walkDecls((decl) => {
			found[decl.prop] = decl.value;
		});
	});
	return found;
}

/**
 * The bottom "+" bar is drawn in a strip the table keeps below its grid.
 * Without it the bar sat in the gap above the next paragraph, and a click
 * meant for that paragraph's first line added a row instead. The strip is
 * there whether the bar shows or not, so nothing jumps on hover, and it is
 * taller where a finger has to hit the bar.
 */
test("an editable table keeps a strip below its grid for the add-row bar", () => {
	const fine = declarations(/\[contenteditable="true"\] table$/);
	expect(fine["padding-bottom"]).toBe("1rem");
	const coarse = declarations(
		/\[contenteditable="true"\] table$/,
		/pointer: coarse/,
	);
	expect(coarse["padding-bottom"]).toBe("2rem");
});

/**
 * The grips are 14 by 24 pixels, too small for a finger. On a coarse
 * pointer something invisible around each one takes the touch.
 */
test("a coarse pointer gets a larger hit area around each grip", () => {
	const hit = declarations(/\.markdown-table-grip::after/, /pointer: coarse/);
	expect(hit.content).toBe('""');
	expect(hit.inset).toBe("-10px");
});

/**
 * The column's alignment and the button the keys are on are two different
 * things: one is filled in, the other gets the focus ring. They used to be
 * a ring and a grey fill, which read as two chosen values.
 */
test("the alignment the keys are on is a focus ring, the chosen one a fill", () => {
	const focused = declarations(
		/\[data-keyboard="true"\][\s\S]*align-option\[data-active="true"\]$/,
	);
	expect(focused.outline).toContain("var(--atelier-ring)");
	const checked = declarations(/align-option\[data-checked="true"\]$/);
	expect(checked["box-shadow"]).not.toContain("inset");
	expect(checked.background).toBe("var(--atelier-panel)");
});

/**
 * A document opens with its selection on the first block. A selected-block
 * ring that did not ask for focus drew itself around an unfocused
 * document's opening frontmatter, table or image — a flash of chrome on
 * every open. Every rule that paints a selected block in the ring or the
 * selection tint is scoped to a focused editor.
 */
test("selected-block rings show only in a focused editor", () => {
	const unscoped: string[] = [];
	sheet.walkRules((rule: Rule) => {
		if (!/ProseMirror-selectednode|data-selected="true"/.test(rule.selector))
			return;
		if (/:not\([^)]*ProseMirror-selectednode/.test(rule.selector)) return;
		let paints = false;
		rule.walkDecls((decl) => {
			if (/--atelier-(ring|bg-selection)/.test(decl.value)) paints = true;
		});
		if (paints && !rule.selector.includes(".ProseMirror-focused"))
			unscoped.push(rule.selector.replace(/\s+/g, " "));
	});
	expect(unscoped).toEqual([]);
});
