import { fromMarkdown } from "mdast-util-from-markdown";
import {
	frontmatterFromMarkdown,
	frontmatterToMarkdown,
} from "mdast-util-frontmatter";
import { gfmFromMarkdown, gfmToMarkdown } from "mdast-util-gfm";
import { defaultHandlers, toMarkdown } from "mdast-util-to-markdown";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";

type AstRoot = {
	type: "root";
	children: any[];
};

export function parseMarkdown(markdown: string): AstRoot {
	return normalizeAst(parseMarkdownSource(markdown));
}

/** Parses Markdown without discarding source positions used by review plans. */
export function parseMarkdownSource(markdown: string): AstRoot {
	return resolveReferences(parseMarkdownSourceRaw(markdown));
}

/** Source syntax including reference definitions, for byte-preserving edits. */
export function parseMarkdownSourceRaw(markdown: string): AstRoot {
	const ast = fromMarkdown(markdown, {
		extensions: [gfm(), frontmatter(["yaml"])],
		mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown(["yaml"])],
	});
	restoreEmptyTaskItems(ast, markdown);
	markLiteralAutolinks(ast, markdown);
	return ast;
}

/** Marks a link written as a bare URL, `www.` domain or email address. */
export const LITERAL_AUTOLINK_DATA_KEY = "__atelier_literal_autolink";

/**
 * GFM links a bare `https://x.com`, `www.x.com` or `me@x.com` without any
 * syntax. The serializer only knows `<https://x.com>` and
 * `[www.x.com](http://www.x.com)`, so an edit rewrote every bare URL in the
 * block. Remember which links were bare so they can be written that way.
 */
function markLiteralAutolinks(node: any, source: string): void {
	if (!node || typeof node !== "object") return;
	if (node.type === "link") {
		// Links GFM finds in text after parsing (`https\://x.com` too) have
		// no position of their own.
		const first = node.position
			? source[node.position.start.offset]
			: undefined;
		if (first !== "[" && first !== "<") {
			node.data = { ...node.data, [LITERAL_AUTOLINK_DATA_KEY]: true };
		}
	}
	for (const child of Array.isArray(node.children) ? node.children : [])
		markLiteralAutolinks(child, source);
}

/**
 * GFM only recognizes a task marker when text follows it, so the Markdown we
 * serialize for an empty task (`- [ ] `) comes back as a plain list item whose
 * text is `[ ]`. Restore the task semantics before building the editor doc.
 */
function restoreEmptyTaskItems(
	node: any,
	source: string,
	insideList = false,
): void {
	if (!node || typeof node !== "object") return;

	if (
		insideList &&
		node.type === "listItem" &&
		typeof node.checked !== "boolean" &&
		Array.isArray(node.children) &&
		node.children.length === 1
	) {
		const paragraph = node.children[0];
		const inline = paragraph?.type === "paragraph" ? paragraph.children : null;
		const marker =
			Array.isArray(inline) &&
			inline.length === 1 &&
			inline[0]?.type === "text" &&
			typeof inline[0].value === "string"
				? /^\[([ xX])\]$/.exec(inline[0].value)
				: null;
		const originalMarker = marker
			? source.slice(
					inline[0].position?.start?.offset,
					inline[0].position?.end?.offset,
				)
			: null;
		// Escapes and entities can decode to [ ] without being a task marker.
		// Only recover the bare syntax that our empty-task serializer emits.
		if (marker && originalMarker === inline[0].value) {
			node.checked = marker[1]?.toLowerCase() === "x";
			paragraph.children = [];
		}
	}

	const childIsInsideList = node.type === "list";
	for (const child of Array.isArray(node.children) ? node.children : []) {
		restoreEmptyTaskItems(child, source, childIsInsideList);
	}
}

function resolveReferences(ast: any): any {
	const definitions = new Map<string, any>();
	// Definitions inside containers apply document-wide. CommonMark uses the
	// first definition in source order, including when later labels differ in case.
	const collect = (node: any): void => {
		if (node?.type === "definition" && typeof node.identifier === "string") {
			const identifier = normalizeIdentifier(node.identifier);
			if (!definitions.has(identifier)) definitions.set(identifier, node);
		}
		for (const child of Array.isArray(node?.children) ? node.children : [])
			collect(child);
	};
	collect(ast);

	const resolve = (node: any): any => {
		if (!node || typeof node !== "object") {
			return node;
		}
		if (Array.isArray(node)) {
			return node.map(resolve);
		}
		if (node.type === "definition") {
			return null;
		}

		const children = Array.isArray(node.children)
			? node.children.map(resolve).filter(Boolean)
			: undefined;
		if (node.type === "linkReference" && typeof node.identifier === "string") {
			const definition = definitions.get(normalizeIdentifier(node.identifier));
			if (definition) {
				return {
					type: "link",
					url: definition.url,
					title: definition.title ?? null,
					children: children ?? [],
					...(node.position ? { position: node.position } : {}),
				};
			}
		}
		if (node.type === "imageReference" && typeof node.identifier === "string") {
			const definition = definitions.get(normalizeIdentifier(node.identifier));
			if (definition) {
				return {
					type: "image",
					url: definition.url,
					title: definition.title ?? null,
					alt: node.alt ?? null,
					...(node.position ? { position: node.position } : {}),
				};
			}
		}

		return {
			...node,
			...(children ? { children } : {}),
		};
	};

	return resolve(ast);
}

function normalizeIdentifier(identifier: string): string {
	return identifier.toLowerCase();
}

export function serializeAst(ast: any): string {
	return normalizeSerializedMarkdown(
		toMarkdown(prepareAstForMarkdown(ast), serializeOptions()),
	);
}

/**
 * One inline node's Markdown, as written in the middle of a line. Unlike
 * serializeAst it keeps whitespace at the node's edges.
 */
export function serializeInlineNode(node: any): string {
	return toMarkdown(
		{ type: "paragraph", children: [node] } as any,
		serializeOptions(),
	).replace(/\n$/, "");
}

function serializeOptions(): any {
	return {
		extensions: [
			gfmToMarkdown(),
			taskListItemToMarkdown(),
			frontmatterToMarkdown(["yaml"]),
		],
		bullet: "-",
		listItemIndent: "one",
		// "---" as a document's first line re-parses as a YAML frontmatter
		// fence and swallows everything up to the next rule; "***" cannot.
		rule: "*",
		ruleRepetition: 3,
		ruleSpaces: false,
		// "_" cannot open intraword emphasis, so the serializer would fall
		// back to hex entities for foo*bar*baz; "*" works in every position.
		emphasis: "*",
		strong: "*",
		fence: "`",
		fences: true,
	};
}

// A backslash before ASCII punctuation, or the hex character reference the
// serializer writes where a backslash cannot help.
const ESCAPE_PATTERN = /\\[!-/:-@[-`{-~]|&#x[0-9A-Fa-f]+;/g;

/**
 * Drops every escape that `markdown` does not need. mdast-util-to-markdown
 * escapes a character wherever it could start syntax in some context, so an
 * edited paragraph came back as `snake\_case`, `\[!NOTE]`, `\[[Note]]` or
 * `AT\&T`. Each escape is removed only if the text still parses to the same
 * document; `definitions` holds the file's reference definitions, so a
 * literal `[label]` is not turned into a link to one of them.
 */
export function minimizeEscapes(markdown: string, definitions = ""): string {
	const literal = literalRanges(markdown);
	const candidates = [...markdown.matchAll(ESCAPE_PATTERN)].filter(
		(match) =>
			!literal.some(
				([start, end]) => match.index >= start && match.index < end,
			),
	);
	if (candidates.length === 0) return markdown;
	const meaning = (text: string) =>
		JSON.stringify(parseMarkdown(`${text}\n\n${definitions}`));
	const expected = meaning(markdown);
	const apply = (removed: ReadonlySet<number>) => {
		let out = "";
		let cursor = 0;
		candidates.forEach((match, index) => {
			if (!removed.has(index)) return;
			out += markdown.slice(cursor, match.index);
			out += match[0].startsWith("\\")
				? match[0].slice(1)
				: String.fromCodePoint(Number.parseInt(match[0].slice(3, -1), 16));
			cursor = match.index + match[0].length;
		});
		return out + markdown.slice(cursor);
	};
	// Try the whole group first, since usually no escape is needed, and
	// halve it only where one is.
	let removed = new Set<number>();
	const attempt = (group: readonly number[]): void => {
		const trial = new Set([...removed, ...group]);
		if (meaning(apply(trial)) === expected) {
			removed = trial;
			return;
		}
		if (group.length === 1) return;
		const middle = Math.floor(group.length / 2);
		attempt(group.slice(0, middle));
		attempt(group.slice(middle));
	};
	attempt(candidates.map((_, index) => index));
	return apply(removed);
}

/** Source ranges where a backslash is a literal character, not an escape. */
function literalRanges(markdown: string): [number, number][] {
	const ranges: [number, number][] = [];
	const visit = (node: any): void => {
		if (
			(node.type === "code" ||
				node.type === "inlineCode" ||
				node.type === "html" ||
				node.type === "yaml") &&
			node.position
		) {
			ranges.push([node.position.start.offset, node.position.end.offset]);
			return;
		}
		for (const child of node.children ?? []) visit(child);
	};
	visit(parseMarkdownSourceRaw(markdown));
	return ranges;
}

function taskListItemToMarkdown(): any {
	return {
		handlers: {
			listItem: taskListItemWithEmptyMarker,
		},
	};
}

function taskListItemWithEmptyMarker(
	node: any,
	parent: any,
	state: any,
	info: any,
): string {
	const checkable = typeof node.checked === "boolean";
	if (!checkable) {
		return defaultHandlers.listItem(node, parent, state, info);
	}

	const checkbox = `[${node.checked ? "x" : " "}] `;
	const tracker = state.createTracker(info);
	tracker.move(checkbox);
	const value = defaultHandlers.listItem(node, parent, state, {
		...info,
		...tracker.current(),
	});
	const marked = value.replace(
		/^((?:[*+-]|\d+\.)(?:[\r\n]| {1,3}))/,
		`$1${checkbox}`,
	);
	return marked === value
		? value.replace(/^([*+-]|\d+\.)$/, `$1 ${checkbox}`)
		: marked;
}

function prepareAstForMarkdown(value: any): any {
	if (Array.isArray(value)) {
		return value.map(prepareAstForMarkdown);
	}
	if (!value || typeof value !== "object") {
		return value;
	}

	const out: Record<string, any> = {};
	for (const [key, child] of Object.entries(value)) {
		out[key] = prepareAstForMarkdown(child);
	}
	if (
		(out.type === "list" || out.type === "listItem") &&
		typeof out.spread !== "boolean"
	) {
		out.spread = false;
	}
	if (isInlineContainer(out) && Array.isArray(out.children)) {
		out.children = trimInlineBoundaryWhitespace(out.children);
	}
	if (Array.isArray(out.children) && out.children.some(isLiteralAutolink)) {
		out.children = out.children.map((child: any, index: number) =>
			isLiteralAutolink(child) &&
			bareAutolinkFits(out.children[index - 1], out.children[index + 1])
				? { type: "html", value: child.children[0].value }
				: child,
		);
	}
	return out;
}

/** A link that was a bare URL in the source and still reads as that URL. */
function isLiteralAutolink(node: any): boolean {
	if (node?.type !== "link" || !node.data?.[LITERAL_AUTOLINK_DATA_KEY])
		return false;
	const text = node.children?.length === 1 ? node.children[0] : null;
	if (text?.type !== "text" || typeof text.value !== "string") return false;
	if (!/^[\w./:@%?=&#+~-]+$/.test(text.value)) return false;
	return (
		node.url === text.value ||
		node.url === `http://${text.value}` ||
		node.url === `mailto:${text.value}`
	);
}

/**
 * A bare URL is only a link where GFM would find it again: after whitespace
 * or at the start of its container, and ending before whitespace or trailing
 * punctuation. Typing right after it (`https://x.comZ`) would otherwise
 * extend the link.
 */
function bareAutolinkFits(before: any, after: any): boolean {
	const opens =
		before === undefined ||
		(before.type === "text" && /\s$/.test(before.value ?? ""));
	const closes =
		after === undefined ||
		after.type === "break" ||
		(after.type === "text" &&
			/^(?:\s|[.,:;!?]+(?:\s|$))/.test(after.value ?? ""));
	return opens && closes;
}

function isInlineContainer(node: Record<string, any>): boolean {
	return (
		node.type === "paragraph" ||
		node.type === "heading" ||
		node.type === "tableCell"
	);
}

function trimInlineBoundaryWhitespace(children: any[]): any[] {
	const out = [...children];
	trimInlineStart(out);
	trimInlineEnd(out);
	return out.filter((child) => !isEmptyInline(child));
}

function trimInlineStart(children: any[]): void {
	for (const child of children) {
		if (trimInlineNodeStart(child)) return;
	}
}

function trimInlineEnd(children: any[]): void {
	for (let index = children.length - 1; index >= 0; index -= 1) {
		if (trimInlineNodeEnd(children[index])) return;
	}
}

function trimInlineNodeStart(node: any): boolean {
	if (!node || typeof node !== "object") return true;
	if (node.type === "text") {
		node.value =
			typeof node.value === "string" ? node.value.replace(/^[\t ]+/g, "") : "";
		return node.value.length > 0;
	}
	if (canTrimInlineChildren(node)) {
		trimInlineStart(node.children);
		return !isEmptyInline(node);
	}
	return true;
}

function trimInlineNodeEnd(node: any): boolean {
	if (!node || typeof node !== "object") return true;
	if (node.type === "text") {
		node.value =
			typeof node.value === "string" ? node.value.replace(/[\t ]+$/g, "") : "";
		return node.value.length > 0;
	}
	if (canTrimInlineChildren(node)) {
		trimInlineEnd(node.children);
		return !isEmptyInline(node);
	}
	return true;
}

function canTrimInlineChildren(node: any): boolean {
	return (
		(node.type === "emphasis" ||
			node.type === "strong" ||
			node.type === "delete" ||
			node.type === "link") &&
		Array.isArray(node.children)
	);
}

function isEmptyInline(node: any): boolean {
	if (!node || typeof node !== "object") return false;
	if (node.type === "text") return !node.value;
	if (canTrimInlineChildren(node)) return node.children.every(isEmptyInline);
	return false;
}

function normalizeSerializedMarkdown(markdown: string): string {
	const normalized = markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const withoutTrailingNewlines = normalized.replace(/\n+$/g, "");
	return withoutTrailingNewlines.length > 0
		? `${withoutTrailingNewlines}\n`
		: "";
}

export function normalizeAst(ast: any): AstRoot {
	return asRoot(normalizeValue(ast));
}

function normalizeValue(value: any): any {
	if (value === undefined) {
		return null;
	}
	if (typeof value === "string") {
		return normalizeText(value);
	}
	if (Array.isArray(value)) {
		return value.map(normalizeValue);
	}
	if (!value || typeof value !== "object") {
		return value;
	}

	const out: Record<string, any> = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === "position") continue;
		out[key] = normalizeValue(child);
	}
	return out;
}

function normalizeText(input: string): string {
	const normalizedNewlines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	return isAscii(normalizedNewlines)
		? normalizedNewlines
		: normalizedNewlines.normalize("NFC");
}

function isAscii(input: string): boolean {
	for (let index = 0; index < input.length; index++) {
		if (input.charCodeAt(index) > 0x7f) return false;
	}
	return true;
}

function asRoot(ast: any): AstRoot {
	return {
		type: "root",
		children: Array.isArray(ast?.children) ? ast.children : [],
	};
}
