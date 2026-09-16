/**
 * Edits a surface is holding but has not written yet.
 *
 * A field that writes as you type holds the last keystrokes for a moment
 * before they land, which keeps the document from re-rendering under the
 * caret. For the reader there is no such moment: what they typed is in the
 * document the instant they typed it, and a command they give next —
 * Checkpoint, Undo — is a command about that document.
 *
 * So a command that acts on documents settles what the surfaces are holding
 * first, and only then reads the workspace. Registering is what a surface does
 * while it holds something — or while a write it has already sent is still on
 * its way; settling is what a command does before it acts.
 */
type SettleUnsettledEdit = () => void | PromiseLike<void>;

const unsettled = new Set<SettleUnsettledEdit>();

/** Registers a holder; the returned function unregisters it. */
export function registerUnsettledEdit(settle: SettleUnsettledEdit): () => void {
	unsettled.add(settle);
	return () => {
		unsettled.delete(settle);
	};
}

/**
 * Writes out everything every registered surface is holding, and waits for
 * everything they have already sent.
 *
 * Returns a promise only when a write actually started. Holding nothing is the
 * ordinary case — nobody is mid-word when most commands are given — and it
 * must not cost the command a turn of the event loop it did not take before.
 *
 * Settling registers nothing new: a surface that has just written holds
 * nothing. One pass over a copy of the set is the whole job.
 */
export function settleUnsettledEdits(): Promise<void> | undefined {
	const writes: PromiseLike<void>[] = [];
	for (const settle of [...unsettled]) {
		try {
			const write = settle();
			if (write) writes.push(write);
		} catch {
			// A failed write reports itself on the surface that made it; a
			// command must not be blocked from acting on everything else.
		}
	}
	if (writes.length === 0) return undefined;
	return Promise.all(
		// Same reason: the surface shows its own failure.
		writes.map((write) => Promise.resolve(write).catch(() => {})),
	).then(() => undefined);
}
