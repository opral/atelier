import type { JSONContent } from "@tiptap/core";
import { parseMarkdown } from "../editor/markdown";
import { astToTiptapDoc } from "../editor/tiptap-markdown-bridge";
import type { MarkdownBlockSnapshot, MarkdownReviewDiff } from "../review-diff";

const REVIEW_MARK_NAME = "markdownReviewDiff";
const REVIEW_DATA_KEY = "markdownReview";
const MAX_ALIGNMENT_CELLS = 250_000;
const GREEDY_LOOKAHEAD = 128;

type ReviewStatus = "added" | "removed";

export type MarkdownReviewChange = {
	readonly id: string;
	readonly entityId?: string;
	readonly kind: "insert" | "delete" | "replace" | "move";
	readonly before: JSONContent | null;
	readonly after: JSONContent | null;
};

export type MarkdownReviewDocument = {
	readonly doc: JSONContent;
	readonly changes: readonly MarkdownReviewChange[];
	readonly usedSemanticBlockIds: boolean;
};

type Alignment = {
	readonly beforeIndex?: number;
	readonly afterIndex?: number;
};

type MoveDescriptor = {
	readonly change: MarkdownReviewChange;
};

type InlineToken = JSONContent;

/**
 * Builds a schema-valid review document from the exact file snapshots.
 *
 * Semantic block snapshots are identity hints only. They are ignored unless
 * they account for every top-level node and each block parses to the same node
 * as the corresponding raw Markdown source.
 */
export function buildMarkdownReviewDocument(
	reviewDiff: MarkdownReviewDiff,
): MarkdownReviewDocument {
	const beforeDoc = markdownToDoc(reviewDiff.beforeMarkdown);
	const afterDoc = markdownToDoc(reviewDiff.afterMarkdown);
	const beforeNodes = beforeDoc.content ?? [];
	const afterNodes = afterDoc.content ?? [];
	const beforeIds = validatedBlockIds(beforeNodes, reviewDiff.beforeBlocks);
	const afterIds = validatedBlockIds(afterNodes, reviewDiff.afterBlocks);
	const useSemanticIds = beforeIds !== null && afterIds !== null;
	const alignments = alignNodes(
		beforeNodes,
		afterNodes,
		useSemanticIds ? beforeIds : null,
		useSemanticIds ? afterIds : null,
	);
	const moves = useSemanticIds
		? identifyMoves(alignments, beforeNodes, afterNodes, beforeIds, afterIds)
		: new Map<number, MoveDescriptor>();
	const content: JSONContent[] = [];
	const changes: MarkdownReviewChange[] = [];
	const recordedMoveIds = new Set<string>();

	for (
		let alignmentIndex = 0;
		alignmentIndex < alignments.length;
		alignmentIndex += 1
	) {
		const alignment = alignments[alignmentIndex]!;
		const before =
			alignment.beforeIndex === undefined
				? undefined
				: beforeNodes[alignment.beforeIndex];
		const after =
			alignment.afterIndex === undefined
				? undefined
				: afterNodes[alignment.afterIndex];

		const move = moves.get(alignmentIndex);
		if (move) {
			if (!recordedMoveIds.has(move.change.id)) {
				recordedMoveIds.add(move.change.id);
				changes.push(move.change);
			}
			if (before)
				content.push(markWholeNode(before, move.change.id, "removed"));
			if (after) content.push(markWholeNode(after, move.change.id, "added"));
			continue;
		}

		if (
			before &&
			after &&
			exactFingerprint(before) === exactFingerprint(after)
		) {
			content.push(cloneContent(after));
			continue;
		}

		const beforeId =
			alignment.beforeIndex === undefined || !useSemanticIds
				? undefined
				: beforeIds[alignment.beforeIndex];
		const afterId =
			alignment.afterIndex === undefined || !useSemanticIds
				? undefined
				: afterIds[alignment.afterIndex];
		const entityId =
			beforeId && beforeId === afterId ? beforeId : (afterId ?? beforeId);
		const kind = before && after ? "replace" : before ? "delete" : "insert";
		const changeId = reviewChangeId({
			entityId,
			kind,
			before,
			after,
			beforeIndex: alignment.beforeIndex,
			afterIndex: alignment.afterIndex,
		});

		changes.push({
			id: changeId,
			...(entityId ? { entityId } : {}),
			kind,
			before: before ? cloneContent(before) : null,
			after: after ? cloneContent(after) : null,
		});

		if (before && after) {
			const merged = mergeChangedNode(before, after, changeId);
			if (merged) {
				content.push(merged);
				continue;
			}
		}
		if (before) content.push(markWholeNode(before, changeId, "removed"));
		if (after) content.push(markWholeNode(after, changeId, "added"));
	}

	return {
		doc: { type: "doc", content },
		changes,
		usedSemanticBlockIds: useSemanticIds,
	};
}

/** Projects the synthetic review document back to either original side. */
export function projectMarkdownReviewDocument(
	doc: JSONContent,
	side: "before" | "after",
): JSONContent {
	return projectNode(doc, side) ?? { type: "doc", content: [] };
}

function markdownToDoc(markdown: string): JSONContent {
	return astToTiptapDoc(parseMarkdown(markdown)) as JSONContent;
}

function validatedBlockIds(
	nodes: readonly JSONContent[],
	blocks: readonly MarkdownBlockSnapshot[] | undefined,
): readonly string[] | null {
	if (blocks === undefined || blocks.length !== nodes.length) return null;
	const ordered = [...blocks].sort(
		(left, right) =>
			left.orderKey.localeCompare(right.orderKey) ||
			left.id.localeCompare(right.id),
	);
	const ids: string[] = [];
	const seenIds = new Set<string>();
	for (let index = 0; index < nodes.length; index += 1) {
		const block = ordered[index];
		if (!block || block.id.length === 0 || seenIds.has(block.id)) return null;
		const parsed = markdownToDoc(block.block).content ?? [];
		if (
			parsed.length !== 1 ||
			comparableFingerprint(parsed[0]!) !== comparableFingerprint(nodes[index]!)
		) {
			return null;
		}
		seenIds.add(block.id);
		ids.push(block.id);
	}
	return ids;
}

function identifyMoves(
	alignments: readonly Alignment[],
	beforeNodes: readonly JSONContent[],
	afterNodes: readonly JSONContent[],
	beforeIds: readonly string[],
	afterIds: readonly string[],
): Map<number, MoveDescriptor> {
	const removedById = new Map<
		string,
		{ readonly alignmentIndex: number; readonly node: JSONContent }
	>();
	const addedById = new Map<
		string,
		{ readonly alignmentIndex: number; readonly node: JSONContent }
	>();
	for (let index = 0; index < alignments.length; index += 1) {
		const alignment = alignments[index]!;
		if (
			alignment.beforeIndex !== undefined &&
			alignment.afterIndex === undefined
		) {
			removedById.set(beforeIds[alignment.beforeIndex]!, {
				alignmentIndex: index,
				node: beforeNodes[alignment.beforeIndex]!,
			});
		}
		if (
			alignment.afterIndex !== undefined &&
			alignment.beforeIndex === undefined
		) {
			addedById.set(afterIds[alignment.afterIndex]!, {
				alignmentIndex: index,
				node: afterNodes[alignment.afterIndex]!,
			});
		}
	}

	const moves = new Map<number, MoveDescriptor>();
	for (const [entityId, removed] of removedById) {
		const added = addedById.get(entityId);
		if (!added) continue;
		const change: MarkdownReviewChange = {
			id: reviewChangeId({
				entityId,
				kind: "move",
				before: removed.node,
				after: added.node,
			}),
			entityId,
			kind: "move",
			before: cloneContent(removed.node),
			after: cloneContent(added.node),
		};
		const descriptor = { change };
		moves.set(removed.alignmentIndex, descriptor);
		moves.set(added.alignmentIndex, descriptor);
	}
	return moves;
}

function alignNodes(
	before: readonly JSONContent[],
	after: readonly JSONContent[],
	beforeIds: readonly string[] | null,
	afterIds: readonly string[] | null,
): Alignment[] {
	if (before.length * after.length > MAX_ALIGNMENT_CELLS) {
		return alignNodesGreedily(before, after, beforeIds, afterIds);
	}

	const columns = after.length + 1;
	const costs = new Float64Array((before.length + 1) * columns);
	const decisions = new Uint8Array((before.length + 1) * columns);
	for (let left = 1; left <= before.length; left += 1) {
		costs[left * columns] = left;
		decisions[left * columns] = 1;
	}
	for (let right = 1; right <= after.length; right += 1) {
		costs[right] = right;
		decisions[right] = 2;
	}

	for (let left = 1; left <= before.length; left += 1) {
		for (let right = 1; right <= after.length; right += 1) {
			const index = left * columns + right;
			const removeCost = costs[(left - 1) * columns + right]! + 1;
			const addCost = costs[left * columns + right - 1]! + 1;
			const matchCost = nodePairCost(
				before[left - 1]!,
				after[right - 1]!,
				beforeIds?.[left - 1],
				afterIds?.[right - 1],
			);
			const pairCost = costs[(left - 1) * columns + right - 1]! + matchCost;
			if (pairCost <= removeCost && pairCost <= addCost) {
				costs[index] = pairCost;
				decisions[index] = 3;
			} else if (removeCost < addCost) {
				costs[index] = removeCost;
				decisions[index] = 1;
			} else {
				costs[index] = addCost;
				decisions[index] = 2;
			}
		}
	}

	const reversed: Alignment[] = [];
	let left = before.length;
	let right = after.length;
	while (left > 0 || right > 0) {
		const decision = decisions[left * columns + right];
		if (decision === 3) {
			reversed.push({ beforeIndex: left - 1, afterIndex: right - 1 });
			left -= 1;
			right -= 1;
		} else if (decision === 1) {
			reversed.push({ beforeIndex: left - 1 });
			left -= 1;
		} else {
			reversed.push({ afterIndex: right - 1 });
			right -= 1;
		}
	}
	return reversed.reverse();
}

function alignNodesGreedily(
	before: readonly JSONContent[],
	after: readonly JSONContent[],
	beforeIds: readonly string[] | null,
	afterIds: readonly string[] | null,
): Alignment[] {
	const alignments: Alignment[] = [];
	const beforeIdIndexes = beforeIds
		? new Map(beforeIds.map((id, index) => [id, index]))
		: null;
	const afterIdIndexes = afterIds
		? new Map(afterIds.map((id, index) => [id, index]))
		: null;
	let left = 0;
	let right = 0;
	while (left < before.length || right < after.length) {
		if (left >= before.length) {
			alignments.push({ afterIndex: right++ });
			continue;
		}
		if (right >= after.length) {
			alignments.push({ beforeIndex: left++ });
			continue;
		}
		const cost = nodePairCost(
			before[left]!,
			after[right]!,
			beforeIds?.[left],
			afterIds?.[right],
		);
		if (
			cost === 0 ||
			(beforeIds?.[left] && beforeIds[left] === afterIds?.[right])
		) {
			alignments.push({ beforeIndex: left++, afterIndex: right++ });
			continue;
		}
		const nextAfter = findMatchingNode(
			before[left]!,
			beforeIds?.[left],
			after,
			afterIds,
			afterIdIndexes,
			right + 1,
			GREEDY_LOOKAHEAD,
		);
		const nextBefore = findMatchingNode(
			after[right]!,
			afterIds?.[right],
			before,
			beforeIds,
			beforeIdIndexes,
			left + 1,
			GREEDY_LOOKAHEAD,
		);
		if (
			nextAfter !== -1 &&
			(nextBefore === -1 || nextAfter - right <= nextBefore - left)
		) {
			while (right < nextAfter) alignments.push({ afterIndex: right++ });
		} else if (nextBefore !== -1) {
			while (left < nextBefore) alignments.push({ beforeIndex: left++ });
		} else if (beforeIds?.[left] && afterIds?.[right]) {
			alignments.push({ beforeIndex: left++ });
		} else {
			alignments.push({ beforeIndex: left++, afterIndex: right++ });
		}
	}
	return alignments;
}

function findMatchingNode(
	needle: JSONContent,
	needleId: string | undefined,
	haystack: readonly JSONContent[],
	haystackIds: readonly string[] | null,
	haystackIdIndexes: ReadonlyMap<string, number> | null,
	start: number,
	window: number,
): number {
	if (needleId && haystackIds && haystackIdIndexes) {
		const index = haystackIdIndexes.get(needleId);
		return index !== undefined && index >= start ? index : -1;
	}
	const fingerprint = comparableFingerprint(needle);
	const end = Math.min(haystack.length, start + window);
	for (let index = start; index < end; index += 1) {
		if (comparableFingerprint(haystack[index]!) === fingerprint) {
			return index;
		}
	}
	return -1;
}

function nodePairCost(
	before: JSONContent,
	after: JSONContent,
	beforeId: string | undefined,
	afterId: string | undefined,
): number {
	if (comparableFingerprint(before) === comparableFingerprint(after)) return 0;
	if (beforeId && afterId) {
		return beforeId === afterId ? 0.05 : Number.POSITIVE_INFINITY;
	}
	if (before.type !== after.type) return Number.POSITIVE_INFINITY;
	if (canMergeInline(before, after) || canMergeContainer(before, after)) {
		return 1.6 - 0.7 * nodeTextSimilarity(before, after);
	}
	return 1.8;
}

function nodeTextSimilarity(before: JSONContent, after: JSONContent): number {
	const beforeTokens =
		nodeText(before)
			.toLocaleLowerCase()
			.match(/[\p{L}\p{N}_]+/gu) ?? [];
	const afterTokens =
		nodeText(after)
			.toLocaleLowerCase()
			.match(/[\p{L}\p{N}_]+/gu) ?? [];
	if (beforeTokens.length === 0 || afterTokens.length === 0) return 0;
	const remaining = new Map<string, number>();
	for (const token of beforeTokens) {
		remaining.set(token, (remaining.get(token) ?? 0) + 1);
	}
	let overlap = 0;
	for (const token of afterTokens) {
		const count = remaining.get(token) ?? 0;
		if (count === 0) continue;
		overlap += 1;
		remaining.set(token, count - 1);
	}
	return (2 * overlap) / (beforeTokens.length + afterTokens.length);
}

function nodeText(node: JSONContent): string {
	if (node.type === "text") return node.text ?? "";
	return (node.content ?? []).map(nodeText).join(" ");
}

function canMergeInline(before: JSONContent, after: JSONContent): boolean {
	if (before.type !== after.type) return false;
	if (
		before.type !== "paragraph" &&
		before.type !== "heading" &&
		before.type !== "tableCell"
	) {
		return false;
	}
	return (
		exactAttrs(before.attrs) === exactAttrs(after.attrs) &&
		Object.hasOwn(before, "content") === Object.hasOwn(after, "content")
	);
}

function canMergeContainer(before: JSONContent, after: JSONContent): boolean {
	if (before.type !== after.type) return false;
	if (
		before.type !== "bulletList" &&
		before.type !== "orderedList" &&
		before.type !== "listItem" &&
		before.type !== "blockquote" &&
		before.type !== "table" &&
		before.type !== "tableRow"
	) {
		return false;
	}
	return (
		exactAttrs(before.attrs) === exactAttrs(after.attrs) &&
		Object.hasOwn(before, "content") === Object.hasOwn(after, "content")
	);
}

function mergeChangedNode(
	before: JSONContent,
	after: JSONContent,
	changeId: string,
): JSONContent | null {
	if (canMergeInline(before, after)) {
		return mergeInlineNode(before, after, changeId);
	}
	if (!canMergeContainer(before, after)) return null;
	return {
		...cloneContent(after),
		content: mergeChildNodes(
			before.content ?? [],
			after.content ?? [],
			changeId,
		),
	};
}

function mergeChildNodes(
	before: readonly JSONContent[],
	after: readonly JSONContent[],
	changeId: string,
): JSONContent[] {
	const content: JSONContent[] = [];
	for (const alignment of alignNodes(before, after, null, null)) {
		const beforeNode =
			alignment.beforeIndex === undefined
				? undefined
				: before[alignment.beforeIndex];
		const afterNode =
			alignment.afterIndex === undefined
				? undefined
				: after[alignment.afterIndex];
		if (
			beforeNode &&
			afterNode &&
			exactFingerprint(beforeNode) === exactFingerprint(afterNode)
		) {
			content.push(cloneContent(afterNode));
			continue;
		}
		if (beforeNode && afterNode) {
			const merged = mergeChangedNode(beforeNode, afterNode, changeId);
			if (merged) {
				content.push(merged);
				continue;
			}
		}
		if (beforeNode) {
			content.push(markWholeNode(beforeNode, changeId, "removed"));
		}
		if (afterNode) {
			content.push(markWholeNode(afterNode, changeId, "added"));
		}
	}
	return content;
}

function mergeInlineNode(
	before: JSONContent,
	after: JSONContent,
	changeId: string,
): JSONContent {
	const beforeTokens = inlineTokens(before.content ?? []);
	const afterTokens = inlineTokens(after.content ?? []);
	const merged = diffInlineTokens(beforeTokens, afterTokens, changeId);
	return {
		...cloneContent(after),
		content: mergeAdjacentText(merged),
	};
}

function inlineTokens(content: readonly JSONContent[]): InlineToken[] {
	const tokens: InlineToken[] = [];
	for (const node of content) {
		if (node.type !== "text" || !node.text) {
			tokens.push(cloneContent(node));
			continue;
		}
		const pieces = node.text.match(
			/[\p{L}\p{N}_]+(?:\s+)?|[^\s\p{L}\p{N}_]+(?:\s+)?|\s+/gu,
		) ?? [node.text];
		for (const text of pieces) {
			tokens.push({
				type: "text",
				text,
				...(node.marks ? { marks: cloneValue(node.marks) } : {}),
			});
		}
	}
	return tokens;
}

function diffInlineTokens(
	before: readonly InlineToken[],
	after: readonly InlineToken[],
	changeId: string,
): JSONContent[] {
	if (before.length * after.length > MAX_ALIGNMENT_CELLS) {
		return diffInlinePrefixSuffix(before, after, changeId);
	}
	const columns = after.length + 1;
	const lengths = new Uint32Array((before.length + 1) * columns);
	for (let left = 1; left <= before.length; left += 1) {
		for (let right = 1; right <= after.length; right += 1) {
			const index = left * columns + right;
			if (
				inlineTokenKey(before[left - 1]!) === inlineTokenKey(after[right - 1]!)
			) {
				lengths[index] = lengths[(left - 1) * columns + right - 1]! + 1;
			} else {
				lengths[index] = Math.max(
					lengths[(left - 1) * columns + right]!,
					lengths[left * columns + right - 1]!,
				);
			}
		}
	}

	const reversed: JSONContent[] = [];
	let left = before.length;
	let right = after.length;
	while (left > 0 || right > 0) {
		if (
			left > 0 &&
			right > 0 &&
			inlineTokenKey(before[left - 1]!) === inlineTokenKey(after[right - 1]!)
		) {
			reversed.push(cloneContent(after[right - 1]!));
			left -= 1;
			right -= 1;
		} else if (
			right > 0 &&
			(left === 0 ||
				lengths[left * columns + right - 1]! >=
					lengths[(left - 1) * columns + right]!)
		) {
			reversed.push(markInlineToken(after[right - 1]!, changeId, "added"));
			right -= 1;
		} else {
			reversed.push(markInlineToken(before[left - 1]!, changeId, "removed"));
			left -= 1;
		}
	}
	return reversed.reverse();
}

function diffInlinePrefixSuffix(
	before: readonly InlineToken[],
	after: readonly InlineToken[],
	changeId: string,
): JSONContent[] {
	let prefix = 0;
	while (
		prefix < before.length &&
		prefix < after.length &&
		inlineTokenKey(before[prefix]!) === inlineTokenKey(after[prefix]!)
	) {
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix < before.length - prefix &&
		suffix < after.length - prefix &&
		inlineTokenKey(before[before.length - suffix - 1]!) ===
			inlineTokenKey(after[after.length - suffix - 1]!)
	) {
		suffix += 1;
	}
	return [
		...after.slice(0, prefix).map(cloneContent),
		...before
			.slice(prefix, before.length - suffix)
			.map((token) => markInlineToken(token, changeId, "removed")),
		...after
			.slice(prefix, after.length - suffix)
			.map((token) => markInlineToken(token, changeId, "added")),
		...after.slice(after.length - suffix).map(cloneContent),
	];
}

function markInlineToken(
	token: InlineToken,
	changeId: string,
	status: ReviewStatus,
): JSONContent {
	if (token.type !== "text") return markWholeNode(token, changeId, status);
	return {
		...cloneContent(token),
		marks: [
			...(cloneValue(token.marks ?? []) as NonNullable<JSONContent["marks"]>),
			{ type: REVIEW_MARK_NAME, attrs: { changeId, status } },
		],
	};
}

function markWholeNode(
	node: JSONContent,
	changeId: string,
	status: ReviewStatus,
): JSONContent {
	const clone = cloneContent(node);
	const originalAttrs = cloneValue(clone.attrs);
	const data =
		clone.attrs?.data && typeof clone.attrs.data === "object"
			? cloneValue(clone.attrs.data)
			: {};
	return {
		...clone,
		attrs: {
			...(clone.attrs ?? {}),
			data: {
				...data,
				[REVIEW_DATA_KEY]: { changeId, status, originalAttrs },
			},
		},
	};
}

function mergeAdjacentText(content: readonly JSONContent[]): JSONContent[] {
	const merged: JSONContent[] = [];
	for (const node of content) {
		const previous = merged.at(-1);
		if (
			previous?.type === "text" &&
			node.type === "text" &&
			stableStringify(previous.marks ?? []) ===
				stableStringify(node.marks ?? [])
		) {
			previous.text = `${previous.text ?? ""}${node.text ?? ""}`;
		} else {
			merged.push(cloneContent(node));
		}
	}
	return merged;
}

function projectNode(
	node: JSONContent,
	side: "before" | "after",
): JSONContent | null {
	const clone = cloneContent(node);
	const nodeReview = readNodeReview(clone);
	if (
		nodeReview &&
		((side === "before" && nodeReview.status === "added") ||
			(side === "after" && nodeReview.status === "removed"))
	) {
		return null;
	}
	if (nodeReview) {
		if (nodeReview.hasOriginalAttrs) {
			if (nodeReview.originalAttrs === undefined) delete clone.attrs;
			else clone.attrs = cloneValue(nodeReview.originalAttrs);
		} else {
			const data = cloneValue(clone.attrs?.data ?? {}) as Record<
				string,
				unknown
			>;
			delete data[REVIEW_DATA_KEY];
			clone.attrs = {
				...(clone.attrs ?? {}),
				data: Object.keys(data).length > 0 ? data : null,
			};
		}
	}

	const reviewMark = clone.marks?.find(
		(mark) => mark.type === REVIEW_MARK_NAME,
	);
	const markStatus = reviewMark?.attrs?.status;
	if (
		(side === "before" && markStatus === "added") ||
		(side === "after" && markStatus === "removed")
	) {
		return null;
	}
	if (reviewMark) {
		const marks = clone.marks?.filter((mark) => mark.type !== REVIEW_MARK_NAME);
		if (marks?.length) clone.marks = marks;
		else delete clone.marks;
	}

	if (clone.content) {
		clone.content = clone.content
			.map((child) => projectNode(child, side))
			.filter((child): child is JSONContent => child !== null);
		clone.content = mergeAdjacentText(clone.content);
	}
	return clone;
}

function readNodeReview(node: JSONContent): {
	readonly status: ReviewStatus;
	readonly hasOriginalAttrs: boolean;
	readonly originalAttrs: JSONContent["attrs"] | undefined;
} | null {
	const value = node.attrs?.data?.[REVIEW_DATA_KEY];
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const status = record.status;
	return status === "added" || status === "removed"
		? {
				status,
				hasOriginalAttrs: Object.hasOwn(record, "originalAttrs"),
				originalAttrs: record.originalAttrs as JSONContent["attrs"] | undefined,
			}
		: null;
}

function reviewChangeId(args: {
	readonly entityId?: string;
	readonly kind: MarkdownReviewChange["kind"];
	readonly before?: JSONContent;
	readonly after?: JSONContent;
	readonly beforeIndex?: number;
	readonly afterIndex?: number;
}): string {
	const material = stableStringify({
		entityId: args.entityId ?? null,
		kind: args.kind,
		before: args.before ? comparableValue(args.before) : null,
		after: args.after ? comparableValue(args.after) : null,
		beforeIndex: args.entityId ? null : (args.beforeIndex ?? null),
		afterIndex: args.entityId ? null : (args.afterIndex ?? null),
	});
	return `md-review-${fnv1a(material)}`;
}

function inlineTokenKey(token: InlineToken): string {
	return stableStringify(comparableValue(token));
}

function comparableFingerprint(node: JSONContent): string {
	return stableStringify(comparableValue(node));
}

function exactFingerprint(node: JSONContent): string {
	return stableStringify(node);
}

function exactAttrs(attrs: JSONContent["attrs"]): string {
	return stableStringify(attrs);
}

function comparableValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(comparableValue);
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(record).sort()) {
		if (key === REVIEW_DATA_KEY) continue;
		if (key === "marks" && Array.isArray(record[key])) {
			out[key] = (record[key] as Array<Record<string, unknown>>)
				.filter((mark) => mark.type !== REVIEW_MARK_NAME)
				.map(comparableValue);
			continue;
		}
		if (key === "data") {
			const data = record[key];
			if (data && typeof data === "object" && !Array.isArray(data)) {
				const cleaned = { ...(data as Record<string, unknown>) };
				delete cleaned.id;
				delete cleaned[REVIEW_DATA_KEY];
				if (Object.keys(cleaned).length > 0)
					out[key] = comparableValue(cleaned);
			}
			continue;
		}
		out[key] = comparableValue(record[key]);
	}
	return out;
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (!value || typeof value !== "object") {
		const encoded = JSON.stringify(value);
		return encoded === undefined ? "undefined" : encoded;
	}
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(",")}}`;
}

function fnv1a(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

function cloneContent<T extends JSONContent>(value: T): T {
	return cloneValue(value) as T;
}

function cloneValue<T>(value: T): T {
	if (Array.isArray(value)) return value.map(cloneValue) as T;
	if (!value || typeof value !== "object") return value;
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		out[key] = cloneValue(child);
	}
	return out as T;
}
