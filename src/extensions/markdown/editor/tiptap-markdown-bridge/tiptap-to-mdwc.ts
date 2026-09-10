import { normalizeAst } from "../markdown";
import {
	CODE_META_DATA_KEY,
	LIST_LEADING_PARAGRAPH_DATA_KEY,
	EMPTY_MARKDOWN_PARAGRAPH_DATA_KEY,
	EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY,
} from "./mdwc-to-tiptap";

const SPREAD_META_KEY = "__mdwc_spread";

function extractNodeData(attrs: PMNode["attrs"]): {
	data?: Record<string, any>;
	spread?: boolean;
} {
	const raw = attrs?.data;
	if (!raw || typeof raw !== "object") {
		return { data: undefined };
	}
	const clone: Record<string, any> = { ...raw };
	let spread: boolean | undefined;
	if (SPREAD_META_KEY in clone) {
		const value = clone[SPREAD_META_KEY];
		if (typeof value === "boolean") {
			spread = value;
		}
		delete clone[SPREAD_META_KEY];
	}
	delete clone[EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY];
	delete clone[EMPTY_MARKDOWN_PARAGRAPH_DATA_KEY];
	delete clone[LIST_LEADING_PARAGRAPH_DATA_KEY];
	delete clone[CODE_META_DATA_KEY];
	return {
		data: Object.keys(clone).length > 0 ? clone : undefined,
		spread,
	};
}

type PMMark = {
	type: "bold" | "italic" | "strike" | "code" | "link";
	attrs?: Record<string, any>;
};
export type PMNode = {
	type: string;
	attrs?: Record<string, any>;
	content?: PMNode[];
	text?: string;
	marks?: PMMark[];
};

export function tiptapDocToAst(doc: PMNode): any {
	const outChildren: any[] = [];
	const children = doc.content || [];
	for (const n of children) {
		if (n.type === "paragraph") {
			const inline = pmInlineToMd(n.content || []);
			if (
				!inline.length &&
				children.length === 1 &&
				!isExplicitEmptyParagraph(n)
			) {
				continue;
			}
		}
		if (
			n.type === "heading" &&
			n.attrs?.data?.[EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY]
		) {
			const inline = pmInlineToMd(n.content || []);
			if (!inline.length) continue;
		}
		const preserveEmptyParagraph =
			n.type === "paragraph" &&
			!pmInlineToMd(n.content || []).length &&
			(children.length > 1 || isExplicitEmptyParagraph(n));
		outChildren.push(pmBlockToAst(n, { preserveEmptyParagraph }));
	}
	return normalizeAst({ type: "root", children: outChildren } as any);
}

function isExplicitEmptyParagraph(node: PMNode): boolean {
	return Boolean(node.attrs?.data?.[EMPTY_MARKDOWN_PARAGRAPH_DATA_KEY]);
}

function emptyParagraphPlaceholderChildren(): any[] {
	return [
		{ type: "html", value: "<span>" },
		{ type: "html", value: "</span>" },
	];
}

function anchorHardBreakOnlyParagraph(children: any[]): any[] {
	return children.length > 0 && children.every(isHtmlHardBreak)
		? [...emptyParagraphPlaceholderChildren(), ...children]
		: children;
}

function pmBlockToAst(
	node: PMNode,
	options: { preserveEmptyParagraph?: boolean } = {},
): any {
	switch (node.type) {
		case "paragraph":
			const paraData = extractNodeData(node.attrs);
			const inline = anchorHardBreakOnlyParagraph(
				pmInlineToMd(node.content || []),
			);
			return {
				type: "paragraph",
				data: paraData.data,
				children:
					inline.length || !options.preserveEmptyParagraph
						? inline
						: emptyParagraphPlaceholderChildren(),
			};
		case "imageBlock": {
			const blockData = extractNodeData(node.attrs);
			const image: any = {
				type: "image",
				url: node.attrs?.src ?? null,
				title: node.attrs?.title ?? null,
				alt: node.attrs?.alt ?? null,
			};
			if (node.attrs?.imageData != null) image.data = node.attrs.imageData;
			return {
				type: "paragraph",
				data: blockData.data,
				children: [image],
			};
		}
		case "heading":
			const headingData = extractNodeData(node.attrs);
			return {
				type: "heading",
				depth: node.attrs?.level || 1,
				data: headingData.data,
				children: pmInlineToMd(node.content || []),
			};
		case "bulletList":
		case "orderedList": {
			const listData = extractNodeData(node.attrs);
			const spread =
				listData.spread === undefined ? undefined : listData.spread;
			const ordered = node.type === "orderedList";
			const base: any = {
				type: "list",
				ordered,
				data: listData.data,
				children: (node.content || []).map((child) => pmBlockToAst(child)),
			};
			if (spread !== undefined) base.spread = spread;
			if (ordered && node.attrs?.start != null && node.attrs.start !== 1)
				base.start = node.attrs.start;
			return base as any;
		}
		case "listItem": {
			const listItemData = extractNodeData(node.attrs);
			const content = node.content || [];
			const first = content[0];
			const omitLeadingScaffold =
				content.length > 1 &&
				first?.type === "paragraph" &&
				first.attrs?.data?.[LIST_LEADING_PARAGRAPH_DATA_KEY] &&
				!first.content?.length;
			const out: any = {
				type: "listItem",
				// An item whose own line is empty but that still has children
				// keeps that empty line: without it the marker and the nested
				// list collapse into one another.
				children: (omitLeadingScaffold ? content.slice(1) : content).map(
					(child, index, items) =>
						pmBlockToAst(child, {
							preserveEmptyParagraph:
								index === 0 &&
								items.length > 1 &&
								child.type === "paragraph" &&
								!pmInlineToMd(child.content || []).length,
						}),
				),
			};
			if (listItemData.data) out.data = listItemData.data;
			if (listItemData.spread !== undefined) out.spread = listItemData.spread;
			if (
				node.attrs &&
				(node.attrs.checked === true || node.attrs.checked === false)
			)
				out.checked = node.attrs.checked;
			return out;
		}

		case "blockquote":
			const blockquoteData = extractNodeData(node.attrs);
			return {
				type: "blockquote",
				data: blockquoteData.data,
				children: (node.content || []).map((child) => pmBlockToAst(child)),
			};
		case "codeBlock": {
			const text = collectText(node.content || []);
			const lang = node.attrs?.language;
			const out: any = { type: "code", value: text };
			const codeData = extractNodeData(node.attrs);
			if (codeData.data) out.data = codeData.data;
			if (lang != null) out.lang = lang;
			const meta = node.attrs?.data?.[CODE_META_DATA_KEY];
			if (typeof meta === "string") out.meta = meta;
			return out;
		}
		case "horizontalRule": {
			const hrData = extractNodeData(node.attrs);
			return { type: "thematicBreak", data: hrData.data };
		}
		case "table": {
			const align = node.attrs?.align ?? [];
			const tableData = extractNodeData(node.attrs);
			return {
				type: "table",
				align,
				data: tableData.data,
				children: (node.content || []).map((child) => pmBlockToAst(child)),
			} as any;
		}
		case "tableRow": {
			const rowData = extractNodeData(node.attrs);
			return {
				type: "tableRow",
				data: rowData.data,
				children: (node.content || []).map((child) => pmBlockToAst(child)),
			};
		}
		case "tableCell": {
			const cellData = extractNodeData(node.attrs);
			return {
				type: "tableCell",
				data: cellData.data,
				children: pmInlineToMd(node.content || [], { htmlBreaks: true }),
			};
		}
		case "markdownFrontmatter": {
			const frontmatterData = extractNodeData(node.attrs);
			return {
				type: "yaml",
				value: String(node.attrs?.value ?? ""),
				data: frontmatterData.data,
			};
		}
		case "markdownUnsupported": {
			const unsupportedData = extractNodeData(node.attrs);
			const kind = node.attrs?.kind ?? "html";
			const value = node.attrs?.value ?? "";
			if (kind === "yaml") {
				return {
					type: "yaml",
					value: value as string,
					data: unsupportedData.data,
				};
			}
			return {
				type: "html",
				value: value as string,
				data: unsupportedData.data,
			};
		}
		default:
			if (
				node.content &&
				node.content.length &&
				isInline(node.content[0] as any)
			) {
				const inlineData = extractNodeData(node.attrs);
				return {
					type: "paragraph",
					data: inlineData.data,
					children: pmInlineToMd(node.content),
				};
			}
			const fallbackData = extractNodeData(node.attrs);
			return { type: "paragraph", data: fallbackData.data, children: [] };
	}
}

function pmInlineToMd(
	nodes: PMNode[],
	options: { htmlBreaks?: boolean } = {},
): any[] {
	const out: any[] = [];
	for (let index = 0; index < nodes.length; index += 1) {
		const n = nodes[index];
		if (n.type === "text") {
			out.push(applyMarksToText(n.text || "", n.marks || []));
		} else if (n.type === "hardBreak") {
			if (n.attrs?.soft === true && !options.htmlBreaks) {
				out.push({ type: "text", value: "\n" });
				continue;
			}
			const br: any =
				options.htmlBreaks || isTrailingHardBreak(nodes, index)
					? { type: "html", value: "<br>" }
					: { type: "break" };
			if (n.attrs?.data != null) br.data = n.attrs.data;
			out.push(br as any);
		} else if (n.type === "markdownInlineHtml") {
			const htmlValue = (n.attrs?.value ?? "") as string;
			const htmlData = n.attrs?.data ?? null;
			const htmlNode: any = { type: "html", value: htmlValue };
			if (htmlData != null) htmlNode.data = htmlData;
			out.push(htmlNode);
		} else if (n.type === "image") {
			const src = n.attrs?.src ?? null;
			const title = n.attrs?.title ?? null;
			const alt = n.attrs?.alt ?? null;
			const im: any = { type: "image", url: src, title, alt };
			if (n.attrs?.data != null) im.data = n.attrs.data;
			out.push(applyMarksToInline(im, n.marks || []));
		}
	}
	return mergeAdjacentInlineMarks(out);
}

// Splitting a marked run into separately delimited Markdown can create literal
// delimiters (notably four adjacent tildes). Rejoin shared wrappers first.
function mergeAdjacentInlineMarks(nodes: any[]): any[] {
	const out: any[] = [];
	for (const node of nodes) {
		const previous = out[out.length - 1];
		if (
			previous?.type === node.type &&
			["strong", "emphasis", "delete", "link"].includes(node.type) &&
			JSON.stringify({ ...previous, children: undefined }) ===
				JSON.stringify({ ...node, children: undefined })
		) {
			previous.children.push(...node.children);
		} else {
			out.push(node);
		}
	}
	for (const node of out) {
		if (Array.isArray(node.children)) {
			node.children = mergeAdjacentInlineMarks(node.children);
		}
	}
	return out;
}

function isTrailingHardBreak(nodes: PMNode[], index: number): boolean {
	for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
		const next = nodes[nextIndex];
		if (next?.type !== "hardBreak" || next.attrs?.soft === true) return false;
	}
	return true;
}

function isHtmlHardBreak(node: any): boolean {
	return (
		node?.type === "html" &&
		typeof node.value === "string" &&
		/^<br\s*\/?>$/i.test(node.value)
	);
}

function applyMarksToText(value: string, marks: PMMark[]): any {
	const node = marks.some((mark) => mark.type === "code")
		? { type: "inlineCode", value }
		: { type: "text", value };
	return applyMarksToInline(node, marks);
}

function applyMarksToInline(inline: any, marks: PMMark[]): any {
	let node = inline;
	const order: PMMark["type"][] = ["bold", "italic", "strike", "link"];
	for (const type of order) {
		const mark = marks.find((candidate) => candidate.type === type);
		if (!mark) continue;
		if (type === "link") {
			node = {
				type: "link",
				url: mark.attrs?.href ?? null,
				title: mark.attrs?.title ?? null,
				children: [node],
				...(mark.attrs?.data != null ? { data: mark.attrs.data } : {}),
			};
		} else {
			const astType =
				type === "bold" ? "strong" : type === "italic" ? "emphasis" : "delete";
			node = { type: astType, children: [node] };
		}
	}
	return node;
}

function isInline(n: PMNode) {
	return (
		!n.content &&
		(n.text != null ||
			n.type === "hardBreak" ||
			n.type === "markdownInlineHtml")
	);
}

function collectText(nodes: PMNode[]): string {
	return (nodes || [])
		.map((n) => (n.type === "text" ? n.text || "" : ""))
		.join("");
}
