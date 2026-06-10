import type { Lix } from "@lix-js/sdk";
import { qb } from "@/lib/lix-kysely";

export async function upsertMarkdownFile(args: {
	lix: Lix;
	fileId: string;
	markdown: string;
	path?: string;
	metadata?: any;
	hidden?: boolean;
	writerKey?: string;
}): Promise<void> {
	const { lix, fileId, markdown, path, metadata, hidden, writerKey } = args;
	const data = new TextEncoder().encode(markdown);
	const db = writerKey ? qb(lix, { writerKey }) : qb(lix);

	const existing = await db
		.selectFrom("lix_file")
		.select(["id", "path", "metadata", "hidden"])
		.where("id", "=", fileId)
		.executeTakeFirst();

	if (existing) {
		const resolvedPath = path ?? existing.path ?? `/${fileId}.md`;
		const resolvedMetadata = metadata ?? existing.metadata ?? null;
		const resolvedHidden = hidden ?? existing.hidden;
		await db.transaction().execute(async (trx) => {
			await trx.deleteFrom("lix_file").where("id", "=", fileId).execute();
			await trx
				.insertInto("lix_file")
				.values({
					id: fileId,
					path: resolvedPath,
					data,
					metadata: resolvedMetadata,
					hidden: resolvedHidden,
				})
				.execute();
		});
	} else {
		// Insert requires a path; use provided or fallback to /<fileId>.md
		await db
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: path ?? `/${fileId}.md`,
				data,
				metadata: metadata ?? null,
				hidden: hidden,
			})
			.execute();
	}
}
