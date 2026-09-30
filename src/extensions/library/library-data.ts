import { useMemo } from "react";
import { useQueryResult } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { useExtensionRegistry } from "../../extension-runtime/extension-registry";
import type { ExtensionRuntime } from "../../extension-runtime/types";
import type { DiffGlyphKind } from "@/components/diff-glyph";
import {
	isHiddenPath,
	libraryDisplayName,
	libraryKindOfPath,
	matchesLibraryKind,
	parentDirectoryOf,
	type LibraryKind,
} from "./kinds";

export type LibraryFile = {
	readonly id: string;
	readonly path: string;
	readonly name: string;
	readonly directory: string;
	readonly kind: Exclude<LibraryKind, "all">;
	readonly displayName: string;
	readonly updatedAt: string;
	readonly hidden: boolean;
};

export type LibraryDirectory = {
	readonly id: string;
	/** Canonical: absolute, no trailing slash. */
	readonly path: string;
	readonly name: string;
	readonly updatedAt: string;
	readonly hidden: boolean;
};

export type LibraryData = {
	readonly files: readonly LibraryFile[];
	readonly directories: readonly LibraryDirectory[];
};

type FileRow = {
	readonly id: string;
	readonly path: string;
	readonly name: string;
	readonly updated_at: string | null;
};

type DirectoryRow = {
	readonly id: string;
	readonly path: string;
	readonly name: string;
	readonly updated_at: string | null;
};

export function canonicalDirectory(path: string): string {
	const absolute = path.startsWith("/") ? path : `/${path}`;
	return absolute.replace(/\/+$/, "") || "/";
}

/**
 * Every file and folder in the workspace, each file with its Library kind.
 * `null` until both reads have landed; the caller keeps its frame meanwhile.
 */
export function useLibraryData(): {
	readonly data: LibraryData | null;
	readonly error: Error | null;
} {
	const { extensionMap } = useExtensionRegistry();
	const files = useQueryResult<FileRow>(
		(lix) =>
			qb(lix)
				.selectFrom("lix_file")
				.select(["id", "path", "name"])
				.select((eb) => eb.ref("lixcol_updated_at").as("updated_at"))
				.$castTo<FileRow>(),
		{ reuseObservedResult: false },
	);
	const directories = useQueryResult<DirectoryRow>(
		(lix) =>
			qb(lix)
				.selectFrom("lix_directory")
				.select(["id", "path", "name"])
				.select((eb) => eb.ref("lixcol_updated_at").as("updated_at"))
				.$castTo<DirectoryRow>(),
		{ reuseObservedResult: false },
	);
	const extensions = useMemo(() => [...extensionMap.values()], [extensionMap]);
	const data = useMemo<LibraryData | null>(() => {
		if (files.status !== "success" || directories.status !== "success")
			return null;
		return {
			files: files.rows
				.filter((row) => typeof row.path === "string")
				.map((row) => {
					const kind = libraryKindOfPath(extensions, row.path);
					return {
						id: row.id,
						path: row.path,
						name: row.name,
						directory: parentDirectoryOf(row.path),
						kind,
						displayName: libraryDisplayName(row.path, kind),
						updatedAt: row.updated_at ?? "",
						hidden: isHiddenPath(row.path),
					};
				})
				.sort(newestFirst),
			directories: directories.rows
				.filter((row) => typeof row.path === "string")
				.map((row) => ({
					id: row.id,
					path: canonicalDirectory(row.path),
					name: row.name,
					updatedAt: row.updated_at ?? "",
					hidden: isHiddenPath(row.path),
				}))
				.sort((left, right) => left.name.localeCompare(right.name)),
		};
	}, [directories, extensions, files]);
	const error =
		files.status === "error"
			? files.error
			: directories.status === "error"
				? directories.error
				: null;
	return { data, error: error instanceof Error ? error : null };
}

export function newestFirst(
	left: { readonly updatedAt: string; readonly path: string },
	right: { readonly updatedAt: string; readonly path: string },
): number {
	const byTime = right.updatedAt.localeCompare(left.updatedAt);
	return byTime !== 0 ? byTime : left.path.localeCompare(right.path);
}

/** Grid: every visible file of a kind, from every folder, newest first. */
export function gridFiles(
	data: LibraryData,
	kind: LibraryKind,
): readonly LibraryFile[] {
	return data.files.filter(
		(file) => !file.hidden && matchesLibraryKind(kind, file.kind),
	);
}

export type FolderListing = {
	readonly folders: readonly {
		readonly directory: LibraryDirectory;
		/** Files of the active kind anywhere under the folder. */
		readonly count: number;
	}[];
	readonly files: readonly LibraryFile[];
	/** Whether the folder itself exists (the root always does). */
	readonly exists: boolean;
};

/**
 * One level of the filesystem. Under a kind, only folders holding that kind
 * are listed, counted in it; files of other kinds stay, dimmed by the view.
 */
export function folderListing(
	data: LibraryData,
	dirPath: string,
	kind: LibraryKind,
	options: { readonly showHidden: boolean },
): FolderListing {
	const directory = canonicalDirectory(dirPath);
	const exists =
		directory === "/" ||
		data.directories.some((candidate) => candidate.path === directory);
	const prefix = directory === "/" ? "/" : `${directory}/`;
	const visible = (hidden: boolean) => options.showHidden || !hidden;
	const folders = data.directories
		.filter(
			(candidate) =>
				visible(candidate.hidden) &&
				parentDirectoryOf(candidate.path) === directory,
		)
		.map((candidate) => {
			const inside = `${candidate.path}/`;
			let count = 0;
			let entries = 0;
			for (const file of data.files) {
				if (!file.path.startsWith(inside) || !visible(file.hidden)) continue;
				entries += 1;
				if (matchesLibraryKind(kind, file.kind)) count += 1;
			}
			if (kind === "all") {
				for (const nested of data.directories)
					if (nested.path.startsWith(inside) && visible(nested.hidden))
						entries += 1;
			}
			return { directory: candidate, count: kind === "all" ? entries : count };
		})
		.filter((folder) => kind === "all" || folder.count > 0);
	const files = data.files
		.filter(
			(file) =>
				visible(file.hidden) &&
				file.directory === directory &&
				file.path.startsWith(prefix),
		)
		.slice()
		.sort((left, right) => {
			const leftReadme = left.name.toLowerCase() === "readme.md" ? 1 : 0;
			const rightReadme = right.name.toLowerCase() === "readme.md" ? 1 : 0;
			if (leftReadme !== rightReadme) return rightReadme - leftReadme;
			return newestFirst(left, right);
		});
	return { folders, files, exists };
}

export type LibraryReviewMarks = {
	readonly active: boolean;
	readonly files: ReadonlyMap<string, DiffGlyphKind>;
	/** Folders holding a changed file: "added" when all they hold is new. */
	readonly directories: ReadonlyMap<string, "added" | "modified">;
	readonly kinds: ReadonlySet<Exclude<LibraryKind, "all">>;
};

const NO_REVIEW: LibraryReviewMarks = {
	active: false,
	files: new Map(),
	directories: new Map(),
	kinds: new Set(),
};

/**
 * The open review's marks, rolled up from files to folders and kinds. No
 * session, no marks: ordinary browsing never shows change state.
 */
export function useLibraryReviewMarks(
	atelier: ExtensionRuntime,
	data: LibraryData | null,
): LibraryReviewMarks {
	const session = atelier.diff?.session ?? null;
	const { extensionMap } = useExtensionRegistry();
	return useMemo(() => {
		if (!session || session.files.length === 0) return NO_REVIEW;
		const extensions = [...extensionMap.values()];
		const files = new Map<string, DiffGlyphKind>();
		const kinds = new Set<Exclude<LibraryKind, "all">>();
		const directories = new Map<string, "added" | "modified">();
		for (const file of session.files) {
			if (file.review?.status === "resolved") continue;
			const glyph: DiffGlyphKind =
				file.changeKind === "modified" && file.movedFromPath
					? "moved"
					: file.changeKind;
			files.set(file.path, glyph);
			kinds.add(libraryKindOfPath(extensions, file.path));
			const segments = file.path.split("/").filter(Boolean);
			segments.pop();
			let prefix = "";
			for (const segment of segments) {
				prefix = `${prefix}/${segment}`;
				const previous = directories.get(prefix);
				directories.set(
					prefix,
					glyph === "added" && previous !== "modified" ? "added" : "modified",
				);
			}
		}
		// A folder is only "added" when nothing already in it predates the turn.
		if (data) {
			for (const [directory, status] of directories) {
				if (status !== "added") continue;
				const inside = `${directory}/`;
				const holdsOld = data.files.some(
					(file) => file.path.startsWith(inside) && !files.has(file.path),
				);
				if (holdsOld) directories.set(directory, "modified");
			}
		}
		return { active: files.size > 0, files, directories, kinds };
	}, [data, extensionMap, session]);
}
