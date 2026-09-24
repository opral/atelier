import type { AtelierExtensionView, AtelierViewsApi } from "@/extension-api";

/**
 * A request, carried in a document view's state as `reveal`, to bring one
 * row of the file into view: the conversation view opens a Markdown file at
 * a commented block (`rowId`, a `markdown_node` id) and a CSV file at a row
 * (`rowNumber`, data rows counted from 1; 0 is the header record).
 *
 * `at` makes each request distinct, so opening the same row twice reveals
 * it twice. A request is for the moment it was made: a view consumes it
 * once (and clears it from its state), and one older than
 * `DOCUMENT_REVEAL_WINDOW_MS` (a view remounted or a workspace restored
 * later) is not a request any more.
 */
export type DocumentReveal = {
	readonly key: string;
	readonly rowId: string | null;
	readonly rowNumber: number | null;
	readonly conversationId: string | null;
	/** When it was asked for (`Date.now()`). */
	readonly at: number;
	/** Called once the view has revealed the row, or given up on it. */
	readonly consume: () => void;
};

/** How long a request stands, from when it was made. */
export const DOCUMENT_REVEAL_WINDOW_MS = 10_000;

/** Whether a request is still for now. */
export function documentRevealIsCurrent(
	reveal: Pick<DocumentReveal, "at">,
	now: number = Date.now(),
): boolean {
	return now - reveal.at <= DOCUMENT_REVEAL_WINDOW_MS;
}

/**
 * Clears a consumed request from a view's state, so a remount or a restored
 * workspace does not reveal the row again. The view is named by its instance
 * and its area: a state update goes to the area it names (the main area when
 * none), so a view in a side area must say so or nothing is cleared.
 */
export function clearDocumentReveal(
	views: AtelierViewsApi,
	extensionId: string,
	view: Pick<AtelierExtensionView, "instanceId" | "area">,
): () => void {
	return () => {
		void views
			.open(extensionId, {
				instanceId: view.instanceId,
				area: view.area,
				state: { reveal: null },
				activate: false,
			})
			.catch(() => {});
	};
}

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

/**
 * The request in a view's state, or null when there is none or it is no
 * longer current. `consume` clears it (see `clearDocumentReveal`).
 */
export function documentReveal(
	state: unknown,
	consume: () => void = () => {},
	now: number = Date.now(),
): DocumentReveal | null {
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
	const at = typeof value.at === "number" ? value.at : 0;
	if (!documentRevealIsCurrent({ at }, now)) return null;
	return {
		at,
		consume,
		key: `${String(value.at ?? "")}:${rowId ?? ""}:${rowNumber ?? ""}`,
		rowId,
		rowNumber,
		conversationId:
			typeof value.conversationId === "string" ? value.conversationId : null,
	};
}
