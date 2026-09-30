import type {
	AtelierExtensionPreferences,
	AtelierExtensionState,
} from "../../extension-api";
import { canonicalDirectory } from "./library-data";
import { isLibraryKind, LIBRARY_KIND_COPY, type LibraryKind } from "./kinds";

export const LIBRARY_EXTENSION_ID = "atelier_library";

export type LibraryMode = "grid" | "folders";

/** What a Library tab is showing. It lives in the tab, so reload restores it. */
export type LibraryLocation = {
	readonly kind: LibraryKind;
	readonly mode: LibraryMode;
	/** The open folder in Folders mode; canonical ("/", "/launch"). */
	readonly dirPath: string;
};

export function libraryLocationFromState(
	state: AtelierExtensionState | undefined,
	preferences: AtelierExtensionPreferences,
): LibraryLocation {
	const kind = isLibraryKind(state?.kind) ? state.kind : "all";
	const mode =
		state?.mode === "grid" || state?.mode === "folders"
			? state.mode
			: preferredMode(preferences, kind);
	const dirPath =
		typeof state?.dirPath === "string"
			? canonicalDirectory(state.dirPath)
			: "/";
	return { kind, mode, dirPath };
}

/** The tab state for a location; the tab reads as the kind, or the folder. */
export function libraryState(location: LibraryLocation): AtelierExtensionState {
	const folderName =
		location.mode === "folders" && location.dirPath !== "/"
			? location.dirPath.split("/").filter(Boolean).at(-1)
			: undefined;
	return {
		kind: location.kind,
		mode: location.mode,
		dirPath: location.dirPath,
		atelier: { label: folderName ?? LIBRARY_KIND_COPY[location.kind].label },
	};
}

const modeKey = (kind: LibraryKind) => `mode.${kind}`;

/** Mode is remembered per kind; the default is Grid. */
export function preferredMode(
	preferences: AtelierExtensionPreferences,
	kind: LibraryKind,
): LibraryMode {
	return preferences.get(modeKey(kind)) === "folders" ? "folders" : "grid";
}

export function rememberMode(
	preferences: AtelierExtensionPreferences,
	kind: LibraryKind,
	mode: LibraryMode,
): void {
	if (preferredMode(preferences, kind) === mode) return;
	preferences.set(modeKey(kind), mode);
}

const RECENT_KEY = "recent";
export const RECENT_LIMIT = 6;

/** Recently opened file ids, most recent first. */
export function recentFileIds(
	preferences: AtelierExtensionPreferences,
): readonly string[] {
	const value = preferences.get(RECENT_KEY);
	return Array.isArray(value)
		? value.filter((id): id is string => typeof id === "string")
		: [];
}

export function pushRecentFile(
	preferences: AtelierExtensionPreferences,
	fileId: string,
): void {
	const current = recentFileIds(preferences);
	if (current[0] === fileId) return;
	preferences.set(
		RECENT_KEY,
		[fileId, ...current.filter((id) => id !== fileId)].slice(0, 24),
	);
}
