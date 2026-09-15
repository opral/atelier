import type { Lix } from "@lix-js/sdk";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import { parseMarkdownSourceRaw } from "./markdown";
import { upsertMarkdownFile } from "./upsert-markdown-file";

type FrontmatterBlock = { readonly start: number; readonly end: number };

/**
 * The leading YAML block, located by the same parser that decides what counts
 * as frontmatter. Offsets, not a hand-rolled delimiter match, so replacing a
 * field leaves every byte of the document below it untouched.
 */
function frontmatterBlock(markdown: string): FrontmatterBlock | null {
	const first = parseMarkdownSourceRaw(markdown).children[0];
	if (first?.type !== "yaml") return null;
	const start = first.position?.start?.offset;
	const end = first.position?.end?.offset;
	if (typeof start !== "number" || typeof end !== "number") return null;
	return { start, end };
}

/** Everything below the frontmatter, with the blank line it left behind. */
function markdownBody(markdown: string): string {
	const block = frontmatterBlock(markdown);
	return (block ? markdown.slice(block.end) : markdown).replace(
		/^(\r?\n)+/,
		"",
	);
}

/**
 * The file with its frontmatter block replaced by this YAML, in the shape the
 * Markdown serializer writes it. Empty source removes the block entirely.
 */
export function replaceMarkdownFrontmatter(
	markdown: string,
	source: string,
): string {
	const block = frontmatterBlock(markdown);
	const yaml = source.trim().length === 0 ? null : `---\n${source}\n---`;
	if (!block) return yaml === null ? markdown : `${yaml}\n\n${markdown}`;
	if (yaml === null) {
		return markdown.slice(0, block.start) + markdownBody(markdown);
	}
	return markdown.slice(0, block.start) + yaml + markdown.slice(block.end);
}

/**
 * Whether two revisions of one file differ in their frontmatter alone — the
 * shape of a property-panel edit, and nothing else.
 */
export function differsOnlyInFrontmatter(left: string, right: string): boolean {
	if (left === right) return false;
	return markdownBody(left) === markdownBody(right);
}

/**
 * Writes one frontmatter edit into the file, through the same
 * {@link upsertMarkdownFile} call the live editor's persistence makes. The
 * document below the frontmatter comes from the file as it stands, so a
 * property edit never carries a stale body back over someone else's change.
 */
export async function writeMarkdownFrontmatter(args: {
	readonly lix: Lix;
	readonly fileId: string;
	readonly source: string;
	readonly originKey?: string;
}): Promise<void> {
	const { lix, fileId, source, originKey } = args;
	const result = await lix.execute(
		"SELECT content FROM lix_file WHERE id = $1",
		[fileId],
	);
	const row = result.rows[0];
	if (!row) {
		throw new Error("Could not save because the file no longer exists.");
	}
	const markdown = decodeFileDataToText(row.content);
	const next = replaceMarkdownFrontmatter(markdown, source);
	if (next === markdown) return;
	const written = await upsertMarkdownFile({
		lix,
		fileId,
		markdown: next,
		...(originKey ? { originKey } : {}),
	});
	if (!written) {
		throw new Error("Could not save because the file no longer exists.");
	}
}

/**
 * Serializes a field's writes. Typing a value emits one edit per keystroke;
 * they must reach the file in order, and an edit that arrives while a write
 * is in flight supersedes the one waiting behind it rather than queueing
 * another round trip.
 */
export function createMarkdownFrontmatterWriter(args: {
	readonly lix: Lix;
	readonly fileId: string;
	readonly originKey?: string;
}): (source: string) => Promise<void> {
	let pending: string | null = null;
	let running: Promise<void> | null = null;
	const drain = async (): Promise<void> => {
		while (pending !== null) {
			const source = pending;
			pending = null;
			await writeMarkdownFrontmatter({ ...args, source });
		}
	};
	// The drain only ends with nothing pending, and nothing can become pending
	// between that check and this one: an edit arrives from an event, never
	// from the microtask that settles the write.
	const schedule = (): Promise<void> => {
		const started = drain().finally(() => {
			if (running === started) running = null;
		});
		running = started;
		return started;
	};
	return (source: string) => {
		pending = source;
		return running ?? schedule();
	};
}
