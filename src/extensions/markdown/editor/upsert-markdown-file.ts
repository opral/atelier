import type { CommitSpan, Lix, SqlParam } from "@lix-js/sdk";

type MarkdownFileWriteArgs = {
	lix: Lix;
	fileId: string;
	markdown: string;
	originKey?: string;
};

/**
 * What one write to a Markdown file leaves behind.
 *
 * The span is the receipt the engine issues for the write: the commit the
 * workspace was on before it and the commit it produced. A surface that wrote
 * can therefore tell its own commit apart from anybody else's without asking
 * the workspace a second question, which is a question whose answer changes
 * between the asking and the reading.
 */
export type MarkdownFileWriteReceipt = {
	/** False when the file no longer exists; nothing was written. */
	readonly written: boolean;
	/** The durable transition this write produced, when one was reported. */
	readonly commit: CommitSpan | null;
};

export async function upsertMarkdownFile(
	args: MarkdownFileWriteArgs,
): Promise<MarkdownFileWriteReceipt> {
	const { lix, fileId, markdown, originKey } = args;
	const data = new TextEncoder().encode(markdown);
	const params: SqlParam[] = [data, fileId];
	const result = await lix.execute(
		"UPDATE lix_file SET content = $1 WHERE id = $2",
		params,
		originKey ? { originKey } : undefined,
	);
	return {
		written: result.rowsAffected > 0,
		commit: result.commit ?? null,
	};
}
