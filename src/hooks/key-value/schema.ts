import {
	DEFAULT_ATELIER_UI_STATE,
	type AtelierUiState,
} from "@/shell/ui-state";

export type KeyValueBranchId = "active" | "global" | string;

export type KeyDef<V> = {
	defaultBranchId: KeyValueBranchId;
	untracked: boolean;
	defaultValue?: V | null;
};

// Atelier keys + per-key defaults
export const KEY_VALUE_DEFINITIONS = {
	// Cross-branch UI state, not change-controlled
	atelier_active_file_id: {
		defaultBranchId: "global",
		untracked: true,
	} as KeyDef<string | null>,

	/**
	 * Serialized layout snapshot for the v2 prototype (panels, tabs, focus).
	 */
	atelier_ui_state: {
		defaultBranchId: "global",
		untracked: true,
		defaultValue: DEFAULT_ATELIER_UI_STATE,
	} as KeyDef<AtelierUiState>,

	// Test-only keys used in unit tests to exercise tracked behavior
	atelier_test_tracked: {
		defaultBranchId: "active",
		untracked: false,
	} as KeyDef<string | null>,

	atelier_test_tracked_external: {
		defaultBranchId: "active",
		untracked: false,
	} as KeyDef<string | null>,

	atelier_test_untracked: {
		defaultBranchId: "global",
		untracked: true,
		defaultValue: null,
	} as KeyDef<string | null>,
} as const;

export type KnownKey = keyof typeof KEY_VALUE_DEFINITIONS;

export type ValueOf<K extends string> = K extends KnownKey
	? (typeof KEY_VALUE_DEFINITIONS)[K] extends KeyDef<infer V>
		? V
		: never
	: unknown;
