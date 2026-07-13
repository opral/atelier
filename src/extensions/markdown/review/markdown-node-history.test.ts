import { describe, expect, test } from "vitest";
import { historicalMarkdownNodeBlocks } from "./markdown-node-history";

describe("historicalMarkdownNodeBlocks", () => {
	test("pairs ordered top-level Markdown nodes with authoritative source segments", () => {
		const markdown = "# Title\n\n- one\n- two\n";
		const rows = [
			row("commit", {
				id: "list",
				kind: "list",
				parent_id: "root",
				order_key: "80",
			}),
			row("commit", {
				id: "nested-item",
				kind: "list_item",
				parent_id: "list",
				order_key: "40",
			}),
			row("commit", {
				id: "heading",
				kind: "heading",
				parent_id: "root",
				order_key: "40",
			}),
		];

		expect(historicalMarkdownNodeBlocks(rows, "commit", markdown)).toEqual([
			{ id: "heading", orderKey: "40", block: "# Title\n\n" },
			{ id: "list", orderKey: "80", block: "- one\n- two\n" },
		]);
	});

	test("returns undefined when syntax nodes cannot be paired losslessly", () => {
		expect(
			historicalMarkdownNodeBlocks(
				[
					row("commit", {
						id: "only-node",
						kind: "paragraph",
						parent_id: "root",
						order_key: "40",
					}),
				],
				"commit",
				"First\n\nSecond\n",
			),
		).toBeUndefined();
	});
});

function row(startCommitId: string, snapshot: Record<string, unknown>) {
	return {
		start_commit_id: startCommitId,
		snapshot_content: JSON.stringify({
			payload: {},
			format: {},
			...snapshot,
		}),
	};
}
