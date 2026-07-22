import type { ExecuteResult, Lix, SqlParam } from "@lix-js/sdk";
import { qb } from "@/lib/lix-kysely";

type MarkdownFileWriteArgs = {
	lix: Lix;
	fileId: string;
	markdown: string;
	expectedMarkdown: string;
	path?: string;
	metadata?: any;
	createIfMissing?: boolean;
	originKey?: string;
};

export async function upsertMarkdownFile(
	args: MarkdownFileWriteArgs,
): Promise<boolean> {
	const {
		lix,
		fileId,
		markdown,
		expectedMarkdown,
		path,
		metadata,
		createIfMissing = true,
		originKey,
	} = args;
	const data = new TextEncoder().encode(markdown);
	const db = qb(lix);

	const existing = await db
		.selectFrom("lix_file")
		.select(["id", "path", "lixcol_metadata"])
		.where("id", "=", fileId)
		.executeTakeFirst();

	if (existing) {
		const resolvedPath = path ?? existing.path ?? `/${fileId}.md`;
		const resolvedMetadata = metadata ?? existing.lixcol_metadata ?? null;
		const updateValues: {
			data: Uint8Array;
			path?: string;
			lixcol_metadata?: any;
		} = { data };
		if (path !== undefined && resolvedPath !== existing.path) {
			updateValues.path = resolvedPath;
		}
		if (metadata !== undefined && metadata !== existing.lixcol_metadata) {
			updateValues.lixcol_metadata = resolvedMetadata;
		}
		const expectedData = new TextEncoder().encode(expectedMarkdown);
		const result = await executeMarkdownFileWrite(
			lix,
			{
				sql: `UPDATE lix_file SET ${Object.keys(updateValues)
					.map((column) => `${column} = ?`)
					.join(", ")} WHERE id = ? AND data = ?`,
				params: [...Object.values(updateValues), fileId, expectedData],
			},
			originKey,
		);
		return result.rowsAffected > 0;
	} else {
		if (!createIfMissing) {
			return false;
		}
		// Insert requires a path; use provided or fallback to /<fileId>.md
		await executeMarkdownFileWrite(
			lix,
			{
				sql: "INSERT INTO lix_file (id, path, data, lixcol_metadata) VALUES (?, ?, ?, ?)",
				params: [fileId, path ?? `/${fileId}.md`, data, metadata ?? null],
			},
			originKey,
		);
		return true;
	}
}

async function executeMarkdownFileWrite(
	lix: Lix,
	statement: { sql: string; params: SqlParam[] },
	originKey: string | undefined,
): Promise<ExecuteResult> {
	if (originKey) {
		return await lix.execute(statement.sql, statement.params, { originKey });
	}
	return await lix.execute(statement.sql, statement.params);
}
