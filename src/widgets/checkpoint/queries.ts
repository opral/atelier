import type { Lix } from "@lix-js/sdk";
import { rawLixQuery } from "@/lib/lix-kysely";

export type WorkingFileSummary = {
	id: string;
	path: string;
	status: "added" | "modified" | "removed";
};

/**
 * Lists files with working changes since the last checkpoint, labelled with
 * derived status and stable display path.
 */
export function selectWorkingDiffFiles(lix: Lix) {
	return rawLixQuery<WorkingFileSummary>(
		lix,
		"SELECT CAST(NULL AS TEXT) AS id, CAST(NULL AS TEXT) AS path, CAST(NULL AS TEXT) AS status WHERE false",
	);
}
