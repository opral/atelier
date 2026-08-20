import type { Lix } from "@lix-js/sdk";
import { qb } from "@/lib/lix-kysely";
import { withLixBranchSession } from "@/lib/lix-branch-session";
import { GLOBAL_BRANCH_ID } from "@/lib/global-branch-id";

export const AGENT_TURN_COMMIT_RANGE_KEY =
	"atelier_agent_turn_commit_range" as const;
const AGENT_TURN_COMMIT_RANGE_KEY_PREFIX =
	`${AGENT_TURN_COMMIT_RANGE_KEY}:` as const;

export type AgentTurnCommitRange = {
	readonly id: string;
	readonly sourceId: string;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly sessionId?: string;
	readonly turnId?: string;
	readonly startedAt: number;
	readonly completedAt: number;
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
		return [];
	}
	return [];
}

export async function readAgentTurnCommitRanges(
	lix: Lix,
	branchId?: string,
): Promise<readonly AgentTurnCommitRange[]> {
	const read = async (branchLix: Lix) => {
		const values = await readAgentTurnCommitRangeValues(branchLix);
		return agentTurnCommitRangesFromValues(values);
	};
	const targetBranchId = branchId ?? (await lix.activeBranchId());
	return withLixBranchSession(lix, targetBranchId, read);
}

export async function readAgentTurnCommitRangeValues(
	lix: Lix,
): Promise<readonly unknown[]> {
	const rows = await qb(lix)
		.selectFrom("lix_key_value")
		.select("value")
		.where("key", "like", `${AGENT_TURN_COMMIT_RANGE_KEY}%`)
		.execute();
	return rows.map((row) => row.value);
}

export async function appendAgentTurnCommitRange(
	lix: Lix,
	range: AgentTurnCommitRange,
	options?: { readonly branchId?: string },
): Promise<void> {
	const value = serializeAgentTurnCommitRange(range);
	const write = async (branchLix: Lix, global: boolean) => {
		await qb(branchLix)
			.insertInto("lix_key_value")
			.values({
				key: agentTurnCommitRangeKey(range.id),
				value,
				lixcol_global: global,
				lixcol_untracked: true,
			})
			.onConflict((oc) => oc.column("key").doNothing())
			.execute();
	};
	const targetBranchId = options?.branchId ?? (await lix.activeBranchId());
	await withLixBranchSession(lix, targetBranchId, (branchLix) =>
		write(branchLix, targetBranchId === GLOBAL_BRANCH_ID),
	);
}

function agentTurnCommitRangeKey(rangeId: string): string {
	return `${AGENT_TURN_COMMIT_RANGE_KEY_PREFIX}${encodeURIComponent(rangeId)}`;
}

export function agentTurnCommitRangesFromValues(
	values: readonly unknown[],
): readonly AgentTurnCommitRange[] {
	const byId = new Map<string, AgentTurnCommitRange>();
	for (const value of values) {
		if (!isAgentTurnCommitRange(value) || byId.has(value.id)) continue;
		byId.set(value.id, serializeAgentTurnCommitRange(value));
	}
	return [...byId.values()].sort(
		(left, right) =>
			left.completedAt - right.completedAt || left.id.localeCompare(right.id),
	);
}

function isAgentTurnCommitRange(value: unknown): value is AgentTurnCommitRange {
	if (!value || typeof value !== "object") {
		return false;
	}
	const range = value as Partial<AgentTurnCommitRange>;
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
		(range.turnId === undefined || typeof range.turnId === "string")
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
		startedAt: range.startedAt,
		completedAt: range.completedAt,
	};
}
