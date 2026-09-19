/**
 * Where the keyboard lands after a structural edit.
 *
 * A grid that clears its selection to rebuild must put it back somewhere, and
 * "somewhere" is the column or row the reader just acted on — not the table's
 * corner, which reads as the edit having happened elsewhere.
 */

/**
 * The line — column or row — that takes the place of the first one deleted.
 * Both axes ask the same question, so they ask it in one place.
 */
export function anchorAfterDelete(
	deleted: readonly number[],
	count: number,
): number {
	if (deleted.length === 0) return 0;
	const remaining = count - deleted.length;
	// Deleting the last lines leaves the one before them; deleting them all
	// leaves the corner, which is all there is.
	return Math.max(0, Math.min(Math.min(...deleted), remaining - 1));
}
