import { expect, test } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { upsertMarkdownFile } from "./upsert-markdown-file";

test("a genuine later file save uses the current local state without a stale content CAS", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("ordinary_markdown_save");
	try {
		await lix.execute(
			"INSERT INTO lix_file (id,path,content) VALUES ($1,$2,$3)",
			[fileId, "/same.md", new TextEncoder().encode("Remote winner\n")],
		);
		expect(
			await upsertMarkdownFile({ lix, fileId, markdown: "New user input\n" }),
		).toBe(true);
		const result = await lix.execute(
			"SELECT content FROM lix_file WHERE id=$1",
			[fileId],
		);
		expect(
			new TextDecoder().decode(result.rows[0]!.content as Uint8Array),
		).toBe("New user input\n");
		await lix.execute("DELETE FROM lix_file WHERE id=$1", [fileId]);
		expect(
			await upsertMarkdownFile({
				lix,
				fileId,
				markdown: "Must not recreate\n",
			}),
		).toBe(false);
	} finally {
		await lix.close();
	}
});
