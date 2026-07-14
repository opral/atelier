import { afterEach, describe, expect, test } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { openLix } from "@/test-utils/node-lix-sdk";
import { qb } from "@/lib/lix-kysely";
import { getExternalWriteReview } from "@/shell/external-write-review-history";
import { readAgentTurnCommitRanges } from "@/shell/agent-turn-review-range";
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

test("simulates a real completed agent turn that opens an external-write review", async () => {
	lix = await openLix();
	await qb(lix)
		.insertInto("lix_file")
		.values({
			id: "devtools-readme",
			path: "/README.md",
			data: encoder.encode("# Original heading\n\nStable paragraph.\n"),
		})
		.execute();

	const result = await simulateMarkdownAgentWorkflow(lix, {
		branchId: await lix.activeBranchId(),
		filePath: "/README.md",
		scenario: "inline-edit",
	});
	const file = await qb(lix)
		.selectFrom("lix_file")
		.select("data")
		.where("id", "=", "devtools-readme")
		.executeTakeFirstOrThrow();
	const ranges = await readAgentTurnCommitRanges(lix);
	const review = await getExternalWriteReview(
		lix,
		"devtools-readme",
		"/README.md",
	);

	expect(decoder.decode(file.data)).toContain("agent-reviewed-copy");
	expect(result.beforeCommitId).not.toBe(result.afterCommitId);
	expect(ranges.at(-1)).toMatchObject({
		id: result.rangeId,
		sourceId: "codex",
		beforeCommitId: result.beforeCommitId,
		afterCommitId: result.afterCommitId,
	});
	expect(review).toMatchObject({
		fileId: "devtools-readme",
		beforeCommitId: result.beforeCommitId,
		afterCommitId: result.afterCommitId,
	});
});
