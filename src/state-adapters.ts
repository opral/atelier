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
	const listeners = new Set<() => void>();
	let startObserving: (() => void) | undefined;
	let stopObserving: (() => void) | undefined;
	const publish = (nextBranchId: string) => {
		if (branchId === nextBranchId) return;
		branchId = nextBranchId;
		for (const listener of [...listeners]) listener();
	};

	if (!branchId) {
		const activeBranchId = (lix as Partial<Lix>).activeBranchId;
		if (typeof activeBranchId === "function") {
			let refreshVersion = 0;
			const refreshActiveBranch = async () => {
				const version = ++refreshVersion;
				try {
					const resolvedBranchId = await activeBranchId.call(lix);
					if (version === refreshVersion) publish(resolvedBranchId);
				} catch (error) {
					if (version !== refreshVersion || isLixWorkerClosed(error)) return;
					console.error("Failed to resolve the active Atelier branch", error);
				}
			};
			void refreshActiveBranch();
			const observe = (lix as Partial<Lix>).observe;
			if (typeof observe === "function") {
				startObserving = () => {
					if (stopObserving) return;
					const events = observe.call(
						lix,
						"SELECT value FROM lix_key_value WHERE key = $1",
						["lix_workspace_branch_id"],
					);
					let observing = true;
					stopObserving = () => {
						if (!observing) return;
						observing = false;
						stopObserving = undefined;
						events.close();
					};
					void (async () => {
						try {
							while (await events.next()) {
								if (!observing) return;
								await refreshActiveBranch();
							}
						} catch (error) {
							if (!observing || isLixWorkerClosed(error)) return;
							console.error(
								"Failed to observe the active Atelier branch",
								error,
							);
						} finally {
							if (observing) {
								observing = false;
								stopObserving = undefined;
								events.close();
							}
						}
					})();
				};
			}
		}
	}

	return {
		getSnapshot: () => branchId,
		subscribe: (listener) => {
			listeners.add(listener);
			startObserving?.();
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) stopObserving?.();
			};
		},
	};
}

function isLixWorkerClosed(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "LIX_ERROR_CLOSED"
	);
}

function jsonEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
