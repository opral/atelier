import { parse, stringify } from "yaml";

export type FrontmatterRecord = Record<string, unknown>;

export type ParsedFrontmatter =
	| { readonly value: FrontmatterRecord; readonly error: null }
	| { readonly value: null; readonly error: string };

export type FrontmatterRecovery = {
	/** YAML before the likely closing fence. */
	readonly yaml: string;
	/** Markdown accidentally captured after the likely closing fence. */
	readonly body: string;
	/** Line number within the raw YAML shown to the user. */
	readonly line: number;
};

export function parseFrontmatterSource(source: string): ParsedFrontmatter {
	try {
		const parsed = source.trim().length === 0 ? {} : parse(source);
		if (
			parsed === null ||
			typeof parsed !== "object" ||
			Array.isArray(parsed)
		) {
			return {
				value: null,
				error: "Frontmatter must contain key-value fields.",
			};
		}
		return { value: parsed as FrontmatterRecord, error: null };
	} catch (error) {
		return {
			value: null,
			error:
				error instanceof Error ? error.message : "Invalid YAML frontmatter.",
		};
	}
}

/**
 * Suggest a repair only when a long dash line follows valid frontmatter and
 * the next block is unmistakably Markdown. A plain YAML parse error alone is
 * not enough evidence to move text out of metadata.
 */
export function suggestFrontmatterRecovery(
	source: string,
): FrontmatterRecovery | null {
	const lines = source.split("\n");
	let offset = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const rawLine = lines[index]!;
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		const nextOffset =
			offset + rawLine.length + (index < lines.length - 1 ? 1 : 0);
		if (/^-{4,}[ \t]*$/.test(line)) {
			const yaml = source.slice(0, offset).replace(/\r?\n$/, "");
			const parsed = parseFrontmatterSource(yaml);
			const body = source.slice(nextOffset);
			const firstBlock = body
				.split(/\r?\n/)
				.find((candidate) => candidate.trim().length > 0)
				?.trimStart();
			if (parsed.value && firstBlock && isClearMarkdownBlockStart(firstBlock)) {
				return { yaml, body, line: index + 1 };
			}
		}
		offset = nextOffset;
	}
	return null;
}

function isClearMarkdownBlockStart(line: string): boolean {
	return /^(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+|```|~~~)/.test(
		line,
	);
}

export function stringifyFrontmatterValue(value: FrontmatterRecord): string {
	return stringify(value, { lineWidth: 0 }).trimEnd();
}

export function frontmatterSourceFromInput(
	input: string | FrontmatterRecord | undefined,
): string {
	if (typeof input === "string") {
		return input
			.replace(/^---\s*\n?/, "")
			.replace(/\n?---\s*$/, "")
			.trim();
	}
	if (input === undefined) return "";
	return stringifyFrontmatterValue(input);
}
