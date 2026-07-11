import { parse, stringify } from "yaml";

export type FrontmatterRecord = Record<string, unknown>;

export type ParsedFrontmatter =
	| { readonly value: FrontmatterRecord; readonly error: null }
	| { readonly value: null; readonly error: string };

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
