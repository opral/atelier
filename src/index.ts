export { Atelier } from "./atelier";
export type { AtelierProps } from "./atelier";
export { loadAtelier } from "./load-atelier";
export type { AtelierInitialState, AtelierLocation, LoadAtelierOptions } from "./atelier-state";
export type { AtelierNavigation } from "./atelier-render-context";
export {
	coerceAtelierSessionUiState,
	coerceAtelierUserPreferences,
	createLixBranchSession,
	createMemoryPreferencesStore,
	createMemoryReviewStatusStore,
	createMemorySessionStateStore,
} from "./state-adapters";
export { ATELIER_BUILTIN_EXTENSION_IDS } from "./extension-api";
export { useDebouncedPayloadPersistence } from "./extension-runtime/use-debounced-payload-persistence";
export type { DebouncedPayloadPersistenceOptions } from "./extension-runtime/use-debounced-payload-persistence";
export type {
	AtelierCentralPanelOptions,
	AtelierSidePanel,
} from "./atelier-instance";
export type {
	AtelierBranchSession,
	AtelierPreferencesStore,
	AtelierReviewOutcome,
	AtelierReviewResolution,
	AtelierReviewStatusStore,
	AtelierSessionStateStore,
} from "./state-adapters";
export type {
	AtelierSessionUiState,
	AtelierUserPreferencesV1,
} from "./shell/ui-state";
export type {
	AtelierEmptyPanelSlot,
	AtelierEmptyPanelSlotContext,
	AtelierErrorFallback,
	AtelierErrorFallbackContext,
	AtelierPanelSide,
	AtelierSkeletonProps,
	AtelierSlots,
	AtelierTabStripContext,
	AtelierTabStripTab,
	AtelierTopBarProps,
} from "./create-atelier";
export type {
	AtelierBuiltinExtensionId,
	AtelierDocumentOpenOptions,
	AtelierDocumentOrigin,
	AtelierDocumentsApi,
	AtelierEvent,
	AtelierExtensionActionMenuItem,
	AtelierExtensionCheckboxMenuItem,
	AtelierExtensionMenuItem,
	AtelierExtensionMenuItems,
	AtelierExtensionPreferences,
	AtelierExtensionRegistration,
	AtelierExtensionSeparatorMenuItem,
	AtelierExtensionRuntime,
	AtelierExtensionState,
	AtelierDiffApi,
	AtelierDiffFile,
	AtelierDiffRef,
	AtelierDiffSession,
	AtelierExtensionView,
	AtelierFilesViewOptions,
	AtelierJsonValue,
	AtelierViewOpenOptions,
	AtelierViewsApi,
	AtelierWatchedEntry,
	ExtensionManifest,
} from "./extension-api";
export {
	deleteWorkspaceEntry,
	renameWorkspaceEntry,
	WorkspacePathTakenError,
} from "./lib/workspace-file-ops";
export type { WorkspaceEntryRef } from "./lib/workspace-file-ops";
export { AtelierDeveloperTools } from "./dev-tools/developer-tools-menu";
export {
	applyDeveloperWorkflowScenario,
	simulateMarkdownAgentWorkflow,
} from "./dev-tools/simulate-agent-workflow";
export type {
	DeveloperWorkflowScenario,
	SimulatedAgentWorkflow,
} from "./dev-tools/simulate-agent-workflow";

export type { AtelierHistoryProps } from "./history";
