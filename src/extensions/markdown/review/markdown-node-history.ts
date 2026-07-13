import { parseMarkdownSource } from "../editor/markdown";
import type { MarkdownBlockSnapshot } from "../review-diff";

export type HistoricalMarkdownNodeRow = {
	readonly start_commit_id: string;
	readonly snapshot_content: unknown;
};

type MarkdownNodeSnapshot = {
	readonly id: string;
	readonly parentId: string | null;
	readonly orderKey: string | null;
};

/**
 * Adapts Markdown v2's top-level syntax nodes to the review engine's block
 * identity hints. The raw file snapshot remains authoritative for content;
 * Lix contributes only stable entity ids and ordering.
 */
export function historicalMarkdownNodeBlocks(
	rows: readonly HistoricalMarkdownNodeRow[],
	commitId: string,
	markdown: string,
): MarkdownBlockSnapshot[] | undefined {
	const nodes = rows
		.filter((row) => row.start_commit_id === commitId)
		.map((row) => parseMarkdownNodeSnapshot(row.snapshot_content))
		.filter(
			(node): node is MarkdownNodeSnapshot =>
				node !== null && node.parentId === "root" && node.orderKey !== null,
		)
		.sort(
			(left, right) =>
				left.orderKey!.localeCompare(right.orderKey!) ||
				left.id.localeCompare(right.id),
		);
	const segments = topLevelMarkdownSegments(markdown);
	if (!segments || segments.length !== nodes.length) return undefined;
	return nodes.map((node, index) => ({
		id: node.id,
		orderKey: node.orderKey!,
		block: segments[index]!,
	}));
}

function parseMarkdownNodeSnapshot(value: unknown): MarkdownNodeSnapshot | null {
	const snapshot = typeof value === "string" ? safeJsonParse(value) : value;
	if (!snapshot || typeof snapshot !== "object") return null;
	const record = snapshot as Record<string, unknown>;
	if (
		typeof record.id !== "string" ||
		(record.parent_id !== null && typeof record.parent_id !== "string") ||
		(record.order_key !== null && typeof record.order_key !== "string")
	) {
		return null;
	}
	return {
		id: record.id,
		parentId: record.parent_id,
		orderKey: record.order_key,
	};
}

function topLevelMarkdownSegments(markdown: string): string[] | null {
	const children = parseMarkdownSource(markdown).children ?? [];
	if (children.length === 0) return markdown.length === 0 ? [] : null;
	const starts: number[] = [];
	for (let index = 0; index < children.length; index += 1) {
		const offset = children[index]?.position?.start?.offset;
		if (
			typeof offset !== "number" ||
			offset < 0 ||
			offset > markdown.length ||
			(index > 0 && offset <= starts[index - 1]!)
		) {
			return null;
		}
		starts.push(offset);
	}
	return children.map((_child, index) =>
		markdown.slice(index === 0 ? 0 : starts[index]!, starts[index + 1]),
	);
}

function safeJsonParse(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}
