import type {
	Block,
	Document,
	Html,
	Image,
	Inline,
	InlineHtml,
	List,
	Quote,
	Span,
	Table,
	TextBlock,
} from "@opral/zettel-ast";

// A block or inline of an application's own type (`Extension`) also has a
// string `_type`, so a check on `_type` alone does not narrow the unions.
const isImage = (inline: Inline): inline is Image =>
	inline._type === "zettel_image";
const isInlineHtml = (inline: Inline): inline is InlineHtml =>
	inline._type === "zettel_html_inline";

const ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00a0",
	// What Word and web pages write for their typography.
	ndash: "\u2013",
	mdash: "\u2014",
	hellip: "\u2026",
	lsquo: "\u2018",
	rsquo: "\u2019",
	ldquo: "\u201c",
	rdquo: "\u201d",
};

/**
 * The text a reader would see in a piece of raw HTML: tags, comments and
 * what `<script>`/`<style>` hold go, the common entities are decoded.
 * Written without the DOM: a posted comment renders where there is none.
 */
export function htmlText(value: string): string {
	return value
		.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/<!--[\s\S]*?(?:-->|$)/g, "")
		.replace(/<\/?[a-z][^>]*>/gi, "")
		.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
			if (name[0] !== "#") return ENTITIES[name.toLowerCase()] ?? entity;
			const code =
				name[1] === "x" || name[1] === "X"
					? Number.parseInt(name.slice(2), 16)
					: Number.parseInt(name.slice(1), 10);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
		});
}

/**
 * The lines of a raw HTML block, one paragraph each; blank lines go.
 * Shared with the field, which turns the block into the same paragraphs.
 */
export function htmlBlockLines(value: string): string[] {
	return htmlText(value)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

/** An inline's raw HTML as one line of text; "" when it shows nothing. */
export function htmlInlineText(value: string): string {
	return htmlText(value).replace(/\s*\r?\n\s*/g, " ");
}

/**
 * A comment is text. An image pasted from a web page would be posted as a
 * remote `<img>` that loads for every reader, so it becomes its alt text
 * (keeping a link it sat in) and an image without one is dropped. Raw HTML
 * (Word's `<o:p>`, a custom element) would show as a read-only code chip,
 * so it becomes the text it holds, and goes when it holds none. This is the
 * read side: what the field lets in goes through the same rule.
 */
export function asCommentText(document: Document): Document {
	let changed = false;
	const span = (key: string, text: string, marks: readonly string[]): Span => ({
		_type: "zettel_span",
		_key: key,
		text,
		marks: [...marks],
	});
	const inlines = (children: readonly Inline[]): Inline[] =>
		children.flatMap((child): Inline[] => {
			if (isImage(child)) {
				changed = true;
				return child.alt.trim()
					? [span(child._key, child.alt, child.marks)]
					: [];
			}
			if (isInlineHtml(child)) {
				changed = true;
				const text = htmlInlineText(child.value);
				return text ? [span(child._key, text, child.marks)] : [];
			}
			return [child];
		});
	const blocks = (values: readonly Block[]): Block[] => values.flatMap(block);
	const block = (value: Block): Block[] => {
		switch (value._type) {
			case "zettel_block": {
				const text = value as TextBlock;
				return [{ ...text, children: inlines(text.children) }];
			}
			case "zettel_html": {
				changed = true;
				return htmlBlockLines((value as Html).value).map(
					(line, index): TextBlock => ({
						_type: "zettel_block",
						_key: index === 0 ? value._key : `${value._key}-${index}`,
						style: "normal",
						markDefs: [],
						children: [span(`${value._key}-text-${index}`, line, [])],
					}),
				);
			}
			case "zettel_list": {
				const list = value as List;
				return [
					{
						...list,
						items: list.items.map((item) => ({
							...item,
							blocks: blocks(item.blocks),
						})),
					},
				];
			}
			case "zettel_quote": {
				const quote = value as Quote;
				return [{ ...quote, blocks: blocks(quote.blocks) }];
			}
			case "zettel_table": {
				const table = value as Table;
				return [
					{
						...table,
						rows: table.rows.map((row) => ({
							...row,
							cells: row.cells.map((cell) => ({
								...cell,
								children: inlines(cell.children),
							})),
						})),
					},
				];
			}
			default:
				return [value];
		}
	};
	const next = blocks(document.blocks);
	return changed ? { ...document, blocks: next } : document;
}

/**
 * Whether the field holds nothing at all: one empty paragraph, the state a
 * cleared field returns to. Spaces, blank lines or a bullet with nothing
 * after it are something, and the placeholder would sit on top of them.
 */
export function isBlankComment(document: Document): boolean {
	if (document.blocks.length === 0) return true;
	if (document.blocks.length > 1) return false;
	const only = document.blocks[0] as TextBlock;
	return (
		only._type === "zettel_block" &&
		only.style === "normal" &&
		only.children.length === 0
	);
}
