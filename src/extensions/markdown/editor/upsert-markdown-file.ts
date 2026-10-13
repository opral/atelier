import type { CommitSpan, Lix, LixTransaction } from "@lix-js/sdk";
import { presentableDiff } from "@codemirror/merge";
import { ChangeSet, Text } from "@codemirror/state";
import { decodeFileDataToText } from "@/lib/decode-file-data";

type MarkdownFileWriteArgs = {
	lix: Lix;
	fileId: string;
	markdown: string;
	/** Source the editor actually edited, before any newer external writes. */
	baseMarkdown?: string;
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
	const { lix, fileId, markdown, baseMarkdown, originKey } = args;
	const options = originKey ? { originKey } : undefined;
	const data = new TextEncoder().encode(markdown);
	// Most saves still take one statement. A changed file must not turn text
	// the editor never saw into a deletion: rebase that edit atomically instead.
	const result = await lix.execute(
		baseMarkdown === undefined
			? "UPDATE lix_file SET content = $1 WHERE id = $2"
			: "UPDATE lix_file SET content = $1 WHERE id = $2 AND content = $3",
		baseMarkdown === undefined
			? [data, fileId]
			: [data, fileId, new TextEncoder().encode(baseMarkdown)],
		options,
	);
	if (result.rowsAffected > 0 || baseMarkdown === undefined)
		return { written: result.rowsAffected > 0, commit: result.commit ?? null };
	const receipt = await lix.transaction(async (transaction) =>
		writeMarkdownInTransaction(transaction, args),
	);
	return { written: receipt.value, commit: receipt.commit ?? null };
}

async function writeMarkdownInTransaction(
	transaction: LixTransaction,
	args: MarkdownFileWriteArgs,
): Promise<boolean> {
	const { fileId, baseMarkdown, originKey } = args;
	let markdown = args.markdown;
	if (baseMarkdown !== undefined) {
		const result = await transaction.execute(
			"SELECT content FROM lix_file WHERE id = $1",
			[fileId],
		);
		if (!result.rows[0]) return false;
		const current = decodeFileDataToText(result.rows[0].content);
		if (current !== baseMarkdown && current !== markdown) {
			const local = presentableDiff(baseMarkdown, markdown, {
				scanLimit: 4096,
			});
			// Preserve independent external edits. A replacement of the same
			// source range remains this writer's explicit later replacement.
			const external = presentableDiff(baseMarkdown, current, {
				scanLimit: 4096,
			}).filter(
				(remote) =>
					!local.some(
						(edit) => remote.toA > edit.fromA && remote.fromA < edit.toA,
					),
			);
			const changes = (edits: typeof local, next: string) =>
				ChangeSet.of(
					edits.map((change) => ({
						from: change.fromA,
						to: change.toA,
						insert: next.slice(change.fromB, change.toB),
					})),
					baseMarkdown.length,
				);
			const remoteChanges = changes(external, current);
			markdown = changes(local, markdown)
				.map(remoteChanges)
				.apply(remoteChanges.apply(Text.of(baseMarkdown.split("\n"))))
				.toString();
		}
	}
	const result = await transaction.execute(
		"UPDATE lix_file SET content = $1 WHERE id = $2",
		[new TextEncoder().encode(markdown), fileId],
		originKey ? { originKey } : undefined,
	);
	return result.rowsAffected > 0;
}

/**
 * Work that has to land in the same transaction as a file write: rows other
 * than the file's that refer to the rows the write re-derives. `after` runs
 * once the plugin has re-projected the file, so readers only ever see both
 * sides together. Nothing needs to run before the write: a row the write
 * deletes leaves the rows that refer to it detached (Lix keeps them, their
 * reference no longer resolving), never deleted with it.
 */
export type MarkdownFileWriteParticipant = {
	readonly after: (transaction: LixTransaction) => Promise<void>;
	/** The transaction committed: `after`'s work is published. */
	readonly committed: () => void;
	/**
	 * The write went out without `after` (the transaction kept losing to
	 * concurrent writes): what it detached is still detached.
	 */
	readonly degraded: (cause: unknown) => void;
};

/** Attempts of the whole transaction before the last resort. */
const PARTICIPANT_ATTEMPTS = 4;

function isTransactionConflict(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "LIX_TRANSACTION_CONFLICT"
	);
}

/**
 * `upsertMarkdownFile`, with a participant's work in one transaction.
 *
 * An explicit transaction fails at commit when anything else wrote in the
 * meantime (a reply, an agent, another tab) and is not retried by Lix, so
 * the whole transaction is run again. If it keeps losing, the text is saved
 * with only the participant's last-resort statements, in one automatically
 * retried write; the participant is told. A transaction is pinned to the
 * branch it began on: when the handle has switched branches since, nothing
 * is written and the draft stays in the editor.
 */
export async function upsertMarkdownFileWith(
	args: MarkdownFileWriteArgs & {
		readonly participant: MarkdownFileWriteParticipant;
	},
): Promise<MarkdownFileWriteReceipt> {
	const { lix, participant } = args;
	const branchId = await lix.activeBranchId();
	const branchChanged = new Error(
		"Could not save because the branch changed while saving. Your draft is still in this editor.",
	);
	let cause: unknown = null;
	for (let attempt = 0; attempt < PARTICIPANT_ATTEMPTS; attempt++) {
		if (attempt > 0 && (await lix.activeBranchId()) !== branchId)
			throw branchChanged;
		const transaction = await lix.beginTransaction();
		try {
			const written = await writeMarkdownInTransaction(transaction, args);
			if (!written) {
				await transaction.rollback();
				return { written: false, commit: null };
			}
			await participant.after(transaction);
			const receipt = await transaction.commit();
			participant.committed();
			return { written: true, commit: receipt.commit ?? null };
		} catch (error) {
			await transaction.rollback().catch(() => {});
			cause = error;
			if (!isTransactionConflict(error)) break;
		}
	}
	// The last resort: the text on its own, automatically retried. What it
	// detaches the participant puts back afterwards.
	if ((await lix.activeBranchId()) !== branchId) throw branchChanged;
	const receipt = await upsertMarkdownFile(args);
	participant.degraded(cause);
	return receipt;
}
