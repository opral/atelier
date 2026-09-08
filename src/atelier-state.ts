import type { Lix, ResultColumn } from "@lix-js/sdk";
import type {
	AtelierExtensionRegistration,
	AtelierJsonValue,
} from "./extension-api";
import type {
	AtelierCentralPanelOptions,
	AtelierSidePanel,
} from "./atelier-instance";
import type {
	AtelierSessionUiState,
	AtelierUserPreferencesV1,
} from "./state-adapters";
import type { ExtensionInstance } from "./extension-runtime/types";

export type AtelierPreparedUiState = {
	readonly focusedPanel: AtelierSessionUiState["focusedPanel"];
	readonly panels: Record<
		AtelierSessionUiState["focusedPanel"],
		{
			readonly activeInstance: string | null;
			readonly views: (Omit<ExtensionInstance, "state"> & {
				readonly state?: Readonly<Record<string, AtelierJsonValue>>;
			})[];
		}
	>;
};

/** A repository path or an extension-owned view. */
export type AtelierLocation =
	| { readonly path: string; readonly branchId?: string }
	| {
			readonly view: string;
			readonly state?: AtelierJsonValue;
			readonly branchId?: string;
	  };

/** JSON-safe SQL data, encoded by Atelier rather than a framework serializer. */
export type AtelierQuerySnapshot = {
	readonly sql: string;
	readonly columns: readonly ResultColumn[];
	readonly params: readonly AtelierJsonValue[];
	readonly rows: readonly AtelierJsonValue[];
};

export type AtelierPreparedView = {
	readonly extensionId: string;
	readonly data: AtelierJsonValue;
};

/** The complete, portable first render. Contains no Lix handle or credentials. */
export type AtelierInitialState = {
	readonly version: 1;
	readonly identity: string;
	readonly branchId: string;
	readonly commitId: string | null;
	readonly location: AtelierLocation;
	readonly readOnly: boolean;
	readonly ui: AtelierPreparedUiState;
	readonly preferences: AtelierUserPreferencesV1;
	readonly queries: readonly AtelierQuerySnapshot[];
	readonly views: Readonly<Record<string, AtelierPreparedView>>;
};

export type LoadAtelierOptions = {
	/** Borrowed for preparation. The caller owns this handle and closes it. */
	readonly lix: Lix;
	readonly location?: AtelierLocation;
	readonly extensions?: readonly AtelierExtensionRegistration[];
	readonly readOnly?: boolean;
	readonly defaultOpenPanels?: readonly AtelierSidePanel[];
	readonly centralPanel?: AtelierCentralPanelOptions;
	readonly signal?: AbortSignal;
};
