import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { buildNormalizedMarkdownFromTiptapDoc } from "./build-markdown-from-editor";
import {
	parseMarkdownSource,
	parseMarkdownSourceRaw,
	serializeAst,
} from "./markdown";
import { preserveMarkdownSource } from "./preserve-markdown-source";
import { astToTiptapDoc } from "./tiptap-markdown-bridge/mdwc-to-tiptap";
import { tiptapDocToAst } from "./tiptap-markdown-bridge/tiptap-to-mdwc";

/*
 * Saving a Markdown document used to serialize the whole document and then
 * parse the file and the new text several times over to keep the file's own
 * spelling of untouched blocks. That work grew with the document and ran after
 * every keystroke: 36 KB cost hundreds of milliseconds per character.
 *
 * Both steps are done per block here. The document's top-level nodes are
 * serialized one "unit" at a time and cached by node identity, since ProseMirror
 * keeps untouched nodes. The file is aligned with those units once, and each
 * save re-runs source preservation only on the units that changed plus their
 * neighbours. Whatever this cannot prove safe falls back to the whole-document
 * path, which stays the reference for both results.
 */

/**
 * The top-level nodes that serialize together. A top-level list changes the
 * bullet of whatever list is serialized next, so a list takes its following
 * node with it; every other node stands alone.
 */
export type MarkdownUnit = {
	readonly text: string;
	/** mdast type of the unit's first and last top-level block. */
	readonly firstType: string;
	readonly lastType: string;
};

type NodeSerialization = {
	/** Top-level mdast types the node became; empty when it serializes to nothing. */
	readonly types: readonly string[];
	/** The node's Markdown when no list precedes it. */
	readonly text: string;
};

const SENTINEL = "atelierunitboundary";
const SENTINEL_JSON = {
	type: "paragraph",
	content: [{ type: "text", text: SENTINEL }],
};
const SENTINEL_PREFIX = `${SENTINEL}\n\n`;
const SENTINEL_SUFFIX = `\n\n${SENTINEL}\n`;

// Top-level phrasing content makes the serializer join the root's children
// without blank lines, which per-unit serialization cannot reproduce.
const PHRASING_TYPES = new Set([
	"break",
	"delete",
	"emphasis",
	"footnote",
	"footnoteReference",
	"image",
	"imageReference",
	"inlineCode",
	"inlineMath",
	"link",
	"linkReference",
	"strong",
	"text",
]);

// Definitions resolve references anywhere in the file, so no block can be
// judged on its own while one exists.
const DOCUMENT_WIDE_TYPES = new Set(["definition", "footnoteDefinition"]);
// What a definition line can look like, to skip parsing a file that has one.
const DEFINITION_LINE =
	/^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)*\[[^\]\n]+\]:/m;

// Keyed by whether a block is written before the node: the document's first
// block is spelled differently (a "---" rule would open frontmatter there).
const nodeSerializations = {
	atStart: new WeakMap<ProseMirrorNode, NodeSerialization>(),
	afterBlock: new WeakMap<ProseMirrorNode, NodeSerialization>(),
};
const runSerializations = {
	atStart: new WeakMap<ProseMirrorNode, RunSerialization>(),
	afterBlock: new WeakMap<ProseMirrorNode, RunSerialization>(),
};
type RunSerialization = {
	readonly nodes: readonly ProseMirrorNode[];
	readonly text: string;
};
const docUnits = new WeakMap<ProseMirrorNode, readonly MarkdownUnit[] | null>();

/**
 * Serializes nodes in the middle of a document: sentinel paragraphs around
 * them make the whole-document special cases (the first block, a lone empty
 * paragraph, trailing newlines) apply exactly as they do in place, and are
 * then cut off again.
 */
function serializeNodes(
	nodes: readonly ProseMirrorNode[],
	afterBlock: boolean,
): NodeSerialization | null {
	const ast = tiptapDocToAst({
		type: "doc",
		content: [
			...(afterBlock ? [SENTINEL_JSON] : []),
			...nodes.map((node) => node.toJSON()),
			SENTINEL_JSON,
		],
	});
	const children: any[] = ast?.children ?? [];
	if (afterBlock && children[0]?.type !== "paragraph") return null;
	if (children.at(-1)?.type !== "paragraph") return null;
	const types = children
		.slice(afterBlock ? 1 : 0, -1)
		.map((child) => String(child?.type));
	if (types.some((type) => PHRASING_TYPES.has(type))) return null;
	if (types.some((type) => DOCUMENT_WIDE_TYPES.has(type))) return null;
	let markdown = serializeAst(ast);
	if (afterBlock) {
		if (!markdown.startsWith(SENTINEL_PREFIX)) return null;
		markdown = markdown.slice(SENTINEL_PREFIX.length);
	}
	if (types.length === 0)
		return markdown === `${SENTINEL}\n` ? { types, text: "" } : null;
	if (!markdown.endsWith(SENTINEL_SUFFIX)) return null;
	return { types, text: markdown.slice(0, -SENTINEL_SUFFIX.length) };
}

function nodeSerialization(
	node: ProseMirrorNode,
	afterBlock: boolean,
): NodeSerialization | null {
	const cache = afterBlock
		? nodeSerializations.afterBlock
		: nodeSerializations.atStart;
	const cached = cache.get(node);
	if (cached) return cached;
	const serialized = serializeNodes([node], afterBlock);
	if (serialized) cache.set(node, serialized);
	return serialized;
}

/**
 * A top-level node's Markdown as a save writes it (`afterBlock`: a block is
 * written before it), or null when the node cannot be serialized on its own.
 * Two nodes with the same text are the same to the file, whatever else the
 * editor keeps on them: ids, a trailing space, an empty paragraph's shape.
 */
export function topLevelNodeMarkdown(
	node: ProseMirrorNode,
	afterBlock: boolean,
): string | null {
	return nodeSerialization(node, afterBlock)?.text ?? null;
}

function runText(
	nodes: readonly ProseMirrorNode[],
	afterBlock: boolean,
): string | null {
	const cache = afterBlock
		? runSerializations.afterBlock
		: runSerializations.atStart;
	const first = nodes[0]!;
	const cached = cache.get(first);
	if (
		cached &&
		cached.nodes.length === nodes.length &&
		cached.nodes.every((node, index) => node === nodes[index])
	)
		return cached.text;
	const serialized = serializeNodes(nodes, afterBlock);
	if (!serialized) return null;
	cache.set(first, { nodes, text: serialized.text });
	return serialized.text;
}

/** The document's units, or null when it must be serialized as a whole. */
export function markdownUnits(
	doc: ProseMirrorNode,
): readonly MarkdownUnit[] | null {
	if (docUnits.has(doc)) return docUnits.get(doc)!;
	const units = computeMarkdownUnits(doc);
	docUnits.set(doc, units);
	return units;
}

function computeMarkdownUnits(
	doc: ProseMirrorNode,
): readonly MarkdownUnit[] | null {
	// A one-block document has its own empty-paragraph rule; it is cheap anyway.
	if (doc.childCount < 2) return null;
	const units: MarkdownUnit[] = [];
	let run: ProseMirrorNode[] = [];
	let runTypes: string[] = [];
	let runAfterBlock = false;
	let afterList = false;
	let failed = false;
	const flush = () => {
		if (run.length === 0) return;
		const text =
			run.length === 1
				? nodeSerialization(run[0]!, runAfterBlock)?.text
				: runText(run, runAfterBlock);
		if (text == null) failed = true;
		else if (runTypes.length > 0)
			units.push({
				text,
				firstType: runTypes[0]!,
				lastType: runTypes.at(-1)!,
			});
		run = [];
		runTypes = [];
	};
	doc.forEach((node) => {
		if (failed) return;
		const afterBlock = units.length > 0 || runTypes.length > 0;
		const serialized = nodeSerialization(node, afterBlock);
		if (!serialized) {
			failed = true;
			return;
		}
		if (!afterList) {
			flush();
			runAfterBlock = units.length > 0;
		}
		run.push(node);
		runTypes.push(...serialized.types);
		// A node that serializes to nothing leaves the list adjacent to the next.
		if (serialized.types.length > 0)
			afterList = serialized.types.at(-1) === "list";
	});
	if (!failed) flush();
	return failed ? null : units;
}

function joinUnits(units: readonly MarkdownUnit[]): string {
	const joined = units
		.map((unit) => unit.text)
		.join("\n\n")
		.replace(/\n+$/, "");
	return joined ? `${joined}\n` : "\n";
}

/**
 * The normalized Markdown of a document, identical to
 * `buildNormalizedMarkdownFromTiptapDoc`, reusing the serialization of every
 * top-level node the document shares with earlier ones.
 */
export function buildNormalizedMarkdownIncrementally(
	doc: ProseMirrorNode,
): string {
	const units = markdownUnits(doc);
	return units ? joinUnits(units) : buildNormalizedMarkdownFromTiptapDoc(doc);
}

/** Same comparison `preserveMarkdownSource` makes: the text after an editor round trip. */
function canonicalMarkdown(text: string): string {
	return serializeAst(
		tiptapDocToAst(astToTiptapDoc(parseMarkdownSource(text) as never)),
	);
}

/**
 * A stretch of the file and the units it stands for. On its own it parses to
 * the same document as the units' Markdown, and it ends at a boundary where
 * the parser starts afresh, so stretches can be swapped independently.
 */
type SourceGroup = {
	readonly units: readonly MarkdownUnit[];
	readonly source: string;
};

type SourceAlignment = {
	readonly original: string;
	readonly groups: readonly SourceGroup[];
};

const FENCE = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/;

/** Whether a fenced code block is still open at the end of `text`. */
function endsInsideFence(text: string): boolean {
	let open: { char: string; length: number } | null = null;
	for (const line of text.split("\n")) {
		const match = FENCE.exec(line);
		if (!match) continue;
		const fence = match[1]!;
		if (!open) {
			// Backtick fences cannot carry a backtick in their info string.
			if (fence[0] === "`" && match[2]!.includes("`")) continue;
			open = { char: fence[0]!, length: fence.length };
		} else if (
			fence[0] === open.char &&
			fence.length >= open.length &&
			!match[2]!.trim()
		) {
			open = null;
		}
	}
	return open !== null;
}

/** Whether the parser's state after `before` cannot reach into `after`. */
function isHardBoundary(
	before: string,
	beforeLastType: string,
	after: string,
): boolean {
	// A blank line ends paragraphs, tables, block quotes and HTML blocks of
	// the blank-line kind; text in column one ends any list item.
	if (!/\n[ \t]*\n\s*$/.test(before)) return false;
	if (!/^\S/.test(after)) return false;
	// The other HTML blocks run until their own end marker.
	if (beforeLastType === "html") return false;
	// A list swallows a following list, even across blank lines.
	if (beforeLastType === "list") return false;
	// An unclosed fence swallows everything after it.
	if (beforeLastType === "code" && endsInsideFence(before)) return false;
	return true;
}

function unitsMarkdown(units: readonly MarkdownUnit[]): string {
	return units.map((unit) => unit.text).join("\n\n");
}

function sourceMatchesUnits(
	source: string,
	units: readonly MarkdownUnit[],
): boolean {
	const markdown = unitsMarkdown(units);
	if (source.replace(/\s+$/, "") === markdown.replace(/\s+$/, "")) return true;
	const canonical = canonicalMarkdown(source);
	return (
		canonical === `${markdown}\n` || canonical === canonicalMarkdown(markdown)
	);
}

/**
 * Splits `source` into groups for `units`, or returns null when the file's
 * blocks do not line up with the units one to one.
 */
function alignSource(
	source: string,
	units: readonly MarkdownUnit[],
): SourceGroup[] | null {
	if (units.length === 0) return null;
	const root = parseMarkdownSourceRaw(source);
	let documentWide = false;
	const visit = (node: any): void => {
		if (DOCUMENT_WIDE_TYPES.has(node?.type)) documentWide = true;
		for (const child of node?.children ?? []) if (!documentWide) visit(child);
	};
	visit(root);
	if (documentWide) return null;
	// Group the file's blocks the way units group nodes.
	const starts: number[] = [];
	let afterList = false;
	for (const child of root.children) {
		const offset = child.position?.start?.offset;
		if (typeof offset !== "number") return null;
		if (!afterList) starts.push(offset);
		afterList = child.type === "list";
	}
	if (starts.length !== units.length) return null;
	const pieces = starts.map((start, index) =>
		source.slice(index === 0 ? 0 : start, starts[index + 1] ?? source.length),
	);
	const groups: SourceGroup[] = [];
	for (let index = 0; index < pieces.length; index++) {
		const piece = pieces[index]!;
		const unit = units[index]!;
		const previous = groups.at(-1);
		if (
			previous &&
			!isHardBoundary(previous.source, previous.units.at(-1)!.lastType, piece)
		) {
			groups[groups.length - 1] = {
				units: [...previous.units, unit],
				source: previous.source + piece,
			};
		} else {
			groups.push({ units: [unit], source: piece });
		}
	}
	for (const group of groups)
		if (!sourceMatchesUnits(group.source, group.units)) return null;
	return groups;
}

/**
 * Keeps a file's spelling across saves without re-reading the whole file on
 * each one. One instance belongs to one editor.
 */
export type IncrementalMarkdownSource = {
	/**
	 * Source-preserving Markdown for `doc` against the file `original`.
	 * `accept` records the result as the file's new content once it is saved.
	 */
	preserve(
		original: string,
		doc: ProseMirrorNode,
		normalized: string,
	): { readonly markdown: string; accept(): void };
	/** Aligns a file with the document showing it, ahead of the first save. */
	prime(original: string, doc: ProseMirrorNode): void;
	dispose(): void;
};

export function createIncrementalMarkdownSource(): IncrementalMarkdownSource {
	let alignment: SourceAlignment | null = null;
	let primed: { original: string; doc: ProseMirrorNode } | null = null;
	let idleHandle: number | null = null;
	let disposed = false;

	const cancelIdle = () => {
		if (idleHandle !== null) globalThis.cancelIdleCallback?.(idleHandle);
		idleHandle = null;
	};
	const align = (
		original: string,
		doc: ProseMirrorNode,
	): SourceAlignment | null => {
		if (original.includes("\r") || DEFINITION_LINE.test(original)) return null;
		const units = markdownUnits(doc);
		if (!units) return null;
		const groups = alignSource(original, units);
		return groups ? { original, groups } : null;
	};
	const alignPrimed = (original: string): void => {
		if (!primed || primed.original !== original) return;
		const { doc } = primed;
		primed = null;
		cancelIdle();
		alignment = align(original, doc);
	};
	const prime = (original: string, doc: ProseMirrorNode): void => {
		if (disposed || alignment?.original === original) return;
		alignment = null;
		primed = { original, doc };
		cancelIdle();
		// Without idle callbacks the first save aligns instead.
		if (typeof globalThis.requestIdleCallback !== "function") return;
		idleHandle = globalThis.requestIdleCallback(
			() => {
				idleHandle = null;
				alignPrimed(original);
			},
			{ timeout: 2000 },
		);
	};

	return {
		preserve(original, doc, normalized) {
			alignPrimed(original);
			const current = alignment?.original === original ? alignment : null;
			const units = current ? markdownUnits(doc) : null;
			const next = current && units ? preserveWindow(current, units) : null;
			if (next) {
				return {
					markdown: next.original,
					accept: () => {
						alignment = next;
					},
				};
			}
			const markdown = preserveMarkdownSource(original, normalized);
			return {
				markdown,
				// Align the saved file with this document when the editor is idle.
				accept: () => prime(markdown, doc),
			};
		},
		prime,
		dispose() {
			disposed = true;
			cancelIdle();
			primed = null;
			alignment = null;
		},
	};
}

/**
 * Re-runs source preservation on the groups whose units changed, widened
 * until both edges are boundaries the parser cannot see across.
 */
function preserveWindow(
	alignment: SourceAlignment,
	units: readonly MarkdownUnit[],
): SourceAlignment | null {
	const { groups } = alignment;
	const oldUnits = groups.flatMap((group) => group.units);
	const oldCount = oldUnits.length;
	const newCount = units.length;
	if (oldCount === 0 || newCount === 0) return null;
	let prefix = 0;
	while (
		prefix < oldCount &&
		prefix < newCount &&
		oldUnits[prefix]!.text === units[prefix]!.text
	)
		prefix++;
	if (prefix === oldCount && oldCount === newCount) return alignment;
	let suffix = 0;
	while (
		suffix < oldCount - prefix &&
		suffix < newCount - prefix &&
		oldUnits[oldCount - 1 - suffix]!.text === units[newCount - 1 - suffix]!.text
	)
		suffix++;

	const groupOfUnit: number[] = [];
	groups.forEach((group, index) => {
		for (const _ of group.units) groupOfUnit.push(index);
	});
	// One unchanged unit on each side, so a neighbour whose separator depended
	// on the edited block (a former last block, say) is redone with it.
	let firstGroup = groupOfUnit[Math.max(0, prefix - 1)]!;
	let lastGroup =
		groupOfUnit[Math.min(oldCount - 1, oldCount - suffix)] ?? groups.length - 1;
	if (lastGroup < firstGroup) lastGroup = firstGroup;

	while (true) {
		const unitStart = groups
			.slice(0, firstGroup)
			.reduce((count, group) => count + group.units.length, 0);
		const oldUnitEnd =
			unitStart +
			groups
				.slice(firstGroup, lastGroup + 1)
				.reduce((count, group) => count + group.units.length, 0);
		const newUnitEnd = oldUnitEnd + (newCount - oldCount);
		const windowUnits = units.slice(unitStart, newUnitEnd);
		const isLast = lastGroup === groups.length - 1;
		const oldSource = groups
			.slice(firstGroup, lastGroup + 1)
			.map((group) => group.source)
			.join("");
		let source: string;
		if (windowUnits.length === 0) {
			source = "";
		} else {
			const target = `${unitsMarkdown(windowUnits)}${isLast ? "\n" : "\n\n"}`;
			source = preserveMarkdownSource(oldSource, target);
			// Keep the blank line that separates the window from what follows.
			if (!isLast && !/\n[ \t]*\n\s*$/.test(source))
				source = source.replace(/\n*$/, "\n\n");
		}
		const before = groups[firstGroup - 1];
		const after = groups[lastGroup + 1];
		const lastType = windowUnits.at(-1)?.lastType;
		const beforeHard =
			!before ||
			(source === ""
				? true
				: isHardBoundary(before.source, before.units.at(-1)!.lastType, source));
		const afterHard =
			!after ||
			(source === ""
				? !before ||
					isHardBoundary(
						before.source,
						before.units.at(-1)!.lastType,
						after.source,
					)
				: isHardBoundary(source, lastType!, after.source));
		if (!beforeHard && firstGroup > 0) {
			firstGroup -= 1;
			continue;
		}
		if (!afterHard && lastGroup < groups.length - 1) {
			lastGroup += 1;
			continue;
		}
		if (!beforeHard || !afterHard) return null;
		// Only the file's first line can open frontmatter, which a window read
		// on its own at the start of nothing cannot tell.
		if (
			firstGroup === 0 &&
			windowUnits[0]?.firstType !== "yaml" &&
			/^---[ \t]*(?:\n|$)/.test(source)
		)
			return null;
		const windowGroups =
			windowUnits.length === 0
				? []
				: (alignSource(source, windowUnits) ?? [
						{ units: windowUnits, source },
					]);
		const nextGroups = [
			...groups.slice(0, firstGroup),
			...windowGroups,
			...groups.slice(lastGroup + 1),
		];
		// A removed final block leaves the new final block's separator behind.
		const original = nextGroups.map((group) => group.source).join("");
		return { original, groups: nextGroups };
	}
}
