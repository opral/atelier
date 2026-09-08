import {
	parseMarkdownSource,
	parseMarkdownSourceRaw,
	serializeAst,
} from "./markdown";

/** Reuse original block spelling, then verify the assembled document in context.
 * Whole-document parsing matters: adjacent lists, reference definitions, and
 * Setext headings cannot safely be serialized as independent strings.
 */
export function preserveMarkdownSource(
	original: string,
	serialized: string,
): string {
	const canonical = (text: string) => serializeAst(parseMarkdownSource(text));
	const target = canonical(serialized);
	if (canonical(original) === target) return original;
	const segments = (text: string) => {
		const nodes = parseMarkdownSource(text).children;
		return nodes.map((node, index) => ({
			key: serializeAst({ type: "root", children: [node] }),
			text: text.slice(
				index === 0 ? 0 : node.position.start.offset,
				nodes[index + 1]?.position.start.offset ?? text.length,
			),
		}));
	};
	const available = new Map<string, string[]>();
	for (const block of segments(original)) {
		const queue = available.get(block.key) ?? [];
		queue.push(block.text);
		available.set(block.key, queue);
	}
	const next = segments(serialized);
	// Definitions are invisible in the editor and absent from its serialized
	// document. Keep their source even when their neighboring block was edited.
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
	const preserved = next.map((block) => {
		const reused = available.get(block.key)?.shift();
		return reused ?? block.text;
	});
	const candidate = withDefinitions(preserved.join(""));
	if (canonical(candidate) === target) return candidate;
	const separated = preserved.map((text, index) => {
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
	const safe = next.map((block) => block.text);
	for (let index = 0; index < safe.length; index++) {
		const previous = safe[index]!;
		safe[index] = separated[index]!;
		if (canonical(withDefinitions(safe.join(""))) !== target)
			safe[index] = previous;
	}
	const result = withDefinitions(safe.join(""));
	return canonical(result) === target ? result : serialized;
}
