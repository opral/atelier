import type { CommitSpan, Lix } from "@lix-js/sdk";
import { decodeFileDataToText } from "@/lib/decode-file-data";
import {
	parseFrontmatterSource,
	stringifyFrontmatterValue,
	type FrontmatterRecord,
} from "./frontmatter-value";
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

/** The YAML this file's frontmatter block holds right now, without its fences. */
function frontmatterSource(markdown: string): string {
	const block = frontmatterBlock(markdown);
	if (!block) return "";
	return markdown
		.slice(block.start, block.end)
		.replace(/^---[^\n]*\n?/, "")
		.replace(/\n?---[^\n]*$/, "");
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
 * The edit this panel made, applied to the frontmatter the file has now.
 *
 * The panel renders a property from a projection and hands back the whole YAML
 * block, so writing that block verbatim republishes every property it was
 * showing — including the ones somebody else has changed since, which it would
 * put back to the value the projection froze. Only the fields this edit
 * actually touched are carried over; every other field is the file's own.
 *
 * Returns null when the three sources cannot all be read as plain key-value
 * YAML, which is the one case where "which fields did this edit touch" has no
 * answer and the write has to say so rather than guess.
 */
export function mergeFrontmatterEdit(args: {
	readonly base: string;
	readonly next: string;
	readonly current: string;
}): string | null {
	const base = parseFrontmatterSource(args.base);
	const next = parseFrontmatterSource(args.next);
	const current = parseFrontmatterSource(args.current);
	if (!base.value || !next.value || !current.value) return null;
	const baseValue = base.value;
	const nextValue = next.value;
	const same = (left: unknown, right: unknown) =>
		JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
	const merged: FrontmatterRecord = { ...current.value };
	// A field the edit removed goes.
	for (const key of Object.keys(baseValue)) {
		if (!(key in nextValue)) delete merged[key];
	}
	// A field the edit changed takes the edited value; one it only carried
	// along stays exactly as the file has it, deletions included.
	for (const [key, value] of Object.entries(nextValue)) {
		if (key in baseValue && same(baseValue[key], value)) continue;
		merged[key] = value;
	}
	return Object.keys(merged).length === 0
		? ""
		: stringifyFrontmatterValue(merged);
}

/**
 * Writes one frontmatter edit into the file, through the same
 * {@link upsertMarkdownFile} call the live editor's persistence makes. The
 * document below the frontmatter comes from the file as it stands, so a
 * property edit never carries a stale body back over someone else's change —
 * and with `baseSource`, neither does the YAML block above it.
 *
 * The receipt names the commit the write produced, so a review that is open
 * over this file can recognise the edit as its reviewer's own.
 */
export async function writeMarkdownFrontmatter(args: {
	readonly lix: Lix;
	readonly fileId: string;
	readonly source: string;
	/** The YAML the panel's value was edited from, when the panel knows it. */
	readonly baseSource?: string;
	readonly originKey?: string;
}): Promise<CommitSpan | null> {
	const { lix, fileId, source, baseSource, originKey } = args;
	const result = await lix.execute(
		"SELECT content FROM lix_file WHERE id = $1",
		[fileId],
	);
	const row = result.rows[0];
	if (!row) {
		throw new Error("Could not save because the file no longer exists.");
	}
	const markdown = decodeFileDataToText(row.content);
	const currentSource = frontmatterSource(markdown);
	let writtenSource = source;
	if (baseSource !== undefined && baseSource !== currentSource) {
		const merged = mergeFrontmatterEdit({
			base: baseSource,
			next: source,
			current: currentSource,
		});
		if (merged === null) {
			throw new Error(
				"These properties changed somewhere else while you were editing them. Reopen the file to see them.",
			);
		}
		writtenSource = merged;
	}
	const next = replaceMarkdownFrontmatter(markdown, writtenSource);
	if (next === markdown) return null;
	const receipt = await upsertMarkdownFile({
		lix,
		fileId,
		markdown: next,
		...(originKey ? { originKey } : {}),
	});
	if (!receipt.written) {
		throw new Error("Could not save because the file no longer exists.");
	}
	return receipt.commit;
}

/**
 * Serializes a field's writes.
 *
 * Typing a value emits one edit per keystroke; they must reach the file in
 * order, and an edit that arrives while a write is in flight supersedes the
 * one waiting behind it rather than queueing another round trip.
 *
 * The caller gets back the span from the first of the writes it waited on to
 * the last, so a run of coalesced keystrokes reads as the one transition it
 * was. The base a superseded edit was made from is the base the write that
 * replaces it carries, so nothing that was typed is measured against a state
 * that was never written.
 */
export function createMarkdownFrontmatterWriter(args: {
	readonly lix: Lix;
	readonly fileId: string;
	readonly originKey?: string;
}): (source: string, baseSource?: string) => Promise<CommitSpan | null> {
	let pending: { source: string; baseSource?: string } | null = null;
	let running: Promise<CommitSpan | null> | null = null;
	const drain = async (): Promise<CommitSpan | null> => {
		let span: CommitSpan | null = null;
		while (pending !== null) {
			const edit = pending;
			pending = null;
			const written = await writeMarkdownFrontmatter({
				...args,
				source: edit.source,
				...(edit.baseSource !== undefined
					? { baseSource: edit.baseSource }
					: {}),
			});
			if (written) {
				span = span ? { before: span.before, after: written.after } : written;
			}
		}
		return span;
	};
	// The drain only ends with nothing pending, and nothing can become pending
	// between that check and this one: an edit arrives from an event, never
	// from the microtask that settles the write.
	const schedule = (): Promise<CommitSpan | null> => {
		const started = drain().finally(() => {
			if (running === started) running = null;
		});
		running = started;
		return started;
	};
	return (source: string, baseSource?: string) => {
		pending = {
			source,
			// The oldest unwritten edit's base is the one the file was last
			// known at; a later keystroke's base is a state never written.
			...(pending?.baseSource !== undefined
				? { baseSource: pending.baseSource }
				: baseSource !== undefined
					? { baseSource }
					: {}),
		};
		return running ?? schedule();
	};
}
