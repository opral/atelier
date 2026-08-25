import { afterEach, describe, expect, test } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { qb } from "@/lib/lix-kysely";
import { getFileDataAtCommit } from "@/shell/external-write-review-history";
import {
	applyDeveloperWorkflowScenario,
	simulateMarkdownAgentWorkflow,
} from "./simulate-agent-workflow";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let lix: Lix | null = null;

afterEach(async () => {
	await lix?.close();
	lix = null;
});

describe("developer workflow scenarios", () => {
	test("creates deterministic changes for inline, GFM, and raw HTML cases", () => {
		const markdown = [
			"# Original heading",
			"",
			"- [ ] First task",
			"",
			"| Name | Status |",
			"| --- | --- |",
			"| Atelier | Draft |",
			"",
			"<details>",
			"<summary>Original summary</summary>",
			"</details>",
			"",
		].join("\n");

		const inline = applyDeveloperWorkflowScenario(markdown, "inline-edit");
		const gfm = applyDeveloperWorkflowScenario(markdown, "gfm-structures");
		const html = applyDeveloperWorkflowScenario(markdown, "raw-html");

		expect(inline).toContain("# agent-reviewed-copy heading");
		expect(gfm).toContain("- [x] First task");
		expect(gfm).toContain("| Agent-updated cell | Draft |");
		expect(html).toContain("<summary>Agent-reviewed HTML boundary</summary>");
	});
});

test("simulates a completed agent turn spanning a reviewable commit range", async () => {
	lix = await openLix();
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: fakeUuid("devtools-readme"),
			path: "/README.md",
			content: encoder.encode("# Original heading\n\nStable paragraph.\n"),
		})
		.execute();
	await lix.createCheckpoint();

	const result = await simulateMarkdownAgentWorkflow(lix, {
		branchId: await lix.activeBranchId(),
		filePath: "/README.md",
		scenario: "inline-edit",
	});
	const file = await qb(lix)
		.selectFrom("lix_file")
		.select("content")
		.where("id", "=", fakeUuid("devtools-readme"))
		.executeTakeFirstOrThrow();
	const beforeData = await getFileDataAtCommit(
		lix,
		fakeUuid("devtools-readme"),
		result.beforeCommitId,
	);
	const afterData = await getFileDataAtCommit(
		lix,
		fakeUuid("devtools-readme"),
		result.afterCommitId,
	);

	expect(decoder.decode(file.content)).toContain("agent-reviewed-copy");
	expect(result.beforeCommitId).not.toBe(result.afterCommitId);
	expect(decoder.decode(beforeData ?? undefined)).toContain(
		"# Original heading",
	);
	expect(decoder.decode(afterData ?? undefined)).toContain(
		"agent-reviewed-copy",
	);
});
