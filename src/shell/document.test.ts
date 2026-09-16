import { readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";
import { expect, test } from "vitest";
import { RENDER_CSS } from "../render/styles";

/**
 * The contract: a document rule lives in document.css and nowhere else.
 *
 * The editor reads document.css plus its own sheet; the static render inlines
 * document.css plus its own chrome. Neither may say what a heading, a
 * paragraph or a cell looks like — that is how the two drifted apart before.
 * This walks both effective stylesheets and takes every declaration of a
 * look-defining property on a document element, made by a selector that names
 * nothing but document structure. The list must be document.css's list: no
 * rule more, none different.
 */

const ELEMENTS = new Set([
	"h1",
	"h2",
	"h3",
	"p",
	"li",
	"code",
	"pre",
	"blockquote",
	"td",
	"th",
	"a",
]);
const PROPERTIES = new Set([
	"font-size",
	"font-weight",
	"line-height",
	"color",
	"background",
	"border",
]);
/** The classes that only say "this is the document" or "this is the editor". */
const ROOTS = new Set([
	"atelier-document",
	"atelier-render",
	"atelier-root",
	"atelier-file-view",
	"md-diff",
	"markdown-view",
	"markdown-review",
	"ProseMirror",
	"tiptap",
]);

const root = join(__dirname, "..", "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

type Entry = readonly [selector: string, property: string, value: string];

/** A selector's compounds, split on the combinators outside any brackets. */
function compounds(selector: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let current = "";
	for (const char of selector) {
		if (char === "(" || char === "[") depth += 1;
		if (char === ")" || char === "]") depth -= 1;
		if (depth === 0 && /[\s>+~]/.test(char)) {
			if (current) out.push(current);
			current = "";
		} else current += char;
	}
	if (current) out.push(current);
	return out;
}

/** The element types a compound's subject can be: `li`, or `h1, h2` for `:is(h1, h2)`. */
function subjects(compound: string): string[] {
	const type = compound.match(/^[a-z][a-z0-9]*/)?.[0];
	if (type) return [type];
	const group = compound.match(/^:(?:is|where)\(([^)]*)\)/)?.[1];
	if (!group) return [];
	return group.split(",").flatMap((part) => subjects(part.trim()));
}

/**
 * A selector that names document structure only: element types, `data-`
 * attributes, pseudo-classes, and the root classes — no class a component
 * invented. Such a selector can only be stating a document rule.
 */
function isDocumentSelector(selector: string): boolean {
	const classes = selector.match(/\.[\w-]+/g) ?? [];
	if (classes.some((name) => !ROOTS.has(name.slice(1)))) return false;
	if (/#[\w-]/.test(selector)) return false;
	const attributes = selector.match(/\[[^\]]+\]/g) ?? [];
	return attributes.every((attribute) => /^\[data-/.test(attribute));
}

/** The selector with its root prefix removed, so both sheets compare alike. */
function normalize(selector: string): string {
	return compounds(selector)
		.filter(
			(compound) =>
				!/^\.[\w-]+$/.test(compound) || !ROOTS.has(compound.slice(1)),
		)
		.join(" ");
}

/** Every look-defining declaration a sheet makes on a document element. */
function documentRules(css: string): Entry[] {
	const entries: Entry[] = [];
	postcss.parse(css).walkRules((rule) => {
		for (const selector of rule.selectors) {
			if (!isDocumentSelector(selector)) continue;
			const parts = compounds(selector);
			const last = parts.at(-1) ?? "";
			// A pseudo-element (`li::marker`) is not the element.
			if (last.includes("::")) continue;
			const types = subjects(last).filter((type) => ELEMENTS.has(type));
			if (types.length === 0) continue;
			rule.walkDecls((declaration) => {
				// `border-bottom-color` is a border, `background-color` a background.
				const property = declaration.prop
					.replace(/-(?:top|right|bottom|left)/, "")
					.replace(/-color$/, "");
				if (!PROPERTIES.has(property)) return;
				entries.push([
					normalize(selector),
					declaration.prop,
					// The render's copy is compacted; the value is the same value.
					declaration.value.replace(/\s+/g, " ").replace(/\s*([,/])\s*/g, "$1"),
				]);
			});
		}
	});
	return entries;
}

const documentCss = read("src/shell/document.css");
const editorCss = read("src/extensions/markdown/style.css");
const contract = documentRules(documentCss);

test("document.css says how every document element looks", () => {
	const covered = new Set(
		contract.flatMap(([selector]) =>
			subjects(compounds(selector).at(-1) ?? ""),
		),
	);
	// A paragraph and a list item are body type: their look is the root's.
	for (const element of ELEMENTS)
		if (element !== "p" && element !== "li") expect(covered).toContain(element);
});

test("the editor adds no document rule to document.css's", () => {
	expect(documentRules(documentCss + "\n" + editorCss)).toEqual(contract);
});

test("the render adds no document rule to document.css's", () => {
	expect(documentRules(RENDER_CSS)).toEqual(contract);
});

test("the render sets its density with one declaration, not a second scale", () => {
	const compact = RENDER_CSS.replace(/\s+/g, "");
	expect(compact).toContain("--atelier-doc-font-size:14px;");
	expect(compact).toContain("font-size:var(--atelier-doc-font-size,16px)");
});
