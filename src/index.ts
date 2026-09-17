export { Atelier } from "./atelier";
export type { AtelierProps } from "./atelier";
export type { AtelierLocation } from "./atelier-state";
export type { AtelierNavigation } from "./atelier-render-context";
export {
	coerceAtelierSessionUiState,
	coerceAtelierUserPreferences,
	createLixBranchSession,
} from "./state-adapters";
export { ATELIER_BUILTIN_EXTENSION_IDS } from "./extension-api";
export { useDebouncedPayloadPersistence } from "./extension-runtime/use-debounced-payload-persistence";
export type { DebouncedPayloadPersistenceOptions } from "./extension-runtime/use-debounced-payload-persistence";
export type {
	AtelierBranchSession,
	AtelierPreferencesStore,
	AtelierReviewResolution,
	AtelierReviewStatusStore,
	AtelierSessionStateStore,
} from "./state-adapters";
export type { AtelierUserPreferencesV1 } from "./shell/ui-state";
export type { AtelierArea, AtelierSlots } from "./create-atelier";
export type {
	// A host that lists changed files reads the session it is inside.
	AtelierDiffSession,
	AtelierEvent,
	AtelierExtensionMenuItems,
	AtelierExtensionRegistration,
	AtelierDocumentLinks,
	AtelierExtensionRuntime,
	AtelierExtensionState,
	AtelierExtensionView,
} from "./extension-api";
export {
	deleteWorkspaceEntry,
	renameWorkspaceEntry,
	WorkspacePathTakenError,
} from "./lib/workspace-file-ops";
export type { WorkspaceEntryRef } from "./lib/workspace-file-ops";

export type { AtelierHistoryProps } from "./history";

/**
 * The diff-type glyph every Atelier surface draws (History, the file tree,
 * the review controls). Hosts that list files render the same shapes from
 * the same source instead of redrawing them.
 */
export { DiffGlyph, WorkingDot } from "./components/diff-glyph";
export type { DiffGlyphKind } from "./components/diff-glyph";

export { AtelierFile } from "./atelier-file";
export type { AtelierFileProps } from "./atelier-file";

/**
 * Atelier's New menu and the rule behind its default folders, for a host that
 * creates files from a surface of its own.
 */
export { NewFileMenu } from "./extensions/files/new-file-menu";
export type { NewFileMenuProps } from "./extensions/files/new-file-menu";
export { useDefaultFolders } from "./extensions/files/use-default-folders";
export {
	pickerFolders,
	resolveCreateDirectory,
	ensureDirectoryPath,
} from "./extensions/files/default-folder";
export type {
	DefaultFolderFileType,
	DefaultFolders,
	PickerFolder,
} from "./extensions/files/default-folder";
