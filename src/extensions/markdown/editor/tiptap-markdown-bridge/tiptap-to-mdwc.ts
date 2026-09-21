import { normalizeAst } from "../markdown";
import {
	CODE_META_DATA_KEY,
	LIST_LEADING_PARAGRAPH_DATA_KEY,
	EMPTY_MARKDOWN_PARAGRAPH_DATA_KEY,
	EMPTY_MARKDOWN_SCAFFOLD_DATA_KEY,
	HTML_BREAK_DATA_KEY,
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
				// Only levels 1 and 2 have a setext form that can hold a line
				// break; an ATX heading would fold the break into a space.
				children: pmInlineToMd(node.content || [], {
					htmlBreaks: (node.attrs?.level || 1) > 2,
				}),
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

		case "footnoteDef": {
			const footnoteData = extractNodeData(node.attrs);
			const label = String(node.attrs?.label ?? node.attrs?.identifier ?? "");
			return {
				type: "footnoteDefinition",
				identifier: String(node.attrs?.identifier ?? label),
				label,
				data: footnoteData.data,
				children: (node.content || []).map((child) => pmBlockToAst(child)),
			};
		}
		case "blockquote":
			const blockquoteData = extractNodeData(node.attrs);
			return {
				type: "blockquote",
				data: blockquoteData.data,
				// An empty line inside a quote survives the same way it does at
				// the top level; a bare ">" would be dropped on the next load.
				children: (node.content || []).map((child, _index, items) =>
					pmBlockToAst(child, {
						preserveEmptyParagraph:
							items.length > 1 &&
							child.type === "paragraph" &&
							!pmInlineToMd(child.content || []).length,
					}),
				),
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
	const items: InlineItem[] = [];
	for (let index = 0; index < nodes.length; index += 1) {
		const n = nodes[index];
		const marks = n.marks || [];
		if (n.type === "text") {
			const value = n.text || "";
			const leaf = marks.some((mark) => mark.type === "code")
				? { type: "inlineCode", value }
				: { type: "text", value };
			items.push({ leaf, marks, isBreak: false });
		} else if (n.type === "hardBreak") {
			if (n.attrs?.soft === true && !options.htmlBreaks) {
				items.push({
					leaf: { type: "text", value: "\n" },
					marks,
					isBreak: true,
				});
				continue;
			}
			const { [HTML_BREAK_DATA_KEY]: spelling, ...data } = n.attrs?.data ?? {};
			// A break written as HTML keeps its spelling (`<br/>`, `<br />`).
			const br: any =
				typeof spelling === "string"
					? { type: "html", value: spelling }
					: options.htmlBreaks || endsLine(nodes, index)
						? { type: "html", value: "<br>" }
						: { type: "break" };
			if (Object.keys(data).length > 0) br.data = data;
			items.push({ leaf: br, marks, isBreak: true });
		} else if (n.type === "footnoteRef") {
			const label = String(n.attrs?.label ?? n.attrs?.identifier ?? "");
			const reference: any = {
				type: "footnoteReference",
				identifier: String(n.attrs?.identifier ?? label),
				label,
			};
			if (n.attrs?.data != null) reference.data = n.attrs.data;
			items.push({ leaf: reference, marks, isBreak: false });
		} else if (n.type === "markdownInlineHtml") {
			const htmlValue = (n.attrs?.value ?? "") as string;
			const htmlData = n.attrs?.data ?? null;
			const htmlNode: any = { type: "html", value: htmlValue };
			if (htmlData != null) htmlNode.data = htmlData;
			items.push({ leaf: htmlNode, marks, isBreak: false });
		} else if (n.type === "image") {
			const src = n.attrs?.src ?? null;
			const title = n.attrs?.title ?? null;
			const alt = n.attrs?.alt ?? null;
			const im: any = { type: "image", url: src, title, alt };
			if (n.attrs?.data != null) im.data = n.attrs.data;
			items.push({ leaf: im, marks, isBreak: false });
		}
	}
	return mergeAdjacentInlineMarks(
		hoistEdgeWhitespace(buildMarkedInline(inheritBreakMarks(items))),
	);
}

type InlineItem = {
	readonly leaf: any;
	readonly marks: readonly PMMark[];
	readonly isBreak: boolean;
};

/**
 * A line break typed inside a bold or linked run carries no marks of its
 * own. Treat it as part of the run it sits in; otherwise the run closes and
 * reopens around it, and one link becomes two.
 */
function inheritBreakMarks(items: InlineItem[]): InlineItem[] {
	return items.map((item, index) => {
		if (!item.isBreak || item.marks.length > 0) return item;
		const before = items[index - 1]?.marks ?? [];
		const after = items[index + 1]?.marks ?? [];
		const shared = before.filter(
			(mark) =>
				mark.type !== "code" &&
				after.some((candidate) => sameMark(candidate, mark)),
		);
		return shared.length > 0 ? { ...item, marks: shared } : item;
	});
}

// Marks that open on the same run and end on the same run keep the nesting
// the serializer always used: a link outermost, bold innermost.
const MARK_NESTING_RANK: Record<PMMark["type"], number> = {
	link: 0,
	strike: 1,
	italic: 2,
	bold: 3,
	code: 4,
};

/**
 * Builds the inline tree from marked runs the way prosemirror-markdown
 * does: an open mark stays open for as long as the following runs carry it,
 * and of the marks that open together the one reaching furthest goes
 * outermost. Wrapping every run on its own in a fixed order closed and
 * reopened delimiters mid-run (`**a *****b*****&#x20;c**`), which reloads as
 * literal asterisks.
 */
function buildMarkedInline(items: InlineItem[]): any[] {
	const root: any[] = [];
	const open: { mark: PMMark; node: any }[] = [];
	const children = (): any[] =>
		open.length > 0 ? open[open.length - 1]!.node.children : root;
	const reach = (mark: PMMark, from: number): number => {
		let to = from;
		while (
			to < items.length &&
			items[to]!.marks.some((candidate) => sameMark(candidate, mark))
		)
			to += 1;
		return to - from;
	};
	for (let index = 0; index < items.length; index += 1) {
		const marks = items[index]!.marks.filter((mark) => mark.type !== "code");
		let keep = 0;
		while (
			keep < open.length &&
			marks.some((mark) => sameMark(mark, open[keep]!.mark))
		)
			keep += 1;
		open.length = keep;
		const opening = marks
			.filter((mark) => !open.some((entry) => sameMark(entry.mark, mark)))
			.sort(
				(a, b) =>
					reach(b, index) - reach(a, index) ||
					MARK_NESTING_RANK[a.type] - MARK_NESTING_RANK[b.type],
			);
		for (const mark of opening) {
			const node = markToMdast(mark);
			children().push(node);
			open.push({ mark, node });
		}
		children().push(items[index]!.leaf);
	}
	return root;
}

function sameMark(a: PMMark, b: PMMark): boolean {
	if (a.type !== b.type) return false;
	if (a.type !== "link") return true;
	return (
		(a.attrs?.href ?? null) === (b.attrs?.href ?? null) &&
		(a.attrs?.title ?? null) === (b.attrs?.title ?? null) &&
		JSON.stringify(a.attrs?.data ?? null) ===
			JSON.stringify(b.attrs?.data ?? null)
	);
}

function markToMdast(mark: PMMark): any {
	if (mark.type === "link") {
		return {
			type: "link",
			url: mark.attrs?.href ?? null,
			title: mark.attrs?.title ?? null,
			children: [],
			...(mark.attrs?.data != null ? { data: mark.attrs.data } : {}),
		};
	}
	const type =
		mark.type === "bold"
			? "strong"
			: mark.type === "italic"
				? "emphasis"
				: "delete";
	return { type, children: [] };
}

/**
 * Emphasis cannot open before or close after whitespace, so a bold run that
 * ends in a space was written with character references
 * (`**hello&#x20;**&#x77;orld`). The space reads the same outside the
 * delimiters; move it there.
 */
function hoistEdgeWhitespace(nodes: any[]): any[] {
	const out: any[] = [];
	for (const node of nodes) {
		if (!Array.isArray(node.children)) {
			out.push(node);
			continue;
		}
		node.children = hoistEdgeWhitespace(node.children);
		if (!["strong", "emphasis", "delete"].includes(node.type)) {
			out.push(node);
			continue;
		}
		const leading = takeEdgeWhitespace(node.children, "start");
		const trailing = takeEdgeWhitespace(node.children, "end");
		if (leading) out.push({ type: "text", value: leading });
		if (node.children.length > 0) out.push(node);
		if (trailing) out.push({ type: "text", value: trailing });
	}
	return out;
}

function takeEdgeWhitespace(children: any[], edge: "start" | "end"): string {
	const index = edge === "start" ? 0 : children.length - 1;
	const child = children[index];
	if (child?.type !== "text" || typeof child.value !== "string") return "";
	const match = (edge === "start" ? /^\s+/ : /\s+$/).exec(child.value);
	if (!match) return "";
	child.value =
		edge === "start"
			? child.value.slice(match[0].length)
			: child.value.slice(0, child.value.length - match[0].length);
	if (!child.value) children.splice(index, 1);
	return match[0];
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

/**
 * A backslash break is written as `\` plus a newline, so it needs text on the
 * next line of the same paragraph. When the breaks run to the end of the
 * block, or into a source newline, `\` would leave a stray backslash and a
 * blank line that splits the paragraph; `<br>` says the same thing in place.
 */
function endsLine(nodes: PMNode[], index: number): boolean {
	for (let nextIndex = index + 1; nextIndex < nodes.length; nextIndex += 1) {
		const next = nodes[nextIndex];
		if (next?.type !== "hardBreak") return false;
		if (next.attrs?.soft === true) return true;
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

function isInline(n: PMNode) {
	return (
		!n.content &&
		(n.text != null ||
			n.type === "hardBreak" ||
			n.type === "footnoteRef" ||
			n.type === "markdownInlineHtml")
	);
}

function collectText(nodes: PMNode[]): string {
	return (nodes || [])
		.map((n) => (n.type === "text" ? n.text || "" : ""))
		.join("");
}
