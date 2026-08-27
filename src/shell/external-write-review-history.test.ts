import { describe, expect, test } from "vitest";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { qb } from "@/lib/lix-kysely";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { getFileDataAtCommit } from "./external-write-review-history";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("getFileDataAtCommit", () => {
	test("returns the file's bytes at the requested commit", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("history-file");
			await writeFile(lix, fileId, "/history.md", "before");
			const checkpoint = await createCheckpoint(lix);
			await writeFile(lix, fileId, "/history.md", "after");
			const headCommitId = await activeCommitId(lix);

			const beforeData = await getFileDataAtCommit(
				lix,
				fileId,
				checkpoint.commitId,
			);
			expect(decoder.decode(beforeData ?? undefined)).toBe("before");
			const afterData = await getFileDataAtCommit(lix, fileId, headCommitId);
			expect(decoder.decode(afterData ?? undefined)).toBe("after");
		} finally {
			await lix.close();
		}
	});

	test("returns null for a file absent at the commit", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, fakeUuid("baseline-file"), "/baseline.md", "base");
			const checkpoint = await createCheckpoint(lix);
			const addedFileId = fakeUuid("added-later-file");
			await writeFile(lix, addedFileId, "/added-later.md", "new");

			const data = await getFileDataAtCommit(
				lix,
				addedFileId,
				checkpoint.commitId,
			);
			expect(data).toBeNull();
		} finally {
			await lix.close();
		}
	});
});

async function writeFile(
	lix: Lix,
	id: string,
	path: string,
	text: string,
): Promise<void> {
	await qb(lix)
		.insertInto("lix_file")
		.values({ id, path, content: encoder.encode(text) })
		.onConflict((oc) =>
			oc.column("id").doUpdateSet({ path, content: encoder.encode(text) }),
		)
		.execute();
}

async function activeCommitId(lix: Lix): Promise<string> {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	const commitId = result.rows[0]?.commit_id;
	if (typeof commitId !== "string") {
		throw new Error("Missing active commit id");
	}
	return commitId;
}
