export type KeyValueBranchId = "active" | "global" | string;

export type KeyDef<V> = {
	defaultBranchId: KeyValueBranchId;
	untracked: boolean;
	defaultValue?: V | null;
	coerce?: (value: unknown) => V;
};

// Generic/test definitions. Personal Atelier state is deliberately not stored
// in Lix because a Lix workspace is shared by every collaborator.
export const KEY_VALUE_DEFINITIONS = {
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
