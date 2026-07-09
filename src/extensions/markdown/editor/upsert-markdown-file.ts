import type { Lix, SqlParam } from "@lix-js/sdk";
import { qb } from "@/lib/lix-kysely";

export async function upsertMarkdownFile(args: {
	lix: Lix;
	fileId: string;
	markdown: string;
	path?: string;
	metadata?: any;
	createIfMissing?: boolean;
	originKey?: string;
}): Promise<void> {
	const {
		lix,
		fileId,
		markdown,
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
		await executeMarkdownFileWrite(
			lix,
			{
				sql: `UPDATE lix_file SET ${Object.keys(updateValues)
					.map((column) => `${column} = ?`)
					.join(", ")} WHERE id = ?`,
				params: [...Object.values(updateValues), fileId],
			},
			originKey,
		);
	} else {
		if (!createIfMissing) return;
		// Insert requires a path; use provided or fallback to /<fileId>.md
		await executeMarkdownFileWrite(
			lix,
			{
				sql: "INSERT INTO lix_file (id, path, data, lixcol_metadata) VALUES (?, ?, ?, ?)",
				params: [fileId, path ?? `/${fileId}.md`, data, metadata ?? null],
			},
			originKey,
		);
	}
}

async function executeMarkdownFileWrite(
	lix: Lix,
	statement: { sql: string; params: SqlParam[] },
	originKey: string | undefined,
): Promise<void> {
	if (originKey) {
		await lix.execute(statement.sql, statement.params, { originKey });
		return;
	}
	await lix.execute(statement.sql, statement.params);
}
