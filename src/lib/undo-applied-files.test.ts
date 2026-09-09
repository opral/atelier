import { expect, test } from "vitest";
import { openLix } from "../test-utils/node-lix-sdk";
import { undoAppliedFiles } from "./lix-diff-commands";
for (const change of ["added", "removed", "renamed"] as const) {
	test(`undo applied ${change} preserves later changes in other files`, async () => {
		const lix = await openLix();
		const bytes = new TextEncoder().encode("original");
		const head = async () =>
			String(
				(await lix.execute("SELECT lix_active_branch_commit_id() AS id"))
					.rows[0]!.id,
			);
		try {
			if (change !== "added")
				await lix.execute(
					"INSERT INTO lix_file (path, content) VALUES ('/note.md',$1)",
					[bytes],
				);
			const beforeCommitId = await head();
			let id: string;
			if (change === "added")
				id = String(
					(
						await lix.execute(
							"INSERT INTO lix_file (path, content) VALUES ('/note.md',$1) RETURNING id",
							[bytes],
						)
					).rows[0]!.id,
				);
			else {
				id = String(
					(await lix.execute("SELECT id FROM lix_file WHERE path='/note.md'"))
						.rows[0]!.id,
				);
				await lix.execute(
					change === "removed"
						? "DELETE FROM lix_file WHERE id=$1"
						: "UPDATE lix_file SET path='/renamed.md' WHERE id=$1",
					[id],
				);
			}
			const afterCommitId = await head();
			await lix.execute(
				"INSERT INTO lix_file (path, content) VALUES ('/unrelated.txt',$1)",
				[bytes],
			);
			await undoAppliedFiles(lix, [id], { beforeCommitId, afterCommitId });
			const files = (
				await lix.execute(
					"SELECT path FROM lix_file WHERE path NOT LIKE '/.lix/%' ORDER BY path",
				)
			).rows.map((r) => r.path);
			expect(files).toEqual(
				change === "added"
					? ["/unrelated.txt"]
					: ["/note.md", "/unrelated.txt"],
			);
		} finally {
			await lix.close();
		}
	});
}
