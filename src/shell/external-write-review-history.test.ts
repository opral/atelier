import { describe, expect, test } from "vitest";
import { openLix, type Lix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { qb } from "@/lib/lix-kysely";
import {
	getExternalWriteReviewData,
	getWorkingChangeExternalWriteReview,
} from "./external-write-review-history";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("getWorkingChangeExternalWriteReview", () => {
	test("reviews the file from the latest checkpoint to the active head", async () => {
		const lix = await openLix();
		try {
			await writeFile(
				lix,
				fakeUuid("checkpoint-file"),
				"/checkpoint.md",
				"before",
			);
			const checkpoint = await lix.createCheckpoint();
			await writeFile(
				lix,
				fakeUuid("checkpoint-file"),
				"/checkpoint.md",
				"after",
			);
			const headCommitId = await activeCommitId(lix);

			const review = await getWorkingChangeExternalWriteReview(
				lix,
				fakeUuid("checkpoint-file"),
				"/checkpoint.md",
			);
			expect(review).toEqual(
				expect.objectContaining({
					fileId: fakeUuid("checkpoint-file"),
					path: "/checkpoint.md",
					beforeCommitId: checkpoint.commitId,
					afterCommitId: headCommitId,
				}),
			);
			if (!review) throw new Error("Expected a checkpoint working review");
			const data = await getExternalWriteReviewData(lix, review);
			expect(decoder.decode(data?.beforeData)).toBe("before");
			expect(decoder.decode(data?.afterData)).toBe("after");
		} finally {
			await lix.close();
		}
	});

	test("reviews a file deleted after the latest checkpoint", async () => {
		const lix = await openLix();
		try {
			const fileId = fakeUuid("deleted-working-file");
			const path = "/deleted-working.md";
			await writeFile(lix, fileId, path, "before deletion");
			const checkpoint = await lix.createCheckpoint();
			await qb(lix).deleteFrom("lix_file").where("id", "=", fileId).execute();
			const headCommitId = await activeCommitId(lix);

			const review = await getWorkingChangeExternalWriteReview(
				lix,
				fileId,
				path,
			);

			expect(review).toEqual(
				expect.objectContaining({
					fileId,
					path,
					beforeCommitId: checkpoint.commitId,
					afterCommitId: headCommitId,
				}),
			);
			const data = await getExternalWriteReviewData(lix, review!);
			expect(decoder.decode(data?.beforeData)).toBe("before deletion");
			expect(data?.afterData).toEqual(new Uint8Array());
		} finally {
			await lix.close();
		}
	});

	test("returns no review for a file unchanged since the checkpoint", async () => {
		const lix = await openLix();
		try {
			await writeFile(lix, fakeUuid("stable-file"), "/stable.md", "same");
			await writeFile(lix, fakeUuid("moving-file"), "/moving.md", "v1");
			await lix.createCheckpoint();
			await writeFile(lix, fakeUuid("moving-file"), "/moving.md", "v2");

			const review = await getWorkingChangeExternalWriteReview(
				lix,
				fakeUuid("stable-file"),
				"/stable.md",
			);
			expect(review).toBeNull();
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
	const commitId = result.rows[0]?.get("commit_id");
	if (typeof commitId !== "string") {
		throw new Error("Missing active commit id");
	}
	return commitId;
}
