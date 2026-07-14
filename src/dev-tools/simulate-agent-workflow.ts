import type { Lix } from "@lix-js/sdk";
import { qb } from "@/lib/lix-kysely";
import { appendAgentTurnCommitRange } from "@/shell/agent-turn-review-range";

export type DeveloperWorkflowScenario =
	| "inline-edit"
	| "gfm-structures"
	| "raw-html";

export type SimulatedAgentWorkflow = {
	readonly fileId: string;
	readonly filePath: string;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly rangeId: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let workflowSequence = 0;

/**
 * Runs the same completed-turn sequence a host agent integration must use:
 * snapshot before, write the file, snapshot after, then record the turn range.
 */
export async function simulateMarkdownAgentWorkflow(
	lix: Lix,
	args: {
		readonly filePath: string;
		readonly scenario: DeveloperWorkflowScenario;
		readonly branchId: string;
	},
): Promise<SimulatedAgentWorkflow> {
	if (!args.filePath.toLowerCase().endsWith(".md")) {
		throw new Error(
			"Open a Markdown file before simulating an agent workflow.",
		);
	}
	const file = await qb(lix)
		.selectFrom("lix_file")
		.select(["id", "path", "data"])
		.where("path", "=", args.filePath)
		.limit(1)
		.executeTakeFirst();
	if (!file) throw new Error(`File not found: ${args.filePath}`);

	const beforeBytes = fileDataBytes(file.data);
	const beforeMarkdown = decoder.decode(beforeBytes);
	const afterMarkdown = applyDeveloperWorkflowScenario(
		beforeMarkdown,
		args.scenario,
	);
	if (afterMarkdown === beforeMarkdown) {
		throw new Error("The selected workflow did not change the active file.");
	}

	const startedAt = Date.now();
	const beforeCommitId = await activeCommitId(lix);
	const rangeId = developerWorkflowId();
	const writeResult = await lix.execute(
		"UPDATE lix_file SET data = $1 WHERE id = $2 AND data = $3",
		[encoder.encode(afterMarkdown), file.id, beforeBytes],
		{ originKey: `atelier.devtools:codex:${rangeId}` },
	);
	if (writeResult.rowsAffected !== 1) {
		throw new Error(
			"The file changed while the workflow was starting. Try the simulation again.",
		);
	}
	const afterCommitId = await activeCommitId(lix);
	if (beforeCommitId === afterCommitId) {
		throw new Error("The simulated agent write did not create a new commit.");
	}

	await appendAgentTurnCommitRange(
		lix,
		{
			id: rangeId,
			sourceId: "codex",
			beforeCommitId,
			afterCommitId,
			sessionId: "atelier-developer-tools",
			turnId: rangeId,
			startedAt,
			completedAt: Date.now(),
		},
		{ branchId: args.branchId },
	);
	return {
		fileId: file.id,
		filePath: file.path,
		beforeCommitId,
		afterCommitId,
		rangeId,
	};
}

export function applyDeveloperWorkflowScenario(
	markdown: string,
	scenario: DeveloperWorkflowScenario,
): string {
	switch (scenario) {
		case "inline-edit":
			return replaceFirstProseWord(markdown);
		case "gfm-structures":
			return editGfmStructures(markdown);
		case "raw-html":
			return editRawHtml(markdown);
	}
}

async function activeCommitId(lix: Lix): Promise<string> {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	const commitId = result.rows[0]?.get("commit_id");
	if (typeof commitId !== "string" || commitId.length === 0) {
		throw new Error("Unable to read the active Lix commit.");
	}
	return commitId;
}

function replaceFirstProseWord(markdown: string): string {
	const lines = markdown.split("\n");
	let insideFence = false;
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]!;
		const trimmed = line.trim();
		if (/^(```|~~~)/.test(trimmed)) {
			insideFence = !insideFence;
			continue;
		}
		if (
			insideFence ||
			trimmed.length === 0 ||
			trimmed.startsWith("<!--") ||
			trimmed.startsWith("<") ||
			/^\|?[\s:|-]+\|?$/.test(trimmed)
		) {
			continue;
		}
		const match = line.match(/[\p{L}][\p{L}\p{N}'’-]{3,}/u);
		if (!match || match.index === undefined) continue;
		const replacement = /agent-reviewed|developer-preview/i.test(match[0])
			? "revised-copy"
			: "agent-reviewed-copy";
		lines[index] = `${line.slice(0, match.index)}${replacement}${line.slice(
			match.index + match[0].length,
		)}`;
		return lines.join("\n");
	}
	return `${markdown.trimEnd()}\n\nAgent-reviewed copy was added here.\n`;
}

function editGfmStructures(markdown: string): string {
	const lines = markdown.split("\n");
	let changedTask = false;
	let changedTable = false;
	for (let index = 0; index < lines.length; index += 1) {
		if (!changedTask && /^\s*[-*+] \[[ xX]\]/.test(lines[index]!)) {
			lines[index] = lines[index]!.replace(
				/^(\s*[-*+] \[)([ xX])(\])/,
				(_match, prefix: string, checked: string, suffix: string) =>
					`${prefix}${checked === " " ? "x" : " "}${suffix}`,
			);
			changedTask = true;
		}
		if (
			!changedTable &&
			index > 0 &&
			lines[index]!.trimStart().startsWith("|") &&
			/^\|?[\s:|-]+\|?$/.test(lines[index - 1]!.trim())
		) {
			const cells = lines[index]!.split("|");
			const cellIndex = cells.findIndex(
				(cell, candidateIndex) =>
					candidateIndex > 0 &&
					candidateIndex < cells.length - 1 &&
					cell.trim().length > 0,
			);
			if (cellIndex !== -1) {
				cells[cellIndex] = " Agent-updated cell ";
				lines[index] = cells.join("|");
				changedTable = true;
			}
		}
	}
	if (!changedTask && !changedTable) {
		return `${markdown.trimEnd()}\n\n## Simulated agent checklist\n\n- [x] Review inline diff\n- [ ] Verify Keep and Undo\n\n| Change | Status |\n| --- | --- |\n| Tiptap review | Ready |\n`;
	}
	return lines.join("\n");
}

function editRawHtml(markdown: string): string {
	if (/<summary>[^<]*<\/summary>/i.test(markdown)) {
		return markdown.replace(
			/<summary>[^<]*<\/summary>/i,
			markdown.includes("Agent-reviewed HTML boundary")
				? "<summary>Developer preview HTML boundary</summary>"
				: "<summary>Agent-reviewed HTML boundary</summary>",
		);
	}
	return `${markdown.trimEnd()}\n\n<aside data-dev-review="true">\nAgent-added raw HTML boundary.\n</aside>\n`;
}

function fileDataBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new Error("The active file has unsupported data.");
}

function developerWorkflowId(): string {
	workflowSequence += 1;
	const random =
		typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
			? crypto.randomUUID()
			: `${Date.now().toString(36)}-${workflowSequence.toString(36)}`;
	return `dev-agent-${random}`;
}
