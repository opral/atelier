import type { Lix } from "@lix-js/sdk";
import { qb, sql } from "@/lib/lix-kysely";

/**
 * Kysely adapter for Lix's table-valued file history surface.
 *
 * Passing a commit selects file history as of that commit. Omitting it walks
 * history from the active branch head.
 */
export function selectFileHistory(lix: Lix, asOfCommitId?: string) {
	const table = asOfCommitId
		? sql<any>`lix_file_history(${asOfCommitId})`
		: sql<any>`lix_file_history()`;
	return qb(lix).selectFrom(table.as("lix_file_history"));
}
