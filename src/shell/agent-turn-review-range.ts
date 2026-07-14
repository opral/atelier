import type { Lix } from "@lix-js/sdk";
import { qb } from "@/lib/lix-kysely";

export const AGENT_TURN_COMMIT_RANGE_KEY =
	"atelier_agent_turn_commit_range" as const;
export const AGENT_TURN_COMMIT_RANGE_KEY_PREFIX =
	`${AGENT_TURN_COMMIT_RANGE_KEY}:` as const;

export type AgentTurnCommitRange = {
	readonly id: string;
	readonly sourceId: string;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly sessionId?: string;
	readonly turnId?: string;
	readonly clearedFileIds?: readonly string[];
	readonly startedAt: number;
	readonly completedAt: number;
};

export type AgentTurnCommitRangeStore = {
	readonly ranges: readonly AgentTurnCommitRange[];
};

export function agentTurnReviewId(
	fileId: string,
	rangeIds: readonly string[],
): string {
	return JSON.stringify([fileId, rangeIds]);
}

export function agentTurnReviewRangeIds(
	reviewId: string,
	fileId: string,
): readonly string[] {
	try {
		const decoded = JSON.parse(reviewId) as unknown;
		if (
			Array.isArray(decoded) &&
			decoded.length === 2 &&
			decoded[0] === fileId &&
			Array.isArray(decoded[1]) &&
			decoded[1].every(
				(rangeId) => typeof rangeId === "string" && rangeId.length > 0,
			)
		) {
			return decoded[1];
		}
	} catch {
		// Fall through to the legacy delimiter format.
	}

	const legacyPrefix = `${fileId}:`;
	return reviewId.startsWith(legacyPrefix)
		? reviewId.slice(legacyPrefix.length).split(",").filter(Boolean)
		: [];
}

export async function readAgentTurnCommitRanges(
	lix: Lix,
	branchId?: string,
): Promise<readonly AgentTurnCommitRange[]> {
	const resolvedBranchId = branchId ?? (await lix.activeBranchId());
	const rows = await qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.select("value")
		.where("key", "like", `${AGENT_TURN_COMMIT_RANGE_KEY}%`)
		.where("lixcol_branch_id", "=", resolvedBranchId)
		.execute();
	return agentTurnCommitRangesFromValues(rows.map((row) => row.value));
}

export async function appendAgentTurnCommitRange(
	lix: Lix,
	range: AgentTurnCommitRange,
	options?: { readonly branchId?: string },
): Promise<void> {
	const value = serializeNormalizedAgentTurnCommitRange(range);
	const branchId = options?.branchId ?? (await lix.activeBranchId());
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: agentTurnCommitRangeKey(range.id),
			value,
			lixcol_branch_id: branchId,
			lixcol_global: branchId === "global",
			lixcol_untracked: true,
		})
		.onConflict((oc) => oc.columns(["key", "lixcol_branch_id"]).doNothing())
		.execute();
}

export function agentTurnCommitRangeKey(rangeId: string): string {
	return `${AGENT_TURN_COMMIT_RANGE_KEY_PREFIX}${encodeURIComponent(rangeId)}`;
}

export function agentTurnCommitRangesFromValues(
	values: readonly unknown[],
): readonly AgentTurnCommitRange[] {
	const byId = new Map<string, AgentTurnCommitRange>();
	for (const value of values) {
		const ranges = isAgentTurnCommitRangeStore(value)
			? value.ranges
			: isAgentTurnCommitRange(value)
				? [serializeNormalizedAgentTurnCommitRange(value)]
				: [];
		for (const range of ranges) {
			const existing = byId.get(range.id);
			if (!existing) {
				byId.set(range.id, range);
				continue;
			}
			const clearedFileIds = [
				...new Set([
					...(existing.clearedFileIds ?? []),
					...(range.clearedFileIds ?? []),
				]),
			];
			if (clearedFileIds.length > 0) {
				byId.set(range.id, { ...existing, clearedFileIds });
			}
		}
	}
	return [...byId.values()].sort(
		(left, right) =>
			left.completedAt - right.completedAt || left.id.localeCompare(right.id),
	);
}

export function isAgentTurnCommitRangeStore(
	value: unknown,
): value is AgentTurnCommitRangeStore {
	if (!value || typeof value !== "object") {
		return false;
	}
	const store = value as Partial<AgentTurnCommitRangeStore>;
	return (
		Array.isArray(store.ranges) && store.ranges.every(isAgentTurnCommitRange)
	);
}

export function isAgentTurnCommitRange(
	value: unknown,
): value is AgentTurnCommitRange {
	if (!value || typeof value !== "object") {
		return false;
	}
	const range = value as Partial<AgentTurnCommitRange>;
	const clearedFileIds = range.clearedFileIds;
	return (
		typeof range.sourceId === "string" &&
		range.sourceId.length > 0 &&
		typeof range.id === "string" &&
		range.id.length > 0 &&
		typeof range.beforeCommitId === "string" &&
		range.beforeCommitId.length > 0 &&
		typeof range.afterCommitId === "string" &&
		range.afterCommitId.length > 0 &&
		typeof range.startedAt === "number" &&
		Number.isFinite(range.startedAt) &&
		typeof range.completedAt === "number" &&
		Number.isFinite(range.completedAt) &&
		(range.sessionId === undefined || typeof range.sessionId === "string") &&
		(range.turnId === undefined || typeof range.turnId === "string") &&
		(clearedFileIds === undefined ||
			(Array.isArray(clearedFileIds) &&
				clearedFileIds.every(
					(fileId) => typeof fileId === "string" && fileId.length > 0,
				)))
	);
}

function serializeAgentTurnCommitRange(
	range: AgentTurnCommitRange,
): AgentTurnCommitRange {
	return {
		id: range.id,
		sourceId: range.sourceId,
		beforeCommitId: range.beforeCommitId,
		afterCommitId: range.afterCommitId,
		...(range.sessionId !== undefined ? { sessionId: range.sessionId } : {}),
		...(range.turnId !== undefined ? { turnId: range.turnId } : {}),
		...(range.clearedFileIds?.length
			? { clearedFileIds: [...new Set(range.clearedFileIds)] }
			: {}),
		startedAt: range.startedAt,
		completedAt: range.completedAt,
	};
}

function serializeNormalizedAgentTurnCommitRange(
	range: AgentTurnCommitRange,
): AgentTurnCommitRange {
	const serialized = serializeAgentTurnCommitRange(range);
	return {
		id: serialized.id,
		sourceId: serialized.sourceId,
		beforeCommitId: serialized.beforeCommitId,
		afterCommitId: serialized.afterCommitId,
		...(serialized.sessionId !== undefined
			? { sessionId: serialized.sessionId }
			: {}),
		...(serialized.turnId !== undefined ? { turnId: serialized.turnId } : {}),
		startedAt: serialized.startedAt,
		completedAt: serialized.completedAt,
	};
}
