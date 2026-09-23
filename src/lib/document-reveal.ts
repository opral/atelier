/**
 * A request, carried in a document view's state as `reveal`, to bring one
 * row of the file into view: the conversation view opens a Markdown file at
 * a commented block (`rowId`, a `markdown_node` id) and a CSV file at a row
 * (`rowNumber`, data rows counted from 1; 0 is the header record).
 *
 * `at` makes each request distinct, so opening the same row twice reveals
 * it twice; a view consumes one request once.
 */
export type DocumentReveal = {
	readonly key: string;
	readonly rowId: string | null;
	readonly rowNumber: number | null;
	readonly conversationId: string | null;
};

export type DocumentRevealState = {
	readonly conversationId?: string | null;
	readonly rowId?: string | null;
	readonly rowNumber?: number | null;
	readonly at: number;
};

export function documentRevealState(
	reveal: Omit<DocumentRevealState, "at">,
): DocumentRevealState {
	return { ...reveal, at: Date.now() };
}

/** The request in a view's state, or null when there is none. */
export function documentReveal(state: unknown): DocumentReveal | null {
	if (!state || typeof state !== "object") return null;
	const reveal = (state as { reveal?: unknown }).reveal;
	if (!reveal || typeof reveal !== "object") return null;
	const value = reveal as Record<string, unknown>;
	const rowId = typeof value.rowId === "string" ? value.rowId : null;
	const rowNumber =
		typeof value.rowNumber === "number" && Number.isInteger(value.rowNumber)
			? value.rowNumber
			: null;
	if (rowId === null && rowNumber === null) return null;
	return {
		key: `${String(value.at ?? "")}:${rowId ?? ""}:${rowNumber ?? ""}`,
		rowId,
		rowNumber,
		conversationId:
			typeof value.conversationId === "string" ? value.conversationId : null,
	};
}
