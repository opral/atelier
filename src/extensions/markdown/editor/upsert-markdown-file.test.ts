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
		const receipt = await upsertMarkdownFile({
			lix,
			fileId,
			markdown: "New user input\n",
		});
		expect(receipt.written).toBe(true);
		// The receipt is what lets a surface recognise its own write later.
		expect(typeof receipt.commit?.after).toBe("string");
		expect(receipt.commit?.after).not.toBe(receipt.commit?.before);
		const result = await lix.execute(
			"SELECT content FROM lix_file WHERE id=$1",
			[fileId],
		);
		expect(
			new TextDecoder().decode(result.rows[0]!.content as Uint8Array),
		).toBe("New user input\n");
		await lix.execute("DELETE FROM lix_file WHERE id=$1", [fileId]);
		expect(
			(
				await upsertMarkdownFile({
					lix,
					fileId,
					markdown: "Must not recreate\n",
				})
			).written,
		).toBe(false);
	} finally {
		await lix.close();
	}
});
