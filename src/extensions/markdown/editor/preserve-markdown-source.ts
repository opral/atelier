import {
	minimizeEscapes,
	parseMarkdownSource,
	parseMarkdownSourceRaw,
	serializeAst,
} from "./markdown";
import { astToTiptapDoc, tiptapDocToAst } from "./tiptap-markdown-bridge";

/**
 * The spelling a block has after a trip through the editor. Comparing source
 * against the editor's output with this (rather than a bare parse+serialize)
 * means differences the editor introduces on every block, such as mark
 * nesting order, do not count as edits, so untouched blocks keep their
 * original spelling.
 */
function canonicalMarkdown(text: string): string {
	const ast = parseMarkdownSource(text);
	const doc = astToTiptapDoc(ast as never);
	return serializeAst(tiptapDocToAst(doc as never));
}

/** Reuse original block spelling, then verify the assembled document in context.
 * Whole-document parsing matters: adjacent lists, reference definitions, and
 * Setext headings cannot safely be serialized as independent strings.
 */
export function preserveMarkdownSource(
	original: string,
	serialized: string,
): string {
	const canonical = canonicalMarkdown;
	const target = canonical(serialized);
	if (canonical(original) === target) return original;
	const keyOf = (node: any) =>
		canonical(serializeAst({ type: "root", children: [node] }));
	// Top-level definitions are their own segments here, attached to the
	// block they follow: they are invisible in the editor and absent from its
	// serialized document, and must stay where they were when that block is
	// edited rather than move to the end of the file.
	const resolved = parseMarkdownSource(original).children;
	const leadingDefinitions: string[] = [];
	const originals: (Segment & { key: string; definitions: string[] })[] = [];
	for (const segment of segments(
		original,
		parseMarkdownSourceRaw(original).children,
	)) {
		if (segment.node.type === "definition") {
			(originals.at(-1)?.definitions ?? leadingDefinitions).push(segment.text);
			continue;
		}
		originals.push({
			...segment,
			key: keyOf(resolved[originals.length]),
			definitions: [],
		});
	}
	const available = new Map<string, number[]>();
	originals.forEach((segment, index) => {
		const queue = available.get(segment.key) ?? [];
		queue.push(index);
		available.set(segment.key, queue);
	});
	const next = segments(serialized, parseMarkdownSource(serialized).children);
	const definitions: string[] = [];
	const collectDefinitions = (node: any, depth: number): void => {
		if (node.type === "definition") {
			definitions.push(
				depth === 1
					? original.slice(node.position.start.offset, node.position.end.offset)
					: // Container prefixes cannot be copied into a detached definition.
						// Retain its label, target, and title using standalone syntax.
						serializeAst({ type: "root", children: [node] }).trimEnd(),
			);
		}
		for (const child of node.children ?? [])
			collectDefinitions(child, depth + 1);
	};
	collectDefinitions(parseMarkdownSourceRaw(original), 0);
	const withDefinitions = (text: string) => {
		if (next.length === 0) return text;
		if (definitions.length === 0) return text;
		const existing = new Set<string>();
		const collectExisting = (node: any): void => {
			if (node.type === "definition")
				existing.add(serializeAst({ type: "root", children: [node] }));
			for (const child of node.children ?? []) collectExisting(child);
		};
		collectExisting(parseMarkdownSourceRaw(text));
		const missing = definitions.filter(
			(definition) =>
				!existing.has(serializeAst(parseMarkdownSourceRaw(definition))),
		);
		if (missing.length === 0) return text;
		const candidate =
			text +
			(text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n") +
			missing.join("\n") +
			"\n";
		// A newly typed literal reference must not acquire a hidden old target.
		return canonical(candidate) === target ? candidate : text;
	};
	const reused = next.map((segment) =>
		available.get(keyOf(segment.node))?.shift(),
	);
	// An edit that changed blocks but added or removed none leaves one
	// original block over for each edited one. Pair them in order, so an
	// edited block keeps the blank lines and definitions that followed it.
	const counterpart = [...reused];
	const leftOver = originals.flatMap((_, index) =>
		reused.includes(index) ? [] : [index],
	);
	const edited = next.flatMap((_, index) =>
		reused[index] === undefined ? [index] : [],
	);
	if (leftOver.length === edited.length)
		edited.forEach((index, order) => {
			counterpart[index] = leftOver[order];
		});
	// Blocks the editor re-emits are written with only the escapes their
	// meaning needs; the rest keep their source spelling.
	const definitionSource = definitions.join("\n");
	const emitted = (minimal: boolean) =>
		next.map((segment, index) => {
			const content = segment.text.slice(
				0,
				segment.text.length - segment.gap.length,
			);
			// The file's end is the editor's: an edited last block ends in one
			// newline, as it always has, unless definitions follow it.
			const pair = counterpart[index];
			const between =
				pair !== undefined &&
				(originals[pair]!.definitions.length > 0 ||
					(pair < originals.length - 1 && index < next.length - 1));
			return (
				(minimal ? minimizeEscapes(content, definitionSource) : content) +
				(between ? originals[pair]!.gap : segment.gap)
			);
		});
	const withSourceDefinitions = (texts: readonly string[]) =>
		texts.map((text, index) => {
			const pair = counterpart[index];
			return (
				(index === 0 ? leadingDefinitions.join("") : "") +
				text +
				(pair === undefined ? "" : originals[pair]!.definitions.join(""))
			);
		});
	const assemble = (fresh: readonly string[]): string | null => {
		const preserved = fresh.map((text, index) => {
			const match = reused[index];
			return match === undefined ? text : originals[match]!.text;
		});
		const candidate = withDefinitions(
			withSourceDefinitions(preserved).join(""),
		);
		if (canonical(candidate) === target) return candidate;
		const separated = withSourceDefinitions(preserved).map((text, index) => {
			// A formerly final block may now precede another block.
			return index < next.length - 1 && !/\r?\n\r?\n$/.test(text)
				? text + (text.endsWith("\n") ? "\n" : "\n\n")
				: text;
		});
		const separatedCandidate = withDefinitions(separated.join(""));
		if (canonical(separatedCandidate) === target) return separatedCandidate;
		// A moved block may depend on its old neighbors or reference definitions.
		// Retain every independently safe spelling instead of reformatting the
		// entire file because one source boundary could not be reused.
		const safe = withSourceDefinitions(fresh);
		for (let index = 0; index < safe.length; index++) {
			const previous = safe[index]!;
			safe[index] = separated[index]!;
			if (canonical(withDefinitions(safe.join(""))) !== target)
				safe[index] = previous;
		}
		const result = withDefinitions(safe.join(""));
		return canonical(result) === target ? result : null;
	};
	return matchLineEndings(
		original,
		assemble(emitted(true)) ?? assemble(emitted(false)) ?? serialized,
	);
}

type Segment = {
	readonly node: any;
	/** The block's source up to the next block. */
	readonly text: string;
	/** The whitespace between the block's content and the next block. */
	readonly gap: string;
};

function segments(text: string, nodes: readonly any[]): Segment[] {
	return nodes.map((node, index) => {
		const start = index === 0 ? 0 : node.position.start.offset;
		const end = nodes[index + 1]?.position.start.offset ?? text.length;
		const contentEnd = Math.max(start, Math.min(node.position.end.offset, end));
		return {
			node,
			text: text.slice(start, end),
			gap: text.slice(contentEnd, end),
		};
	});
}

/** Re-emitted blocks use LF; a CRLF file keeps CRLF throughout. */
function matchLineEndings(original: string, text: string): string {
	if (!original.includes("\r\n")) return text;
	return text.replace(/\r?\n/g, "\r\n");
}
