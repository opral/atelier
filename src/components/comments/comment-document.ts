import type {
	Block,
	Document,
	Image,
	Inline,
	List,
	Quote,
	Table,
	TextBlock,
} from "@opral/zettel-ast";

// A block or inline of an application's own type (`Extension`) also has a
// string `_type`, so a check on `_type` alone does not narrow the unions.
const isImage = (inline: Inline): inline is Image =>
	inline._type === "zettel_image";

/**
 * A comment is text. An image pasted from a web page would be posted as a
 * remote `<img>` that loads for every reader, so it becomes its alt text
 * (keeping a link it sat in) and an image without one is dropped. This is
 * the read side: what the field lets in goes through the same rule.
 */
export function withoutImages(document: Document): Document {
	let changed = false;
	const inlines = (children: readonly Inline[]): Inline[] =>
		children.flatMap((child): Inline[] => {
			if (!isImage(child)) return [child];
			changed = true;
			if (!child.alt.trim()) return [];
			return [
				{
					_type: "zettel_span",
					_key: child._key,
					text: child.alt,
					marks: [...child.marks],
				},
			];
		});
	const block = (value: Block): Block => {
		switch (value._type) {
			case "zettel_block": {
				const text = value as TextBlock;
				return { ...text, children: inlines(text.children) };
			}
			case "zettel_list": {
				const list = value as List;
				return {
					...list,
					items: list.items.map((item) => ({
						...item,
						blocks: item.blocks.map(block),
					})),
				};
			}
			case "zettel_quote": {
				const quote = value as Quote;
				return { ...quote, blocks: quote.blocks.map(block) };
			}
			case "zettel_table": {
				const table = value as Table;
				return {
					...table,
					rows: table.rows.map((row) => ({
						...row,
						cells: row.cells.map((cell) => ({
							...cell,
							children: inlines(cell.children),
						})),
					})),
				};
			}
			default:
				return value;
		}
	};
	const blocks = document.blocks.map(block);
	return changed ? { ...document, blocks } : document;
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
