import type { CommitSpan, Lix, LixTransaction, SqlParam } from "@lix-js/sdk";

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

/**
 * Work that has to land in the same transaction as a file write: rows other
 * than the file's that refer to the rows the write re-derives. `before`
 * runs ahead of the write, `after` once the plugin has re-projected the
 * file, so readers only ever see both sides together.
 */
export type MarkdownFileWriteParticipant = {
	readonly before: (transaction: LixTransaction) => Promise<void>;
	readonly after: (transaction: LixTransaction) => Promise<void>;
};

/** `upsertMarkdownFile`, with a participant's work in one transaction. */
export async function upsertMarkdownFileWith(
	args: MarkdownFileWriteArgs & {
		readonly participant: MarkdownFileWriteParticipant;
	},
): Promise<MarkdownFileWriteReceipt> {
	const { lix, fileId, markdown, originKey, participant } = args;
	const transaction = await lix.beginTransaction();
	try {
		await participant.before(transaction);
		const result = await transaction.execute(
			"UPDATE lix_file SET content = $1 WHERE id = $2",
			[new TextEncoder().encode(markdown), fileId],
			originKey ? { originKey } : undefined,
		);
		if (result.rowsAffected === 0) {
			await transaction.rollback();
			return { written: false, commit: null };
		}
		await participant.after(transaction);
		const receipt = await transaction.commit();
		return { written: true, commit: receipt.commit ?? null };
	} catch (error) {
		await transaction.rollback().catch(() => {});
		throw error;
	}
}
