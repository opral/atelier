import type {
	AtelierExtensionPreferences,
	AtelierExtensionState,
} from "../../extension-api";
import {
	canonicalDirectory,
	type LibraryData,
	type LibraryFile,
} from "./library-data";
import { isLibraryKind, LIBRARY_KIND_COPY, type LibraryKind } from "./kinds";

export const LIBRARY_EXTENSION_ID = "atelier_library";

/**
 * The Library tab the sidebar and a host's routes reuse: an ordinary,
 * closable tab. Closed, the next sidebar click opens it again; ⌘-click opens
 * further ones beside it.
 */
export const LIBRARY_PRIMARY_INSTANCE = "library";

/** Kinds are grids; Files is the folders. The mode follows the section. */
export type LibraryMode = "grid" | "folders";

/** The section a Library tab opens on when nothing says otherwise. */
export const DEFAULT_LIBRARY_KIND: LibraryKind = "all";

/** What a Library tab is showing. It lives in the tab, so reload restores it. */
export type LibraryLocation = {
	readonly kind: LibraryKind;
	readonly mode: LibraryMode;
	/** The open folder in Files; canonical ("/", "/launch"). */
	readonly dirPath: string;
};

export function modeOfKind(kind: LibraryKind): LibraryMode {
	return kind === "files" ? "folders" : "grid";
}

/**
 * Reads a tab's state. A tab saved while the kinds had a folders mode opens
 * that way as Files, the section that is folders now.
 */
export function libraryLocationFromState(
	state: AtelierExtensionState | undefined,
	options: { readonly hasHome?: boolean } = {},
): LibraryLocation {
	const hasHome = options.hasHome ?? true;
	// Home is the host's; without one its tabs open on All.
	const raw = state?.kind === "home" && !hasHome ? "all" : state?.kind;
	const kind: LibraryKind =
		state?.mode === "folders" &&
		raw !== "files" &&
		typeof state.dirPath === "string" &&
		state.dirPath !== "/"
			? "files"
			: isLibraryKind(raw)
				? raw
				: hasHome
					? "home"
					: DEFAULT_LIBRARY_KIND;
	const dirPath =
		kind === "files" && typeof state?.dirPath === "string"
			? canonicalDirectory(state.dirPath)
			: "/";
	return { kind, mode: modeOfKind(kind), dirPath };
}

/** The tab state for a location; the tab reads as the section, or the folder. */
export function libraryState(location: {
	readonly kind: LibraryKind;
	readonly dirPath: string;
}): AtelierExtensionState {
	const dirPath = location.kind === "files" ? location.dirPath : "/";
	const folderName =
		dirPath !== "/" ? dirPath.split("/").filter(Boolean).at(-1) : undefined;
	return {
		kind: location.kind,
		// Written out so a tab saved with an older mode is overwritten.
		mode: modeOfKind(location.kind),
		dirPath,
		atelier: { label: folderName ?? LIBRARY_KIND_COPY[location.kind].label },
	};
}

const RECENT_KEY = "recent";
/** Files taken off Recent: they no longer fill it as recently changed. */
const RECENT_HIDDEN_KEY = "recentHidden";
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

export function hiddenRecentFileIds(
	preferences: AtelierExtensionPreferences,
): ReadonlySet<string> {
	const value = preferences.get(RECENT_HIDDEN_KEY);
	return new Set(
		Array.isArray(value)
			? value.filter((id): id is string => typeof id === "string")
			: [],
	);
}

/**
 * What Recent lists: the files opened last, then — until enough has been
 * opened — the most recently changed ones (data.files is newest first), so
 * the list is never blank.
 */
export function visibleRecentFiles(
	data: LibraryData,
	ids: readonly string[],
	hidden: ReadonlySet<string> = new Set(),
): LibraryFile[] {
	const byId = new Map(data.files.map((file) => [file.id, file]));
	const files: LibraryFile[] = [];
	for (const id of ids) {
		const file = byId.get(id);
		if (file && !file.hidden) files.push(file);
		if (files.length === RECENT_LIMIT) return files;
	}
	for (const file of data.files) {
		if (files.length >= RECENT_LIMIT) break;
		if (!file.hidden && !hidden.has(file.id) && !files.includes(file))
			files.push(file);
	}
	return files;
}

/**
 * Records an opened file. A file Recent already shows keeps its place — the
 * list must not jump under the pointer that clicked it; the order on screen
 * is kept as it stands. A file it does not show enters at the top.
 */
export function recordRecentFile(
	preferences: AtelierExtensionPreferences,
	data: LibraryData,
	fileId: string,
): void {
	const stored = recentFileIds(preferences);
	const hidden = hiddenRecentFileIds(preferences);
	if (hidden.has(fileId))
		preferences.set(
			RECENT_HIDDEN_KEY,
			[...hidden].filter((id) => id !== fileId),
		);
	const visible = visibleRecentFiles(data, stored, hidden).map(
		(file) => file.id,
	);
	// Recent shows the stored ids in order, then fillers. Keeping the stored
	// order (appending fillers up to this one) keeps the screen as it is,
	// and keeps a file that is briefly gone (deleted, then undone) in its
	// place for when it returns.
	const fillers = visible.filter((id) => !stored.includes(id));
	const next = visible.includes(fileId)
		? [...stored, ...fillers.slice(0, fillers.indexOf(fileId) + 1)]
		: [fileId, ...stored.filter((id) => id !== fileId)];
	const trimmed = next.slice(0, 24);
	if (
		trimmed.length === stored.length &&
		trimmed.every((id, index) => id === stored[index])
	)
		return;
	preferences.set(RECENT_KEY, trimmed);
}

/** Takes a file off Recent; the file itself is untouched. */
export function forgetRecentFile(
	preferences: AtelierExtensionPreferences,
	data: LibraryData,
	fileId: string,
): void {
	const stored = recentFileIds(preferences);
	const hidden = hiddenRecentFileIds(preferences);
	// Freeze what is on screen first, so the gap closes instead of the list
	// reshuffling around it.
	const visible = visibleRecentFiles(data, stored, hidden).map(
		(file) => file.id,
	);
	preferences.set(RECENT_HIDDEN_KEY, [...hidden, fileId].slice(-200));
	preferences.set(
		RECENT_KEY,
		[...visible, ...stored.filter((id) => !visible.includes(id))]
			.filter((id) => id !== fileId)
			.slice(0, 24),
	);
}
