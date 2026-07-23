import type { JsonValue, Lix } from "@lix-js/sdk";
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

export type AtelierClientState = {
	get<T extends JsonValue = JsonValue>(key: string): T | undefined;
	set(key: string, value: JsonValue): Promise<void>;
	subscribe(listener: () => void): () => void;
};

export const ATELIER_SESSION_UI_STATE_KEY = "atelier_session_ui";
export const ATELIER_USER_PREFERENCES_KEY = "atelier_user_preferences";

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

/**
 * Stores Atelier's per-client shell state in Lix client state.
 *
 * The store remains synchronous for React's external-store contract because
 * `lix.clientState` is hydrated before `openLix()` resolves. Writes are
 * optimistic in the current UI and durably queued by Lix.
 */
export function createLixSessionStateStore(
	clientState: AtelierClientState,
	key = ATELIER_SESSION_UI_STATE_KEY,
): AtelierSessionStateStore {
	if (!clientState || typeof clientState !== "object") {
		throw new TypeError(
			"createLixSessionStateStore() requires Lix client state",
		);
	}
	let value = coerceStoredSessionUiState(clientState.get(key));
	const listeners = new Set<() => void>();
	let stopObserving: (() => void) | undefined;
	let pendingWrites = 0;
	const publish = (next: AtelierSessionUiState | null) => {
		if (jsonEqual(value, next)) return;
		value = next;
		for (const listener of [...listeners]) listener();
	};
	return {
		getSnapshot: () => value,
		setSnapshot: (nextValue) => {
			const next = coerceAtelierSessionUiState(nextValue);
			if (jsonEqual(value, next)) return;
			publish(next);
			pendingWrites += 1;
			void (async () => {
				try {
					await clientState.set(key, next as unknown as JsonValue);
				} catch (error: unknown) {
					console.error("Failed to persist Atelier client state", error);
				} finally {
					pendingWrites -= 1;
					if (pendingWrites === 0) {
						publish(coerceStoredSessionUiState(clientState.get(key)));
					}
				}
			})();
		},
		subscribe: (listener) => {
			if (pendingWrites === 0) {
				publish(coerceStoredSessionUiState(clientState.get(key)));
			}
			listeners.add(listener);
			stopObserving ??= clientState.subscribe(() => {
				if (pendingWrites !== 0) return;
				publish(coerceStoredSessionUiState(clientState.get(key)));
			});
			return () => {
				listeners.delete(listener);
				if (listeners.size === 0) {
					stopObserving?.();
					stopObserving = undefined;
				}
			};
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

/** Stores Atelier's per-client layout preferences in Lix client state. */
export function createLixPreferencesStore(
	clientState: AtelierClientState,
	key = ATELIER_USER_PREFERENCES_KEY,
): AtelierPreferencesStore {
	if (!clientState || typeof clientState !== "object") {
		throw new TypeError(
			"createLixPreferencesStore() requires Lix client state",
		);
	}
	return {
		load: async () => coerceStoredUserPreferences(clientState.get(key)),
		save: async (value) => {
			const next = coerceAtelierUserPreferences(value);
			await clientState.set(key, next as unknown as JsonValue);
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
			const subscribeActiveBranch = (lix as Partial<Lix>).subscribeActiveBranch;
			if (typeof subscribeActiveBranch === "function") {
				startObserving = () => {
					if (stopObserving) return;
					stopObserving = subscribeActiveBranch.call(lix, () => {
						void refreshActiveBranch();
					});
				};
			} else {
				const observe = (lix as Partial<Lix>).observe;
				if (typeof observe !== "function") return createStaticBranchSession();
				startObserving = () => {
					if (stopObserving) return;
					const events = observe.call(
						lix,
						"SELECT lix_active_branch_commit_id() AS commit_id",
						[],
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

	function createStaticBranchSession(): AtelierBranchSession {
		return {
			getSnapshot: () => branchId,
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		};
	}
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

function coerceStoredSessionUiState(
	value: unknown,
): AtelierSessionUiState | null {
	if (value === undefined || value === null) return null;
	return coerceAtelierSessionUiState(value as AtelierSessionUiState);
}

function coerceStoredUserPreferences(
	value: unknown,
): AtelierUserPreferencesV1 | null {
	if (value === undefined || value === null) return null;
	return coerceAtelierUserPreferences(value as AtelierUserPreferencesV1);
}
