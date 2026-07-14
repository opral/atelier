import type { Lix } from "@lix-js/sdk";
import {
	coerceAtelierSessionUiState,
	coerceAtelierUserPreferences,
	type AtelierSessionUiState,
	type AtelierUserPreferencesV1,
} from "./shell/ui-state";

export {
	coerceAtelierSessionUiState,
	coerceAtelierUserPreferences,
} from "./shell/ui-state";
export type {
	AtelierSessionUiState,
	AtelierUserPreferencesV1,
} from "./shell/ui-state";

export type AtelierSessionStateStore = {
	getSnapshot(): AtelierSessionUiState | null;
	setSnapshot(value: AtelierSessionUiState): void;
	subscribe(listener: () => void): () => void;
};

export type AtelierPreferencesStore = {
	load(): Promise<AtelierUserPreferencesV1 | null>;
	save(value: AtelierUserPreferencesV1): Promise<void>;
};

export type AtelierReviewOutcome = "accepted" | "rejected" | "resolved";

export type AtelierReviewResolution = {
	readonly branchId: string;
	readonly reviewId: string;
	readonly fileId: string;
	readonly outcome: AtelierReviewOutcome;
};

export type AtelierReviewStatusStore = {
	loadResolvedReviewIds(branchId: string): Promise<readonly string[]>;
	resolve(review: AtelierReviewResolution): Promise<void>;
};

export type AtelierBranchSession = {
	getSnapshot(): string | null;
	subscribe(listener: () => void): () => void;
	createBranch(name: string): Promise<string>;
	switchBranch(branchId: string): Promise<void>;
};

export function createMemorySessionStateStore(
	initialValue: AtelierSessionUiState | null = null,
): AtelierSessionStateStore {
	let value = initialValue ? coerceAtelierSessionUiState(initialValue) : null;
	const listeners = new Set<() => void>();
	return {
		getSnapshot: () => value,
		setSnapshot: (nextValue) => {
			const next = coerceAtelierSessionUiState(nextValue);
			if (jsonEqual(value, next)) return;
			value = next;
			for (const listener of [...listeners]) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export function createMemoryPreferencesStore(
	initialValue: AtelierUserPreferencesV1 | null = null,
): AtelierPreferencesStore {
	let value = initialValue ? coerceAtelierUserPreferences(initialValue) : null;
	return {
		load: async () => value,
		save: async (nextValue) => {
			value = coerceAtelierUserPreferences(nextValue);
		},
	};
}

export function createMemoryReviewStatusStore(): AtelierReviewStatusStore {
	const resolvedByBranch = new Map<string, Set<string>>();
	return {
		loadResolvedReviewIds: async (branchId) => [
			...(resolvedByBranch.get(branchId) ?? []),
		],
		resolve: async ({ branchId, reviewId }) => {
			const resolved = resolvedByBranch.get(branchId) ?? new Set<string>();
			resolved.add(reviewId);
			resolvedByBranch.set(branchId, resolved);
		},
	};
}

export function createLixBranchSession(
	lix: Lix,
	initialBranchId: string | null = null,
): AtelierBranchSession {
	let branchId = initialBranchId;
	let branchChangeVersion = 0;
	const listeners = new Set<() => void>();
	const publish = (nextBranchId: string) => {
		if (branchId === nextBranchId) return;
		branchId = nextBranchId;
		for (const listener of [...listeners]) listener();
	};

	if (!branchId) {
		const activeBranchId = (lix as Partial<Lix>).activeBranchId;
		if (typeof activeBranchId === "function") {
			const initialVersion = branchChangeVersion;
			void activeBranchId
				.call(lix)
				.then((resolvedBranchId) => {
					if (branchChangeVersion === initialVersion) {
						publish(resolvedBranchId);
					}
				})
				.catch((error: unknown) => {
					console.error("Failed to resolve the active Atelier branch", error);
				});
		}
	}

	return {
		getSnapshot: () => branchId,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		createBranch: async (name) => {
			const branch = await lix.createBranch({ name });
			branchChangeVersion += 1;
			publish(branch.id);
			return branch.id;
		},
		switchBranch: async (nextBranchId) => {
			const receipt = await lix.switchBranch({ branchId: nextBranchId });
			branchChangeVersion += 1;
			publish(receipt.branchId);
		},
	};
}

function jsonEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
