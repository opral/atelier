import type { Lix } from "@lix-js/sdk";
import { qb } from "@/lib/lix-kysely";
import { parseMarkdown } from "./markdown-rust";
import { decodeMarkdownData } from "./decode-markdown-data";

export async function assembleMdAst(args: {
	lix: Lix;
	fileId: string | null | undefined;
}): Promise<any> {
	const { lix, fileId } = args;
	if (!fileId) return { type: "root", children: [] };

	const file = await qb(lix)
		.selectFrom("lix_file")
		.where("id", "=", fileId)
		.select(["data"])
		.executeTakeFirst();

	if (!file?.data) {
		return { type: "root", children: [] };
	}

	const markdown = decodeMarkdownData(file.data);
	if (!markdown.trim()) {
		return { type: "root", children: [] };
	}

	try {
		return parseMarkdown(markdown) as any;
	} catch {
		return { type: "root", children: [] };
	}
}
