import { describe, expect, test } from "vitest";
import { openLix } from "../test-utils/node-lix-sdk";
import { createCheckpoint } from "../lib/lix-diff-commands";
import { loadTextFile } from "./prepared-file";
import { loadMediaFile } from "./prepared-media";

describe("prepared file loaders", () => {
	test("loads explicit builtin views from their captured commit, not newer live content", async () => {
		const lix = await openLix();
		const signal = new AbortController().signal;
		try {
			const inserted = await lix.execute(
				"INSERT INTO lix_file(path,content) VALUES ($1,$2) RETURNING id",
				["/file.md", new TextEncoder().encode("# Before")],
			);
			const fileId = String(inserted.rows[0]?.id);
			const checkpoint = await createCheckpoint(lix);
			await lix.execute("UPDATE lix_file SET content=$1 WHERE id=$2", [
				new TextEncoder().encode("# After"),
				fileId,
			]);
			expect(
				await loadTextFile({
					lix,
					signal,
					location: {
						view: "atelier_file",
						state: {
							fileId,
							filePath: "/file.md",
							afterCommitId: checkpoint.commitId,
						},
					},
				}),
			).toMatchObject({ content: "# Before" });
			expect(
				await loadTextFile({
					lix,
					signal,
					location: { view: "atelier_file", state: { fileId } },
				}),
			).toMatchObject({ content: "# After" });
		} finally {
			await lix.close();
		}
	});
	test("caps embedded media snapshots and respects preparation cancellation", async () => {
		const lix = await openLix();
		try {
			await lix.execute("INSERT INTO lix_file(path,content) VALUES ($1,$2)", [
				"/large.mp4",
				new Uint8Array(1024 * 1024 + 1),
			]);
			expect(
				await loadMediaFile({
					lix,
					signal: new AbortController().signal,
					location: { path: "/large.mp4" },
				}),
			).toMatchObject({ src: null, size: 1024 * 1024 + 1 });
			const controller = new AbortController();
			controller.abort();
			await expect(
				loadMediaFile({
					lix,
					signal: controller.signal,
					location: { path: "/large.mp4" },
				}),
			).rejects.toThrow();
		} finally {
			await lix.close();
		}
	});
});
