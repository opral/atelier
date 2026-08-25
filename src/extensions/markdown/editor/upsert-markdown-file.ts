import type { Lix, SqlParam } from "@lix-js/sdk";

type MarkdownFileWriteArgs = {
	lix: Lix;
	fileId: string;
	markdown: string;
	expectedMarkdown: string;
	originKey?: string;
};

export async function upsertMarkdownFile(
	args: MarkdownFileWriteArgs,
): Promise<boolean> {
	const { lix, fileId, markdown, expectedMarkdown, originKey } = args;
	const data = new TextEncoder().encode(markdown);
	const params: SqlParam[] = [
		data,
		fileId,
		new TextEncoder().encode(expectedMarkdown),
	];
	const result = await lix.execute(
		"UPDATE lix_file SET content = $1 WHERE id = $2 AND content = $3",
		params,
		originKey ? { originKey } : undefined,
	);
	return result.rowsAffected > 0;
}
