import { expect, test } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import {
	upsertMarkdownFile,
	upsertMarkdownFileWith,
} from "./upsert-markdown-file";

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

test("a failed write participant rolls back and saves the Markdown with one receipt", async () => {
	const lix = await openLix();
	try {
		const fileId = fakeUuid("markdown_participant_fallback");
		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, '/fallback.md', $2)",
			[fileId, new TextEncoder().encode("before")],
		);
		const cause = new Error("participant unavailable");
		let degraded: unknown;
		let committed = false;
		const receipt = await upsertMarkdownFileWith({
			lix,
			fileId,
			markdown: "saved",
			originKey: "fallback-test",
			participant: {
				after: async () => {
					throw cause;
				},
				committed: () => {
					committed = true;
				},
				degraded: (error) => {
					degraded = error;
				},
			},
		});
		expect(receipt.written).toBe(true);
		expect(receipt.commit?.after).not.toBe(receipt.commit?.before);
		expect(committed).toBe(false);
		expect(degraded).toBe(cause);
		const result = await lix.execute(
			"SELECT content FROM lix_file WHERE id = $1",
			[fileId],
		);
		expect(
			new TextDecoder().decode(result.rows[0]!.content as Uint8Array),
		).toBe("saved");
	} finally {
		await lix.close();
	}
});
