import type { Lix, SqlParam } from "@lix-js/sdk";

type MarkdownFileWriteArgs = {
	lix: Lix;
	fileId: string;
	markdown: string;
	originKey?: string;
};

export async function upsertMarkdownFile(
	args: MarkdownFileWriteArgs,
): Promise<boolean> {
	const { lix, fileId, markdown, originKey } = args;
	const data = new TextEncoder().encode(markdown);
	const params: SqlParam[] = [data, fileId];
	const result = await lix.execute(
		"UPDATE lix_file SET content = $1 WHERE id = $2",
		params,
		originKey ? { originKey } : undefined,
	);
	return result.rowsAffected > 0;
}
