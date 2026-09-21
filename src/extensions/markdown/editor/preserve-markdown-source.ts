import {
	minimizeEscapes,
	parseMarkdownSource,
	parseMarkdownSourceRaw,
	normalizeAst,
	restoreCharacterReferences,
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
	const definitionSource = definitions.join("\n");
	// Blocks the editor re-emits are written with only the escapes their
	// meaning needs, and with the character references and table rows of
	// the block they replace. If the file then does not read back as the
	// editor's document, they are written exactly as serialized instead.
	const emitted = (restore: boolean) =>
		next.map((segment, index) => {
			// A reused block's source stands in for it; this spelling is only
			// the fallback when that source cannot be reused in place.
			if (reused[index] !== undefined) return segment.text;
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
			let written = content;
			if (restore) {
				written = minimizeEscapes(written, definitionSource);
				if (pair !== undefined) {
					const source = originals[pair]!.text;
					const withReferences = restoreCharacterReferences(written, source);
					// A restored `&#124;` can take the place of a table's own pipe;
					// a table's rows keep their character references anyway.
					written =
						restoreTableSource(
							withReferences,
							source,
							written,
							definitionSource,
						) ??
						restoreTableSource(written, source, written, definitionSource) ??
						withReferences;
				}
			}
			return written + (between ? originals[pair]!.gap : segment.gap);
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
			if (match === undefined) return text;
			const source = originals[match]!;
			// A block left last by the removal of the blocks after it ends the
			// way the file ended, not with the blank line that separated them.
			const last = originals.at(-1)!;
			if (
				index === fresh.length - 1 &&
				match !== originals.length - 1 &&
				source.definitions.length === 0 &&
				last.definitions.length === 0
			)
				return (
					source.text.slice(0, source.text.length - source.gap.length) +
					last.gap
				);
			return source.text;
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

/**
 * An edited table keeps the source of every row the edit did not touch.
 * Cells past the header's width are not part of a GFM table and the editor
 * drops them, but they are the author's text: they come back after their
 * row, wherever it goes. A table whose source is not column-aligned stays
 * unaligned, so editing one cell no longer re-pads every row, and a row
 * inserted, deleted or moved, or a sort, rewrites only the rows it made or
 * changed: an untouched row is found by what it says, wherever it now
 * stands. A table inside a list or a quote is restored in place, in the
 * source of the list or quote around it, so the rest of it keeps its
 * spelling too. Null when the result would not read as `intended`, the
 * editor's own spelling of the block, does.
 */
function restoreTableSource(
	markdown: string,
	source: string,
	intended: string,
	definitions: string,
): string | null {
	try {
		return restoreTables(markdown, source, intended, definitions);
	} catch {
		// A save must not fail over a spelling; the editor's is always valid.
		return null;
	}
}

function restoreTables(
	markdown: string,
	source: string,
	intended: string,
	definitions: string,
): string | null {
	const sourceRoot = parseMarkdownSourceRaw(source);
	const sourceTables = tablesIn(sourceRoot);
	const tables = tablesIn(parseMarkdownSourceRaw(markdown));
	if (sourceTables.length === 0 || sourceTables.length !== tables.length)
		return null;
	// The source up to the end of its content: the blank lines after it
	// are the caller's.
	let candidate = source.slice(
		0,
		sourceRoot.children.at(-1)?.position.end.offset ?? source.length,
	);
	for (let index = sourceTables.length - 1; index >= 0; index--) {
		const sourceTable = sourceTables[index]!;
		candidate =
			candidate.slice(0, sourceTable.position.start.offset) +
			restoredTable(
				readTable(source, sourceTable),
				readTable(markdown, tables[index]!),
			) +
			candidate.slice(sourceTable.position.end.offset);
	}
	const meaning = (text: string) =>
		canonicalMarkdown(definitions ? `${text}\n\n${definitions}\n` : text);
	return meaning(candidate) === meaning(intended) ? candidate : null;
}

function tablesIn(node: any): any[] {
	if (node.type === "table") return [node];
	return (node.children ?? []).flatMap(tablesIn);
}

type TableRow = {
	/** What precedes the row on its line: a list's indent, a quote's `>`. */
	readonly prefix: string;
	/** The row as written, from its first character to its last. */
	readonly text: string;
	/** Each cell's content as written, up to the header's width. */
	readonly cells: readonly string[];
	/** Each cell's meaning, up to the header's width. */
	readonly keys: readonly string[];
	/** Cells past the header's width, as written. */
	readonly excess: string;
};

type TableSource = {
	readonly node: any;
	readonly width: number;
	readonly rows: readonly TableRow[];
	readonly delimiter: { readonly prefix: string; readonly text: string };
	readonly align: readonly Align[];
	readonly eol: string;
};

const EMPTY_CELL = "[]";

function cellKey(cell: any): string {
	return JSON.stringify(
		normalizeAst({ type: "root", children: cell?.children ?? [] }).children,
	);
}

/** Cell meanings with the empty cells at the end left off. */
function trimmedKeys(keys: readonly string[]): string[] {
	const trimmed = [...keys];
	while (trimmed.at(-1) === EMPTY_CELL) trimmed.pop();
	return trimmed;
}

function readTable(text: string, table: any): TableSource {
	const width = table.children[0]?.children.length ?? 0;
	const rows = table.children.map((row: any): TableRow => {
		const start = row.position.start.offset;
		const cells = row.children.slice(0, width);
		const extra = row.children[width];
		return {
			prefix: text.slice(text.lastIndexOf("\n", start - 1) + 1, start),
			text: text.slice(start, row.position.end.offset).replace(/\r$/, ""),
			cells: cells.map((cell: any) => {
				const children = cell.children ?? [];
				return children.length === 0
					? ""
					: text.slice(
							children[0].position.start.offset,
							children.at(-1).position.end.offset,
						);
			}),
			keys: cells.map(cellKey),
			excess: extra
				? text
						.slice(extra.position.start.offset, row.position.end.offset)
						.replace(/\r$/, "")
				: "",
		};
	});
	const headerEnd = table.children[0]?.position.end.offset ?? 0;
	const lineEnd = text.indexOf("\n", headerEnd);
	const delimiterStart = lineEnd < 0 ? text.length : lineEnd + 1;
	const delimiterEnd = text.indexOf("\n", delimiterStart);
	const line = text
		.slice(delimiterStart, delimiterEnd < 0 ? text.length : delimiterEnd)
		.replace(/\r$/, "");
	// Everything before the delimiter's own characters is the container's.
	const split = /^(.*?)([|:-][-|: \t]*)$/.exec(line);
	return {
		node: table,
		width,
		rows,
		delimiter: { prefix: split?.[1] ?? "", text: split?.[2] ?? line },
		align: table.align ?? [],
		eol: text[lineEnd - 1] === "\r" ? "\r\n" : "\n",
	};
}

/**
 * For each column of the edited table, the source column it was, or null
 * for a new one. The edit is one of the table commands, so the candidates
 * are few: no change, one column inserted, deleted or moved one place, or
 * columns found by their header. The one under which most rows read as
 * before wins.
 */
function columnMapping(
	source: TableSource,
	table: TableSource,
): (number | null)[] {
	const from = source.width;
	const to = table.width;
	const candidates: (number | null)[][] = [];
	const range = (length: number) => Array.from({ length }, (_, c) => c);
	if (to === from) {
		candidates.push(range(to));
		for (let c = 0; c + 1 < to; c++) {
			const swapped = range(to);
			[swapped[c], swapped[c + 1]] = [c + 1, c];
			candidates.push(swapped);
		}
	}
	if (to === from + 1)
		for (let c = 0; c < to; c++)
			candidates.push(
				range(to).map((column) =>
					column < c ? column : column === c ? null : column - 1,
				),
			);
	if (to === from - 1)
		for (let c = 0; c < from; c++)
			candidates.push(
				range(to).map((column) => (column < c ? column : column + 1)),
			);
	const header = [...(source.rows[0]?.keys ?? [])];
	candidates.push(
		(table.rows[0]?.keys ?? []).map((key) => {
			const column = header.indexOf(key);
			if (column < 0) return null;
			header[column] = "";
			return column;
		}),
	);
	candidates.push(range(to).map((column) => (column < from ? column : null)));
	let best = candidates[0]!;
	let bestScore = -1;
	for (const candidate of candidates) {
		const score = matchRows(source, table, candidate).filter(
			(match) => match !== undefined,
		).length;
		if (score > bestScore) [best, bestScore] = [candidate, score];
	}
	return best;
}

/** A source row as it reads in the edited table's columns. */
function projectedKey(row: TableRow, mapping: readonly (number | null)[]) {
	return JSON.stringify(
		trimmedKeys(
			mapping.map((column) =>
				column === null ? EMPTY_CELL : (row.keys[column] ?? EMPTY_CELL),
			),
		),
	);
}

/** For each row of `table`, the source row that says the same, if any. */
function matchRows(
	source: TableSource,
	table: TableSource,
	mapping: readonly (number | null)[],
): (number | undefined)[] {
	const unused = new Map<string, number[]>();
	source.rows.forEach((row, index) => {
		const key = projectedKey(row, mapping);
		unused.set(key, [...(unused.get(key) ?? []), index]);
	});
	return table.rows.map((row, index) => {
		const candidates = unused.get(JSON.stringify(trimmedKeys(row.keys)));
		if (!candidates?.length) return undefined;
		// The row in the same place first, so identical rows keep their own.
		const at = candidates.includes(index) ? candidates.indexOf(index) : 0;
		return candidates.splice(at, 1)[0];
	});
}

/**
 * The edited table written the way its source is: rows that say what a
 * source row said keep its spelling, and rows the edit made follow the
 * source's pipes and spacing and each line's container prefix.
 */
function restoredTable(source: TableSource, table: TableSource): string {
	const sourceRows = source.rows.map((row) => row.text);
	// A table padded so its columns line up is re-aligned as a whole when a
	// cell changes, as before. Padding is space beside text: the two spaces
	// of an empty cell pad nothing.
	const aligned =
		new Set(
			[...sourceRows, source.delimiter.text].map(
				(line) => line.trimEnd().length,
			),
		).size === 1 &&
		sourceRows.some((row) => /[^\s|] {2,}\||\| {2,}[^\s|]/.test(row));
	const continuation = source.delimiter.prefix;
	// A row keeps the prefix it had; the header's is the text before the
	// table, so a row that was the header, or is new, takes the delimiter's.
	const prefixOf = (row: number | undefined) =>
		row !== undefined && row > 0
			? (source.rows[row]?.prefix ?? continuation)
			: continuation;
	const lines = (
		rows: readonly { prefix: string; text: string }[],
		delimiter: string,
	) =>
		[
			rows[0]!.text,
			continuation + delimiter,
			...rows.slice(1).map((row) => row.prefix + row.text),
		].join(source.eol);
	if (aligned) {
		const sameShape =
			table.rows.length === source.rows.length && table.width === source.width;
		return lines(
			table.rows.map((row, index) => ({
				prefix: prefixOf(index),
				text: sameShape
					? withExcess(row.text, source.rows[index]!.excess, true)
					: row.text,
			})),
			table.delimiter.text,
		);
	}
	const mapping = columnMapping(source, table);
	const identity =
		table.width === source.width &&
		mapping.every((column, index) => column === index);
	const matched = matchRows(source, table, mapping);
	// An edited row stands where its old self stood: when as many source
	// rows are left over as rows are new, they pair up in order.
	const leftOver = source.rows.flatMap((_, index) =>
		matched.includes(index) ? [] : [index],
	);
	const unmatched = table.rows.flatMap((_, index) =>
		matched[index] === undefined ? [index] : [],
	);
	const paired = [...matched];
	if (leftOver.length === unmatched.length)
		unmatched.forEach((index, order) => {
			paired[index] = leftOver[order];
		});
	const header = source.rows[0]!.text;
	const style = {
		outer: header.startsWith("|"),
		padded: /\s\||\|\s/.test(header),
	};
	const rows = table.rows.map((row, index) => {
		const pair = paired[index];
		if (pair === undefined)
			return { prefix: continuation, text: formatRow(row.cells, style) };
		const old = source.rows[pair]!;
		if (identity && matched[index] !== undefined)
			return { prefix: prefixOf(pair), text: old.text };
		// Each cell that says what it said keeps its spelling.
		const cells = row.cells.map((cell, column) => {
			const from = mapping[column];
			return from !== null &&
				from !== undefined &&
				old.keys[from] === row.keys[column]
				? (old.cells[from] ?? cell)
				: cell;
		});
		// A short row stays short: its missing cells were never written.
		if (old.cells.length < source.width)
			while (cells.length > 1 && cells.at(-1) === "") cells.pop();
		return {
			prefix: prefixOf(pair),
			text: withExcess(formatRow(cells, style), old.excess, style.padded),
		};
	});
	const delimiter =
		identity && JSON.stringify(table.align) === JSON.stringify(source.align)
			? source.delimiter.text
			: delimiterLike(source, table.align, mapping);
	return lines(rows, delimiter);
}

/** `row` with the cells past the header's width that followed it. */
function withExcess(row: string, excess: string, padded: boolean): string {
	if (!excess) return row;
	const base = row.replace(/\|[\t ]*$/, "");
	return base + (padded && !/\s$/.test(base) ? " " : "") + excess;
}

/**
 * A row of `cells` with the table's pipes and spacing. A row without outer
 * pipes needs text at both ends, or its first or last pipe would read as
 * an outer one; such a row gets them.
 */
function formatRow(
	cells: readonly string[],
	style: { readonly outer: boolean; readonly padded: boolean },
): string {
	const inner = cells.join(style.padded ? " | " : "|");
	if (!style.outer && cells.length > 1 && cells[0] && cells.at(-1))
		return inner;
	return style.padded ? `| ${inner} |` : `|${inner}|`;
}

type Align = "left" | "right" | "center" | null;

/**
 * A delimiter row for `align` spelled the way the source spells its own:
 * a column that kept its alignment keeps its marker, a new one takes the
 * marker the source uses for that alignment, with the source's pipes and
 * spaces.
 */
function delimiterLike(
	source: TableSource,
	align: readonly Align[],
	mapping: readonly (number | null)[],
): string {
	const text = source.delimiter.text.trim();
	const cells = text.replace(/^\|/, "").replace(/\|$/, "").split("|");
	const spelling = new Map<Align, string>();
	cells.forEach((cell, index) => {
		const cellAlign = source.align[index] ?? null;
		if (!spelling.has(cellAlign) && /^\s*:?-+:?\s*$/.test(cell))
			spelling.set(cellAlign, cell.trim());
	});
	const markers = align.map((cellAlign, column) => {
		const from = mapping[column];
		if (
			from !== null &&
			from !== undefined &&
			(source.align[from] ?? null) === (cellAlign ?? null) &&
			/^\s*:?-+:?\s*$/.test(cells[from] ?? "")
		)
			return cells[from]!.trim();
		return (
			spelling.get(cellAlign ?? null) ??
			(cellAlign === "left"
				? ":--"
				: cellAlign === "right"
					? "--:"
					: cellAlign === "center"
						? ":-:"
						: "---")
		);
	});
	const spaced = cells.some((cell) => /^\s/.test(cell));
	const inner = markers.join(spaced ? " | " : "|");
	if (!text.startsWith("|") && markers.length > 1) return inner;
	return spaced ? `| ${inner} |` : `|${inner}|`;
}

/** Re-emitted blocks use LF; a CRLF file keeps CRLF throughout. */
function matchLineEndings(original: string, text: string): string {
	if (!original.includes("\r\n")) return text;
	return text.replace(/\r?\n/g, "\r\n");
}
