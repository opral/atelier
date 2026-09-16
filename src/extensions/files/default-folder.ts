/**
 * A default folder per file type.
 *
 * Creating a Drawing almost always means putting it in `drawings/`. Set the
 * folder once on the New menu's Drawing row and that row creates there from
 * anywhere in the repository. No default means here — nothing is set until
 * the user sets it.
 *
 * This module is the rule, not the menu. It has no React in it so that the
 * New menu, the `⌘ .` shortcut, and anything else that makes a file without
 * naming a directory can all ask the same question and get the same answer.
 */

import { hasDotPrefixedSegment } from "./build-filesystem-tree";

/**
 * The file types a row can create. `generic` is the plain "New file" row and
 * the `⌘ .` shortcut, which creates a file whose extension the user types —
 * it gets its own default so that the shortcut has a rule to follow rather
 * than being the one creation path the feature forgets.
 *
 * `New folder` is deliberately absent: a folder is not a file type, and a
 * default folder for folders would only mean "nest everything one level in".
 */
export type DefaultFolderFileType =
	| "generic"
	| "markdown"
	| "csv"
	| "excalidraw";

export const DEFAULT_FOLDER_FILE_TYPES: readonly DefaultFolderFileType[] = [
	"generic",
	"markdown",
	"csv",
	"excalidraw",
];

/** One default folder per file type per repository. */
export type DefaultFolders = Readonly<
	Partial<Record<DefaultFolderFileType, string>>
>;

/**
 * Key inside `view.preferences`, which Atelier namespaces by extension id and
 * saves with the workspace — the same store `showHiddenFiles` uses.
 */
export const DEFAULT_FOLDERS_PREFERENCE_KEY = "defaultFolders";

/** How each row names its type in prose: tooltips, headers, the label's menu. */
export function fileTypeNoun(fileType: DefaultFolderFileType): string {
	switch (fileType) {
		case "markdown":
			return "Markdown files";
		case "csv":
			return "CSV files";
		case "excalidraw":
			return "drawings";
		default:
			return "files";
	}
}

/** `/a/b` and `/a/b/` are the same folder; directory paths carry the slash. */
export function ensureDirectoryPath(path: string): string {
	if (path === "" || path === "/") return "/";
	return path.endsWith("/") ? path : `${path}/`;
}

/** The folder's own name, as the tree shows it. The root has no segment. */
export function folderDisplayName(path: string): string {
	const segments = path.split("/").filter(Boolean);
	return segments.at(-1) ?? "Repository root";
}

/** Nesting depth, for the picker's indentation. The root is 0. */
export function folderDepth(path: string): number {
	return path.split("/").filter(Boolean).length;
}

/**
 * Reads whatever the preference store hands back. It is JSON the user's
 * workspace carried across a reload and possibly across a version of this
 * extension, so every entry is checked rather than trusted: an unknown file
 * type or a non-string path is dropped instead of poisoning the rule.
 */
export function parseDefaultFolders(value: unknown): DefaultFolders {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}
	const parsed: Partial<Record<DefaultFolderFileType, string>> = {};
	for (const fileType of DEFAULT_FOLDER_FILE_TYPES) {
		const folder = (value as Record<string, unknown>)[fileType];
		if (typeof folder !== "string" || folder.length === 0) continue;
		parsed[fileType] = ensureDirectoryPath(folder);
	}
	return parsed;
}

/**
 * A key that changes only when the stored folders do. The preference value
 * arrives re-parsed on every render; the rule is wired into callbacks and
 * effects, so it needs a value whose identity means something.
 */
export function defaultFoldersKey(folders: DefaultFolders): string {
	return DEFAULT_FOLDER_FILE_TYPES.map(
		(fileType) => `${fileType}=${folders[fileType] ?? ""}`,
	).join("\n");
}

/**
 * The next stored value. Removing a default deletes its key rather than
 * writing an empty string, so "never set" and "set then removed" read the
 * same on the way back in.
 */
export function withDefaultFolder(
	current: DefaultFolders,
	fileType: DefaultFolderFileType,
	folder: string | null,
): Record<string, string> {
	const next: Record<string, string> = {};
	for (const type of DEFAULT_FOLDER_FILE_TYPES) {
		const value = current[type];
		if (typeof value === "string" && value.length > 0) next[type] = value;
	}
	if (folder === null) {
		delete next[fileType];
	} else {
		next[fileType] = ensureDirectoryPath(folder);
	}
	return next;
}

/**
 * What the row's trailing slot says, and what the row click will do.
 *
 * - `unset` — no default. The slot offers the glyph; the row creates here.
 * - `here` — a default is set and it is the folder in view. Here and the
 *   default are the same place, so the row says nothing at all.
 * - `set` — a default is set elsewhere. The slot names it; the row creates
 *   there.
 * - `missing` — a default is set but its folder is gone (deleted, or renamed:
 *   a rename in lix is a path change we cannot tell apart from a delete plus a
 *   create, so there is nothing to follow). The row falls back to creating
 *   here and the slot says the folder is missing.
 */
export type DefaultFolderState =
	| { readonly kind: "unset" }
	| { readonly kind: "here"; readonly folder: string }
	| { readonly kind: "set"; readonly folder: string }
	| { readonly kind: "missing"; readonly folder: string };

export function defaultFolderState(args: {
	readonly defaultFolder: string | undefined | null;
	readonly hereDirectory: string;
	readonly existingDirectories: ReadonlySet<string>;
}): DefaultFolderState {
	const { defaultFolder, existingDirectories } = args;
	if (typeof defaultFolder !== "string" || defaultFolder.length === 0) {
		return { kind: "unset" };
	}
	const folder = ensureDirectoryPath(defaultFolder);
	const here = ensureDirectoryPath(args.hereDirectory);
	if (folder !== "/" && !existingDirectories.has(folder)) {
		return { kind: "missing", folder };
	}
	if (folder === here) return { kind: "here", folder };
	return { kind: "set", folder };
}

/**
 * Where a new file of this type lands.
 *
 * A one-off beats everything — the user has just said "here, this time" and
 * the default is untouched. Otherwise the type's default wins from anywhere in
 * the repository, and a default whose folder no longer exists falls back to
 * here.
 *
 * Falling back is the deliberate choice among the three on offer. Refusing to
 * create strands the row on a folder the user cannot see. Re-creating the
 * folder puts back something they deleted, behind their back, as a side effect
 * of making an unrelated file. Creating here is what the row did before any
 * default was set, so the row is never inert — and the slot says the folder is
 * missing, with `Recreate folder` one click away, so the fallback is never
 * silent. The stored value is left alone: undo the deletion and the default is
 * armed again.
 */
export function resolveCreateDirectory(args: {
	readonly hereDirectory: string;
	readonly defaultFolder?: string | null;
	readonly existingDirectories: ReadonlySet<string>;
	readonly oneOffHere?: boolean;
}): string {
	const here = ensureDirectoryPath(args.hereDirectory);
	if (args.oneOffHere === true) return here;
	const state = defaultFolderState({
		defaultFolder: args.defaultFolder,
		hereDirectory: here,
		existingDirectories: args.existingDirectories,
	});
	if (state.kind === "set" || state.kind === "here") return state.folder;
	return here;
}

/** One folder as the picker lists it. */
export type PickerFolder = {
	readonly path: string;
	readonly name: string;
	readonly depth: number;
};

/**
 * Every folder in the repository, in tree order, root first.
 *
 * The picker shows all of them at full depth and scrolls rather than stopping
 * at a level: a picker that cannot reach a folder cannot pick it, and the
 * repository's tree is already the only list of folders that exists. Depth
 * only decides indentation, so a deep tree costs vertical space, never
 * reachability.
 */
export function pickerFolders(
	directoryPaths: Iterable<string>,
	options: { readonly showHiddenFiles?: boolean } = {},
): PickerFolder[] {
	const paths = new Set<string>(["/"]);
	for (const path of directoryPaths) {
		const normalized = ensureDirectoryPath(path);
		if (normalized === "/") continue;
		// The picker offers what the tree shows. `.lix/` is the repository's own
		// bookkeeping and offering it as somewhere to keep drawings is noise —
		// but a default already pointing into a hidden folder keeps working,
		// because the rule reads the filesystem, not this list.
		if (!options.showHiddenFiles && hasDotPrefixedSegment(normalized)) continue;
		// Indentation promises a parent. A historical session or a watched
		// entry can hand over a nested path whose parent row never existed, so
		// the missing links are filled in rather than drawn as a lie.
		const segments = normalized.split("/").filter(Boolean);
		let prefix = "/";
		for (const segment of segments) {
			prefix = `${prefix}${segment}/`;
			paths.add(prefix);
		}
	}
	return [...paths]
		.sort((left, right) => left.localeCompare(right))
		.map((path) => ({
			path,
			name: folderDisplayName(path),
			depth: folderDepth(path),
		}));
}

/**
 * What the search matches: the folder's own name and its full path, case
 * insensitively. The name because that is what people remember; the path
 * because two folders can be called `assets` and `src/ext` is how you say
 * which one you mean. The root matches on the words it is labelled with.
 *
 * A folder that matches keeps its ancestors in the list, marked as context, so
 * the result reads as a tree with the indentation still meaning something
 * instead of a flat list of leaves whose indentation is a lie.
 */
export function filterPickerFolders(
	folders: readonly PickerFolder[],
	query: string,
): readonly (PickerFolder & { readonly context: boolean })[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) {
		return folders.map((folder) => ({ ...folder, context: false }));
	}
	const matched = new Set<string>();
	for (const folder of folders) {
		const haystack =
			folder.path === "/"
				? "/ repository root"
				: `${folder.path} ${folder.name}`.toLowerCase();
		if (haystack.includes(needle)) matched.add(folder.path);
	}
	if (matched.size === 0) return [];
	const shown = new Set(matched);
	for (const path of matched) {
		const segments = path.split("/").filter(Boolean);
		let prefix = "/";
		shown.add(prefix);
		for (const segment of segments.slice(0, -1)) {
			prefix = `${prefix}${segment}/`;
			shown.add(prefix);
		}
	}
	return folders
		.filter((folder) => shown.has(folder.path))
		.map((folder) => ({ ...folder, context: !matched.has(folder.path) }));
}
