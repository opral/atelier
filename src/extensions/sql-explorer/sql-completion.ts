import {
	snippet,
	type Completion,
	type CompletionContext,
	type CompletionResult,
} from "@codemirror/autocomplete";
import {
	keywordCompletionSource,
	PostgreSQL,
	schemaCompletionSource,
	type SQLNamespace,
} from "@codemirror/lang-sql";
import type { Schema, TableFunction } from "./schema";

export function functionDescription(name: string): string {
	return (
		(
			{
				lix_history:
					"Changes introduced by retained mainline commits. Filter lixcol_commit_is_checkpoint for checkpoints.",
				lix_log:
					"Retained mainline commits, with checkpoint flags and first parents.",
				lix_as_of: "Tracked state of a relation at a specific commit.",
				lix_diff:
					"Compare a relation across commits. Defaults to working baseline → active head.",
				lix_commit_ancestry:
					"Reachable commits and their depth from the active head or a specified commit.",
				lix_create_checkpoint:
					"Creates a checkpoint. This function changes repository state.",
			} as Record<string, string>
		)[name] ?? "Table function provided by this database."
	);
}

export function functionTemplate(fn: TableFunction): string {
	const signature = fn.signature.split("|")[0]!.trim().slice(1, -1);
	const args = signature
		? signature.split(",").map((arg) => {
				const name = arg.trim().split(/\s+/)[0]!;
				return `'\${${name}}'`;
			})
		: [];
	return `${fn.name}(${args.join(", ")})`;
}

/** SQL lexical tokens preserve quoted literals/identifiers and discard no context. */
export type SqlLexeme = {
	text: string;
	from: number;
	to: number;
	kind: "word" | "string" | "identifier" | "comment" | "symbol";
};
export function sqlLexemes(text: string): SqlLexeme[] {
	const pattern =
		/--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:[^']|'')*(?:'|$)|"(?:[^"]|"")*(?:"|$)|[A-Za-z_][\w$]*|[^\s]/g;
	return [...text.matchAll(pattern)].map((match) => {
		const value = match[0];
		return {
			text: value,
			from: match.index,
			to: match.index + value.length,
			kind:
				value.startsWith("--") || value.startsWith("/*")
					? "comment"
					: value.startsWith("'")
						? "string"
						: value.startsWith('"')
							? "identifier"
							: /^[A-Za-z_]/.test(value)
								? "word"
								: "symbol",
		};
	});
}

export function activeFunction(
	text: string,
	pos: number,
	schema: Schema | null,
) {
	const tokens = sqlLexemes(text.slice(0, pos)).filter(
		(token) => token.kind !== "comment",
	);
	const stack: { name: string; from: number; argument: number }[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		if (token.text === "(")
			stack.push({
				name: tokens[i - 1]?.text.toLowerCase() ?? "",
				from: token.to,
				argument: 0,
			});
		else if (token.text === ")") stack.pop();
		else if (token.text === "," && stack.length)
			stack[stack.length - 1]!.argument++;
	}
	const call = stack[stack.length - 1];
	const fn = schema?.functions.find(
		(candidate) => candidate.name === call?.name,
	);
	return fn && call ? { ...call, fn } : null;
}

function functionCompletion(fn: TableFunction): Completion {
	return {
		label: fn.name,
		type: "function",
		detail: "Table function",
		info: `${fn.name}${fn.signature}\n${functionDescription(fn.name)}`,
		apply: snippet(functionTemplate(fn)),
	};
}

/** Resolve SELECT-list columns from the same query block, including FROM after the cursor. */
function selectListColumns(
	text: string,
	pos: number,
	schema: Schema,
): Completion[] {
	let depth = 0;
	const tokens = sqlLexemes(text)
		.filter((t) => t.kind !== "comment")
		.map((token) => {
			if (token.text === ")") depth--;
			const entry = { ...token, depth };
			if (token.text === "(") depth++;
			return entry;
		});
	const start =
		tokens.filter((t) => t.text === ";" && t.to <= pos).at(-1)?.to ?? 0;
	const end =
		tokens.find((t) => t.text === ";" && t.from >= pos)?.from ?? text.length;
	const selects = tokens.filter(
		(t) =>
			t.kind === "word" &&
			t.text.toUpperCase() === "SELECT" &&
			t.from >= start &&
			t.to <= pos,
	);
	for (const select of selects.reverse()) {
		const blockEnd =
			tokens.find(
				(t) =>
					t.from > select.from &&
					(t.depth < select.depth ||
						(t.depth === select.depth &&
							/^(UNION|EXCEPT|INTERSECT)$/.test(t.text.toUpperCase()))),
			)?.from ?? end;
		if (pos >= blockEnd) continue;
		const block = tokens.filter(
			(t) =>
				t.from > select.from &&
				t.from < Math.min(blockEnd, end) &&
				t.depth === select.depth,
		);
		const from = block.findIndex(
			(t) => t.kind === "word" && t.text.toUpperCase() === "FROM",
		);
		if (from < 0 || pos > block[from]!.from) return [];
		const options = new Map<string, Completion>();
		for (let i = from; i < block.length; i++) {
			const token = block[i]!;
			if (
				/^(WHERE|GROUP|HAVING|ORDER|LIMIT|OFFSET|WINDOW)$/.test(
					token.text.toUpperCase(),
				)
			)
				break;
			if (!/^(FROM|JOIN|,)$/.test(token.text.toUpperCase())) continue;
			let source = block[++i];
			if (!source || !["word", "identifier"].includes(source.kind)) continue;
			const identifier = (value: string) =>
				value.startsWith('"')
					? value.slice(1, -1).replaceAll('""', '"')
					: value.toLowerCase();
			if (block[i + 1]?.text === ".") {
				if (identifier(source.text) !== "public") continue;
				source = block[(i += 2)];
				if (!source) continue;
			}
			const name = identifier(source.text);
			const fn = schema.functions.find((candidate) => candidate.name === name);
			const sourceStart = source.from;
			const argument =
				tokens[tokens.findIndex((t) => t.from === sourceStart) + 2];
			const relation =
				argument?.kind === "string"
					? argument.text.slice(1, -1).replaceAll("''", "'")
					: null;
			const columns =
				block[i + 1]?.text === "("
					? (fn?.relations.get(null) ?? fn?.relations.get(relation))
					: schema.tables.get(name);
			for (const column of columns ?? []) {
				options.set(column.name, {
					label: column.name,
					type: "property",
					detail: column.type,
					boost: 10,
				});
			}
		}
		return [...options.values()];
	}
	return [];
}

export function createSqlCompletion(schema: Schema | null) {
	const namespace: Record<string, SQLNamespace> = {};
	for (const table of schema?.baseTables ?? []) {
		namespace[table.name] = {
			self: { label: table.name, type: "type", detail: "Table" },
			children: (schema?.tables.get(table.name) ?? []).map((c) => ({
				label: c.name,
				type: "property",
				detail: c.type,
			})),
		};
	}
	const columnsSource = schemaCompletionSource({
		dialect: PostgreSQL,
		schema: namespace,
	});
	const keywordsSource = keywordCompletionSource(PostgreSQL, true);
	return (context: CompletionContext): CompletionResult | null => {
		const text = context.state.doc.toString();
		const before = text.slice(0, context.pos);
		const tokens = sqlLexemes(before);
		const last = tokens[tokens.length - 1];
		if (
			last?.kind === "comment" &&
			(last.text.startsWith("--")
				? !before.slice(last.to).includes("\n")
				: !last.text.endsWith("*/"))
		)
			return null;
		const call = activeFunction(text, context.pos, schema);
		if (last?.kind === "string" && last.to === context.pos) {
			// Only the literal relation argument receives string completion.
			const unfinished =
				last.text === "'" ||
				!last.text.endsWith("'") ||
				(last.text.match(/'/g)?.length ?? 0) % 2 !== 0;
			if (
				!unfinished ||
				!call ||
				call.argument !== 0 ||
				!call.fn.relations.size ||
				call.fn.relations.has(null)
			)
				return null;
			return {
				from: last.from + 1,
				options: [...call.fn.relations.keys()]
					.filter((name): name is string => name !== null)
					.map((name) => ({
						label: name,
						type: "type",
						detail: "Relation",
						apply: name.replaceAll("'", "''"),
					})),
				validFor: /^[\w$]*$/,
			};
		}
		const word = context.matchBefore(/[\w$]*/)!;
		const prefix = before.slice(0, word.from);
		const significant = sqlLexemes(prefix).filter((t) => t.kind !== "comment");
		const preceding = significant.at(-1)?.text.toUpperCase();
		if (preceding === "FROM" || preceding === "JOIN") {
			return {
				from: word.from,
				options: [
					...Object.keys(namespace).map((label) => ({
						label,
						type: "type",
						detail: "Table",
					})),
					...(schema?.functions ?? []).map(functionCompletion),
				],
				validFor: /^[\w$]*$/,
			};
		}
		// Function aliases have relation-specific result columns, unlike ordinary table aliases.
		const qualified = before.match(/([A-Za-z_][\w$]*)\.([\w$]*)$/);
		if (qualified && schema) {
			const alias = qualified[1]!;
			const statements = sqlLexemes(text);
			const start =
				statements.filter((t) => t.text === ";" && t.to <= context.pos).at(-1)
					?.to ?? 0;
			const end =
				statements.find((t) => t.text === ";" && t.from >= context.pos)?.from ??
				text.length;
			const allTokens = statements.filter(
				(t) => t.kind !== "comment" && t.from >= start && t.to <= end,
			);
			for (let i = 0; i < allTokens.length; i++) {
				if (!/^(FROM|JOIN)$/i.test(allTokens[i]!.text)) continue;
				const fn = schema.functions.find(
					(candidate) =>
						candidate.name === allTokens[i + 1]?.text.toLowerCase(),
				);
				if (!fn || allTokens[i + 2]?.text !== "(") continue;
				const relation =
					allTokens[i + 3]?.kind === "string"
						? allTokens[i + 3]!.text.slice(1, -1).replaceAll("''", "'")
						: null;
				let j = i + 3,
					depth = 1;
				for (; j < allTokens.length && depth; j++) {
					if (allTokens[j]!.text === "(") depth++;
					if (allTokens[j]!.text === ")") depth--;
				}
				if (allTokens[j]?.text.toUpperCase() === "AS") j++;
				if (allTokens[j]?.text !== alias) continue;
				return {
					from: context.pos - qualified[2]!.length,
					options: (
						fn.relations.get(null) ??
						fn.relations.get(relation) ??
						[]
					).map((c) => ({
						label: c.name,
						type: "property",
						detail: c.type,
					})),
					validFor: /^[\w$]*$/,
				};
			}
		}
		const surfaceColumns =
			!qualified && schema ? selectListColumns(text, context.pos, schema) : [];
		// A resolved SELECT list completes its source columns, not the global SQL dictionary.
		if (surfaceColumns.length) {
			return {
				from: word.from,
				options: surfaceColumns,
				validFor: /^[\w$]*$/,
			};
		}
		if (!word.text && !context.explicit && preceding !== ".") return null;
		const columns = columnsSource(context) as CompletionResult | null;
		const keywords = keywordsSource(context) as CompletionResult | null;
		if (qualified || preceding === ".") return columns;
		return {
			from: columns?.from ?? word.from,
			options: [...(columns?.options ?? []), ...(keywords?.options ?? [])],
			validFor: /^[\w$]*$/,
		};
	};
}
