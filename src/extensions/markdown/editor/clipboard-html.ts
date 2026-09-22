import { serializeAst } from "./markdown";

/**
 * Converts rich clipboard HTML (Google Docs, Word, GitHub, Slack, web pages)
 * into Markdown the document can hold, or returns null when the HTML should
 * not be used.
 *
 * Other apps put their formatting only in text/html; their text/plain is a
 * lossy rendering, and reading it as Markdown both drops the formatting and
 * misreads prose ("1986. A great year." is not a list). The walker keeps what
 * Markdown can express and drops the rest, so the pasted result is exactly
 * what the file saves. Our own copies carry OWN_CLIPBOARD_ATTRIBUTE; their
 * text/plain is already Markdown and stays the source.
 */
export function markdownFromClipboardHtml(html: string): string | null {
	if (!html.trim() || html.includes(OWN_CLIPBOARD_ATTRIBUTE)) return null;
	if (typeof DOMParser === "undefined") return null;
	const document = new DOMParser().parseFromString(html, "text/html");
	const blocks = flowContent(Array.from(document.body.childNodes), NO_MARKS);
	if (blocks.length === 0) return null;
	const markdown = serializeAst({ type: "root", children: blocks });
	return markdown.trim() ? markdown : null;
}

/** Marks the HTML of a copy from this editor (see create-editor.ts). */
export const OWN_CLIPBOARD_ATTRIBUTE = "data-atelier-markdown";

/**
 * How far a copy from this editor was open at each edge, counted from the
 * top of the copied content, or null for any other clipboard. ProseMirror
 * records it in `data-pm-slice` after lifting single-child wrappers into the
 * context list, while our text/plain Markdown keeps those wrappers, so they
 * count toward the depth.
 */
export function ownClipboardSliceDepth(
	html: string,
): { readonly openStart: number; readonly openEnd: number } | null {
	if (
		!html.includes(OWN_CLIPBOARD_ATTRIBUTE) ||
		typeof DOMParser === "undefined"
	)
		return null;
	const value = new DOMParser()
		.parseFromString(html, "text/html")
		.querySelector("[data-pm-slice]")
		?.getAttribute("data-pm-slice");
	const match = /^(\d+) (\d+)(?: -\d+)? (.*)$/s.exec(value ?? "");
	if (!match) return null;
	let wrappers = 0;
	try {
		const context = JSON.parse(match[3]!);
		if (Array.isArray(context)) wrappers = Math.floor(context.length / 2);
	} catch {
		return null;
	}
	return {
		openStart: Number(match[1]) + wrappers,
		openEnd: Number(match[2]) + wrappers,
	};
}

type Marks = {
	readonly strong: boolean;
	readonly emphasis: boolean;
	readonly delete: boolean;
	readonly link: { readonly url: string; readonly title: string | null } | null;
};

type Segment =
	| { readonly kind: "text"; readonly value: string; readonly marks: Marks }
	| { readonly kind: "code"; readonly value: string; readonly marks: Marks }
	| { readonly kind: "break"; readonly marks: Marks }
	| {
			readonly kind: "image";
			readonly url: string;
			readonly alt: string;
			readonly title: string | null;
			readonly marks: Marks;
	  };

const NO_MARKS: Marks = {
	strong: false,
	emphasis: false,
	delete: false,
	link: null,
};

// Content that never belongs in a document, including its text.
const DROPPED = new Set([
	"script",
	"style",
	"template",
	"noscript",
	"iframe",
	"object",
	"embed",
	"head",
	"title",
	"meta",
	"link",
	"svg",
	"math",
	"canvas",
	"button",
	"select",
	"textarea",
	"video",
	"audio",
	"o:p",
]);

const BLOCKS = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"body",
	"center",
	"dd",
	"details",
	"dialog",
	"div",
	"dl",
	"dt",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"html",
	"li",
	"main",
	"nav",
	"ol",
	"p",
	"pre",
	"section",
	"summary",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
	"ul",
]);

function tagName(node: Node): string {
	return node.nodeType === 1 ? (node as Element).tagName.toLowerCase() : "";
}

function isBlock(node: Node): boolean {
	const tag = tagName(node);
	if (BLOCKS.has(tag)) return true;
	// Google Docs wraps the whole fragment in a <b> and Slack puts paragraphs
	// in spans; an inline element that holds blocks acts as a container.
	return (
		node.nodeType === 1 &&
		!DROPPED.has(tag) &&
		Array.from(node.childNodes).some(isBlock)
	);
}

/** Block content from a mix of block and inline nodes. */
function flowContent(nodes: readonly Node[], marks: Marks): any[] {
	const blocks: any[] = [];
	let run: Segment[] = [];
	const flush = () => {
		const paragraph = paragraphFromSegments(run);
		if (paragraph) blocks.push(paragraph);
		run = [];
	};
	for (let index = 0; index < nodes.length; index += 1) {
		const node = nodes[index]!;
		if (isWordListParagraph(node)) {
			flush();
			const items: Element[] = [];
			while (index < nodes.length) {
				const candidate = nodes[index]!;
				if (isWordListParagraph(candidate)) items.push(candidate as Element);
				else if (!isBlankText(candidate)) break;
				index += 1;
			}
			index -= 1;
			blocks.push(...wordLists(items, marks));
			continue;
		}
		if (!isBlock(node)) {
			run.push(...inlineSegments(node, marks));
			continue;
		}
		flush();
		blocks.push(...blockContent(node as Element, marks));
	}
	flush();
	return blocks;
}

function blockContent(element: Element, inherited: Marks): any[] {
	const tag = tagName(element);
	const marks = marksOf(element, inherited);
	const heading = /^h([1-6])$/.exec(tag);
	if (heading) {
		const children = inlineChildren(
			Array.from(element.childNodes).flatMap((child) =>
				inlineSegments(child, marks),
			),
		);
		return children.length
			? [{ type: "heading", depth: Number(heading[1]), children }]
			: [];
	}
	switch (tag) {
		case "hr":
			return [{ type: "thematicBreak" }];
		case "pre":
			return [codeBlock(element)];
		case "blockquote": {
			const children = flowContent(Array.from(element.childNodes), marks);
			return children.length ? [{ type: "blockquote", children }] : [];
		}
		case "ul":
		case "ol":
			return [list(element, marks)].filter(Boolean);
		case "li":
			// A stray item outside its list, e.g. a fragment copied from one.
			return [
				{
					type: "list",
					ordered: false,
					spread: false,
					children: [listItem(element, marks)],
				},
			];
		case "table":
			return [table(element)].filter(Boolean);
		default:
			return flowContent(Array.from(element.childNodes), marks);
	}
}

function list(element: Element, marks: Marks): any | null {
	const ordered = tagName(element) === "ol";
	const items: any[] = [];
	for (const child of Array.from(element.childNodes)) {
		const tag = tagName(child);
		if (tag === "li") {
			items.push(listItem(child as Element, marks));
			continue;
		}
		if (tag === "ul" || tag === "ol") {
			// Google Docs nests a sublist as a sibling of the item it belongs to.
			const nested = list(child as Element, marks);
			if (!nested) continue;
			const previous = items.at(-1);
			if (previous) previous.children.push(nested);
			else items.push(...nested.children);
			continue;
		}
		if (isBlankText(child)) continue;
		items.push({
			type: "listItem",
			spread: false,
			children: flowContent([child], marks),
		});
	}
	if (items.length === 0) return null;
	const start = Number.parseInt(element.getAttribute("start") ?? "", 10);
	return {
		type: "list",
		ordered,
		...(ordered && Number.isFinite(start) && start !== 1 ? { start } : {}),
		spread: false,
		children: items,
	};
}

function listItem(element: Element, marks: Marks): any {
	// Only this item's own checkbox; nested items carry theirs.
	const checkbox =
		Array.from(element.querySelectorAll('input[type="checkbox" i]')).find(
			(input) => input.closest("li") === element,
		) ?? null;
	const ariaChecked = element.getAttribute("aria-checked");
	const checked =
		checkbox !== null
			? checkbox.hasAttribute("checked")
			: ariaChecked === "true" || ariaChecked === "false"
				? ariaChecked === "true"
				: undefined;
	const children = flowContent(Array.from(element.childNodes), marks);
	return {
		type: "listItem",
		spread: false,
		...(checked === undefined ? {} : { checked }),
		children: children.length
			? children
			: [{ type: "paragraph", children: [] }],
	};
}

function codeBlock(element: Element): any {
	const lang = codeLanguage(element);
	const value = preformattedText(element).replace(/\n$/, "");
	return { type: "code", lang, meta: null, value };
}

function codeLanguage(pre: Element): string | null {
	const candidates = [
		pre.querySelector("code"),
		pre,
		pre.parentElement,
	] as (Element | null)[];
	for (const candidate of candidates) {
		const match = /(?:^|\s)(?:language|lang|highlight-source)-([\w+#.-]+)/.exec(
			candidate?.getAttribute("class") ?? "",
		);
		if (match) return match[1]!.toLowerCase();
		const lang = candidate?.getAttribute("lang");
		if (candidate !== pre.parentElement && lang && /^[\w+#.-]+$/.test(lang))
			return lang.toLowerCase();
	}
	return null;
}

function preformattedText(node: Node): string {
	if (node.nodeType === 3)
		return (node.nodeValue ?? "").replace(/\r\n?/g, "\n");
	const tag = tagName(node);
	if (tag === "br") return "\n";
	if (node.nodeType !== 1 || DROPPED.has(tag)) return "";
	const text = Array.from(node.childNodes).map(preformattedText).join("");
	// Some highlighters put each line in its own block element.
	return (tag === "div" || tag === "p") && !text.endsWith("\n")
		? `${text}\n`
		: text;
}

function table(element: Element): any | null {
	const rows = Array.from(element.querySelectorAll("tr")).filter(
		(row) => row.closest("table") === element,
	);
	const cells = rows.map((row) =>
		Array.from(row.children).filter((cell) =>
			["td", "th"].includes(tagName(cell)),
		),
	);
	const width = Math.max(0, ...cells.map((row) => row.length));
	if (width === 0) return null;
	const align = (cells[0] ?? []).map((cell) => {
		const value = (
			cell.getAttribute("align") ??
			/text-align:\s*(left|center|right)/i.exec(
				cell.getAttribute("style") ?? "",
			)?.[1] ??
			""
		).toLowerCase();
		return value === "left" || value === "center" || value === "right"
			? value
			: null;
	});
	return {
		type: "table",
		align: Array.from({ length: width }, (_, index) => align[index] ?? null),
		children: cells.map((row) => ({
			type: "tableRow",
			children: Array.from({ length: width }, (_, index) => ({
				type: "tableCell",
				children: row[index] ? cellContent(row[index]) : [],
			})),
		})),
	};
}

/** Cells hold one line of inline content; blocks inside become line breaks. */
function cellContent(cell: Element): any[] {
	const lines = flowContent(Array.from(cell.childNodes), NO_MARKS).flatMap(
		(block) => blockInline(block),
	);
	const out: any[] = [];
	for (const line of lines) {
		if (out.length) out.push({ type: "break" });
		out.push(...line);
	}
	return out;
}

function blockInline(block: any): any[][] {
	if (block.type === "paragraph" || block.type === "heading")
		return [block.children];
	if (block.type === "code")
		return block.value
			.split("\n")
			.map((line: string) => [{ type: "inlineCode", value: line }]);
	if (Array.isArray(block.children))
		return block.children.flatMap((child: any) => blockInline(child));
	return [];
}

function marksOf(element: Element, inherited: Marks): Marks {
	const tag = tagName(element);
	const style = (element.getAttribute("style") ?? "").toLowerCase();
	const weight = /(?:^|;)\s*font-weight\s*:\s*([^;]+)/.exec(style)?.[1]?.trim();
	const fontStyle = /(?:^|;)\s*font-style\s*:\s*([^;]+)/
		.exec(style)?.[1]
		?.trim();
	const decoration = /(?:^|;)\s*text-decoration(?:-line)?\s*:\s*([^;]+)/.exec(
		style,
	)?.[1];
	// An explicit weight wins over the tag: Google Docs wraps every fragment
	// in <b style="font-weight:normal">.
	const strong = weight
		? weight === "bold" || weight === "bolder" || Number(weight) >= 600
		: tag === "b" || tag === "strong" || inherited.strong;
	const emphasis = fontStyle
		? fontStyle === "italic" || fontStyle === "oblique"
		: tag === "i" || tag === "em" || tag === "cite" || inherited.emphasis;
	const strike =
		tag === "s" ||
		tag === "del" ||
		tag === "strike" ||
		Boolean(decoration?.includes("line-through")) ||
		inherited.delete;
	let link = inherited.link;
	if (tag === "a") {
		const url = safeUrl(element.getAttribute("href"), "link");
		link = url ? { url, title: element.getAttribute("title") || null } : null;
	}
	return { strong, emphasis, delete: strike, link };
}

function inlineSegments(node: Node, marks: Marks): Segment[] {
	if (node.nodeType === 3) {
		const value = (node.nodeValue ?? "").replace(/[ \t\n\r\f]+/g, " ");
		return value ? [{ kind: "text", value, marks }] : [];
	}
	if (node.nodeType !== 1) return [];
	const element = node as Element;
	const tag = tagName(element);
	if (DROPPED.has(tag) || isWordListMarker(element)) return [];
	if (tag === "br") return [{ kind: "break", marks }];
	if (tag === "img") {
		const url = safeUrl(element.getAttribute("src"), "image");
		return url
			? [
					{
						kind: "image",
						url,
						alt: element.getAttribute("alt") ?? "",
						title: element.getAttribute("title") || null,
						marks,
					},
				]
			: [];
	}
	if (tag === "input") return [];
	if (tag === "code" || tag === "kbd" || tag === "samp" || tag === "tt") {
		const value = (element.textContent ?? "").replace(/[\r\n]+/g, " ");
		return value
			? [{ kind: "code", value, marks: marksOf(element, marks) }]
			: [];
	}
	const childMarks = marksOf(element, marks);
	return Array.from(element.childNodes).flatMap((child) =>
		inlineSegments(child, childMarks),
	);
}

function paragraphFromSegments(segments: readonly Segment[]): any | null {
	const children = inlineChildren(segments);
	return children.length ? { type: "paragraph", children } : null;
}

/**
 * Applies HTML whitespace rules to a line of segments and nests them as
 * mdast phrasing content, links outermost.
 */
function inlineChildren(segments: readonly Segment[]): any[] {
	const normalized: Segment[] = [];
	let lastWasSpace = true;
	for (const segment of segments) {
		if (segment.kind === "break") {
			const previous = normalized.at(-1);
			if (previous?.kind === "text")
				normalized[normalized.length - 1] = {
					...previous,
					value: previous.value.replace(/ +$/, ""),
				};
			normalized.push(segment);
			lastWasSpace = true;
			continue;
		}
		if (segment.kind !== "text") {
			normalized.push(segment);
			lastWasSpace = false;
			continue;
		}
		let value = segment.value.replace(/ /g, " ");
		if (lastWasSpace) value = value.replace(/^ +/, "");
		if (!value) continue;
		lastWasSpace = value.endsWith(" ");
		normalized.push(...splitBoundarySpaces({ ...segment, value }));
	}
	while (normalized.length) {
		const last = normalized.at(-1)!;
		if (last.kind === "break") normalized.pop();
		else if (last.kind === "text" && !last.value.trim()) normalized.pop();
		else if (last.kind === "text" && last.value.endsWith(" ")) {
			normalized[normalized.length - 1] = {
				...last,
				value: last.value.replace(/ +$/, ""),
			};
			break;
		} else break;
	}
	while (normalized[0]?.kind === "break") normalized.shift();
	return nest(normalized, ["link", "strong", "emphasis", "delete"]);
}

/**
 * Markdown emphasis cannot start or end with a space ("**bold **" is not
 * bold), so boundary spaces move outside the formatting.
 */
function splitBoundarySpaces(
	segment: Extract<Segment, { kind: "text" }>,
): Segment[] {
	const { marks } = segment;
	if (!marks.strong && !marks.emphasis && !marks.delete) return [segment];
	const match = /^( *)(.*?)( *)$/s.exec(segment.value)!;
	const plain = { ...marks, strong: false, emphasis: false, delete: false };
	return [
		...(match[1] ? [{ kind: "text" as const, value: " ", marks: plain }] : []),
		...(match[2] ? [{ kind: "text" as const, value: match[2], marks }] : []),
		...(match[3] ? [{ kind: "text" as const, value: " ", marks: plain }] : []),
	];
}

type MarkKey = "link" | "strong" | "emphasis" | "delete";

function nest(segments: readonly Segment[], keys: readonly MarkKey[]): any[] {
	const [key, ...rest] = keys;
	if (!key) return segments.map(leaf);
	const out: any[] = [];
	let index = 0;
	while (index < segments.length) {
		const value = segments[index]!.marks[key];
		let end = index + 1;
		while (end < segments.length && sameMark(segments[end]!.marks[key], value))
			end += 1;
		const children = nest(segments.slice(index, end), rest);
		if (!value) out.push(...children);
		else if (key === "link") {
			const link = value as NonNullable<Marks["link"]>;
			out.push({ type: "link", url: link.url, title: link.title, children });
		} else out.push({ type: key, children });
		index = end;
	}
	return out;
}

function sameMark(a: Marks[MarkKey], b: Marks[MarkKey]): boolean {
	if (typeof a === "object" && a && typeof b === "object" && b)
		return a.url === b.url && a.title === b.title;
	return a === b;
}

function leaf(segment: Segment): any {
	switch (segment.kind) {
		case "text":
			return { type: "text", value: segment.value };
		case "code":
			return { type: "inlineCode", value: segment.value };
		case "break":
			return { type: "break" };
		case "image":
			return {
				type: "image",
				url: segment.url,
				alt: segment.alt,
				title: segment.title,
			};
	}
}

/**
 * Links keep web, mail and relative targets; images keep web and relative
 * sources. Script and data URLs never enter the document.
 */
function safeUrl(raw: string | null, kind: "link" | "image"): string | null {
	const url = raw?.trim();
	if (!url) return null;
	// A same-page anchor from a web page points nowhere in this document.
	if (kind === "link" && url.startsWith("#")) return null;
	const scheme = /^([a-z][a-z\d+.-]*):/i.exec(url)?.[1]?.toLowerCase();
	if (!scheme) return /^[\w./?#%~-]/.test(url) ? url : null;
	if (scheme === "http" || scheme === "https") return url;
	if (kind === "link" && scheme === "mailto") return url;
	return null;
}

function isBlankText(node: Node): boolean {
	return (
		node.nodeType === 8 ||
		(node.nodeType === 3 && !(node.nodeValue ?? "").trim())
	);
}

// Word marks list paragraphs with `mso-list:l<list> level<n>` and prefixes
// them with a literal bullet or number in a `mso-list:Ignore` span.
function isWordListParagraph(node: Node): boolean {
	return (
		node.nodeType === 1 &&
		/mso-list:\s*l\d+\s+level\d+/i.test(
			(node as Element).getAttribute("style") ?? "",
		)
	);
}

function isWordListMarker(element: Element): boolean {
	return /mso-list:\s*ignore/i.test(element.getAttribute("style") ?? "");
}

function wordLists(paragraphs: readonly Element[], marks: Marks): any[] {
	const lists: any[] = [];
	// The open list at each level; a new top-level list starts when Word's
	// list id or the bullet/number kind changes.
	const stack: ({ list: any; id: string } | undefined)[] = [];
	for (const paragraph of paragraphs) {
		const style = paragraph.getAttribute("style") ?? "";
		const [, id = "", levelText = "1"] =
			/mso-list:\s*(l\d+)\s+level(\d+)/i.exec(style) ?? [];
		const level = Math.max(1, Number(levelText));
		const marker = Array.from(paragraph.querySelectorAll("span"))
			.find(isWordListMarker)
			?.textContent?.trim();
		const ordered = /^(?:\d+|[a-z]|[ivxlcdm]+)[.)]/i.test(marker ?? "");
		const item = {
			type: "listItem",
			spread: false,
			children: flowContent(
				Array.from(paragraph.childNodes),
				marksOf(paragraph, marks),
			),
		};
		if (item.children.length === 0)
			item.children.push({ type: "paragraph", children: [] });
		stack.length = Math.min(stack.length, level);
		const current = stack[level - 1];
		if (current && current.id === id && current.list.ordered === ordered) {
			current.list.children.push(item);
			continue;
		}
		const opened = { type: "list", ordered, spread: false, children: [item] };
		const parentItem = stack[level - 2]?.list.children.at(-1);
		if (parentItem) parentItem.children.push(opened);
		else lists.push(opened);
		stack[level - 1] = { list: opened, id };
	}
	return lists;
}
