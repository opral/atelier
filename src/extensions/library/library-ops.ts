import type { Lix } from "@lix-js/sdk";
import { zipSync } from "fflate";
import { decodeFileDataToBytes } from "@/lib/decode-file-data";
import {
	deleteWorkspaceEntry,
	renameWorkspaceEntry,
} from "@/lib/workspace-file-ops";
import type { LibraryData } from "./library-data";

/** A Library item an action applies to: a file by id, a folder by path. */
export type LibraryEntry =
	| {
			readonly type: "file";
			readonly id: string;
			readonly path: string;
			readonly name: string;
	  }
	| {
			readonly type: "directory";
			readonly path: string;
			readonly name: string;
	  };

/** Reverts an action through Lix; history keeps both states either way. */
export type LibraryUndo = () => Promise<void>;

const joinPath = (directory: string, name: string) =>
	directory === "/" ? `/${name}` : `${directory}/${name}`;

const parentOf = (path: string) => {
	const segments = path.split("/").filter(Boolean);
	segments.pop();
	return segments.length ? `/${segments.join("/")}` : "/";
};

/** The rules a name has to follow, said the way a person would fix it. */
export function validateEntryName(name: string): string | null {
	const trimmed = name.trim();
	if (trimmed.length === 0) return "Enter a name.";
	if (trimmed === "." || trimmed === "..") return "Choose another name.";
	if (trimmed.includes("/")) return "Names can’t contain “/”.";
	if (trimmed.includes("\\")) return "Names can’t contain “\\”.";
	// A name starting with "." is hidden everywhere: the item would vanish.
	if (trimmed.startsWith("."))
		return "Names starting with “.” are hidden. Choose another name.";
	if (trimmed.length > 255) return "That name is too long.";
	return null;
}

function takenPaths(data: LibraryData): Set<string> {
	const taken = new Set<string>();
	for (const file of data.files) taken.add(file.path.toLowerCase());
	for (const directory of data.directories)
		taken.add(directory.path.toLowerCase());
	return taken;
}

/** `name`, or `name-2`, `name-3`… — the first free one in `directory`. */
export function freeChildPath(
	taken: ReadonlySet<string>,
	directory: string,
	name: string,
): string {
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot) : "";
	let candidate = joinPath(directory, name);
	for (let suffix = 2; taken.has(candidate.toLowerCase()); suffix += 1)
		candidate = joinPath(directory, `${stem}-${suffix}${extension}`);
	return candidate;
}

export async function renameEntry(
	lix: Lix,
	data: LibraryData,
	entry: LibraryEntry,
	nextName: string,
): Promise<{ readonly path: string; readonly undo: LibraryUndo }> {
	const problem = validateEntryName(nextName);
	if (problem) throw new Error(problem);
	const nextPath = joinPath(parentOf(entry.path), nextName.trim());
	if (nextPath === entry.path) return { path: nextPath, undo: async () => {} };
	if (
		nextPath.toLowerCase() !== entry.path.toLowerCase() &&
		takenPaths(data).has(nextPath.toLowerCase())
	)
		throw new Error(`“${nextName.trim()}” already exists here.`);
	await renameWorkspaceEntry(lix, workspaceRef(entry), nextPath);
	return {
		path: nextPath,
		undo: () =>
			renameWorkspaceEntry(
				lix,
				entry.type === "file"
					? { kind: "file", id: entry.id }
					: { kind: "directory", path: nextPath },
				entry.path,
			),
	};
}

function workspaceRef(entry: LibraryEntry) {
	return entry.type === "file"
		? ({ kind: "file", id: entry.id } as const)
		: ({ kind: "directory", path: entry.path } as const);
}

/** Folders an entry set may move into: not into itself or below itself. */
export function moveDestinations(
	data: LibraryData,
	entries: readonly LibraryEntry[],
	options: { readonly showHidden: boolean },
): readonly string[] {
	const blocked = entries
		.filter((entry) => entry.type === "directory")
		.map((entry) => entry.path);
	return [
		"/",
		...data.directories
			.filter((directory) => options.showHidden || !directory.hidden)
			.map((directory) => directory.path)
			.filter(
				(path) =>
					!blocked.some(
						(blockedPath) =>
							path === blockedPath || path.startsWith(`${blockedPath}/`),
					),
			),
	];
}

export async function moveEntries(
	lix: Lix,
	data: LibraryData,
	entries: readonly LibraryEntry[],
	destination: string,
): Promise<LibraryUndo> {
	const taken = takenPaths(data);
	const moved: { entry: LibraryEntry; to: string }[] = [];
	for (const entry of entries) {
		if (parentOf(entry.path) === destination) continue;
		const to = joinPath(destination, entry.name);
		if (taken.has(to.toLowerCase()))
			throw new Error(`“${entry.name}” already exists in the destination.`);
		taken.add(to.toLowerCase());
		moved.push({ entry, to });
	}
	for (const { entry, to } of moved)
		await renameWorkspaceEntry(lix, workspaceRef(entry), to);
	return async () => {
		for (const { entry, to } of [...moved].reverse())
			await renameWorkspaceEntry(
				lix,
				entry.type === "file"
					? { kind: "file", id: entry.id }
					: { kind: "directory", path: to },
				entry.path,
			);
	};
}

type Snapshot = {
	readonly directories: readonly string[];
	readonly files: readonly {
		readonly id: string;
		readonly path: string;
		readonly content: Uint8Array;
	}[];
};

async function snapshotEntries(
	lix: Lix,
	data: LibraryData,
	entries: readonly LibraryEntry[],
): Promise<Snapshot> {
	const directories = new Set<string>();
	const fileIds = new Set<string>();
	for (const entry of entries) {
		if (entry.type === "file") {
			fileIds.add(entry.id);
			continue;
		}
		directories.add(entry.path);
		const inside = `${entry.path}/`;
		for (const directory of data.directories)
			if (directory.path.startsWith(inside)) directories.add(directory.path);
		for (const file of data.files)
			if (file.path.startsWith(inside)) fileIds.add(file.id);
	}
	const files: Snapshot["files"][number][] = [];
	for (const id of fileIds) {
		const result = await lix.execute(
			"SELECT id, path, content FROM lix_file WHERE id = $1",
			[id],
		);
		const row = result.rows[0] as
			| { id: string; path: string; content: unknown }
			| undefined;
		if (row)
			files.push({
				id: row.id,
				path: row.path,
				content: decodeFileDataToBytes(row.content),
			});
	}
	return {
		directories: [...directories].sort((a, b) => a.length - b.length),
		files,
	};
}

export async function deleteEntries(
	lix: Lix,
	data: LibraryData,
	entries: readonly LibraryEntry[],
): Promise<LibraryUndo> {
	const snapshot = await snapshotEntries(lix, data, entries);
	for (const entry of entries)
		await deleteWorkspaceEntry(
			lix,
			entry.type === "file"
				? { kind: "file", id: entry.id }
				: { kind: "directory", path: entry.path },
		);
	return async () => {
		for (const directory of snapshot.directories) {
			const existing = await lix.execute(
				"SELECT 1 FROM lix_directory WHERE path = $1",
				[directory],
			);
			if (existing.rows.length === 0)
				await lix.execute("INSERT INTO lix_directory (path) VALUES ($1)", [
					directory,
				]);
		}
		for (const file of snapshot.files)
			await lix.execute(
				"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
				[file.id, file.path, file.content],
			);
	};
}

export async function createFolder(
	lix: Lix,
	data: LibraryData,
	parent: string,
	name: string,
): Promise<{ readonly path: string; readonly undo: LibraryUndo }> {
	const problem = validateEntryName(name);
	if (problem) throw new Error(problem);
	const path = joinPath(parent, name.trim());
	if (takenPaths(data).has(path.toLowerCase()))
		throw new Error(`“${name.trim()}” already exists here.`);
	await lix.execute("INSERT INTO lix_directory (path) VALUES ($1)", [path]);
	return {
		path,
		undo: () => deleteWorkspaceEntry(lix, { kind: "directory", path }),
	};
}

/** Creates a new, empty file of a type, named after its title. */
export async function createFile(
	lix: Lix,
	data: LibraryData,
	directory: string,
	name: string,
	content: Uint8Array,
): Promise<{ readonly id: string; readonly path: string }> {
	const path = freeChildPath(takenPaths(data), directory, name);
	const id = crypto.randomUUID();
	await lix.execute(
		"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
		[id, path, content],
	);
	return { id, path };
}

export type UploadEntry =
	| { readonly type: "file"; readonly path: string; readonly file: File }
	| { readonly type: "directory"; readonly path: string };

/** Everything a drop carried, folders walked, with paths relative to it. */
export async function collectDroppedEntries(
	dataTransfer: DataTransfer,
): Promise<UploadEntry[]> {
	const items = [...dataTransfer.items].filter((item) => item.kind === "file");
	const roots = items
		.map((item) =>
			typeof item.webkitGetAsEntry === "function"
				? item.webkitGetAsEntry()
				: null,
		)
		.filter((entry): entry is FileSystemEntry => entry !== null);
	if (roots.length === 0)
		return [...dataTransfer.files].map((file) => ({
			type: "file",
			path: file.name,
			file,
		}));
	const entries: UploadEntry[] = [];
	const walk = async (entry: FileSystemEntry, prefix: string) => {
		const path = `${prefix}${entry.name}`;
		if (entry.isFile) {
			const file = await new Promise<File>((resolve, reject) =>
				(entry as FileSystemFileEntry).file(resolve, reject),
			);
			entries.push({ type: "file", path, file });
			return;
		}
		if (!entry.isDirectory) return;
		entries.push({ type: "directory", path });
		const reader = (entry as FileSystemDirectoryEntry).createReader();
		for (;;) {
			const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
				reader.readEntries(resolve, reject),
			);
			if (batch.length === 0) break;
			for (const child of batch) await walk(child, `${path}/`);
		}
	};
	for (const root of roots) await walk(root, "");
	return entries;
}

export type UploadResult = {
	readonly created: readonly { readonly id: string; readonly path: string }[];
	readonly failed: readonly string[];
	readonly undo: LibraryUndo;
};

/**
 * Imports files into `destination`, keeping dropped folders' structure.
 * Nothing that exists is replaced: a taken name gets a numbered twin.
 */
export async function uploadEntries(
	lix: Lix,
	data: LibraryData,
	destination: string,
	entries: readonly UploadEntry[],
): Promise<UploadResult> {
	const taken = takenPaths(data);
	const created: { id: string; path: string }[] = [];
	const createdDirectories: string[] = [];
	const failed: string[] = [];
	// A dropped folder whose name is taken is imported as its twin, and its
	// contents follow it there.
	const renamedRoots = new Map<string, string>();
	const target = (relative: string) => {
		const segments = relative.split("/").filter(Boolean);
		const root = segments[0]!;
		const mapped = renamedRoots.get(root);
		return mapped
			? `${mapped}${segments.length > 1 ? `/${segments.slice(1).join("/")}` : ""}`
			: joinPath(destination, segments.join("/"));
	};
	for (const entry of entries) {
		if (entry.type !== "directory") continue;
		const isRoot = !entry.path.includes("/");
		let path = target(entry.path);
		if (isRoot && taken.has(path.toLowerCase())) {
			path = freeChildPath(taken, destination, entry.path);
			renamedRoots.set(entry.path, path);
		}
		if (taken.has(path.toLowerCase())) continue;
		try {
			await lix.execute("INSERT INTO lix_directory (path) VALUES ($1)", [path]);
			taken.add(path.toLowerCase());
			createdDirectories.push(path);
		} catch (error) {
			console.error("library: unable to create folder", path, error);
			failed.push(entry.path);
		}
	}
	for (const entry of entries) {
		if (entry.type !== "file") continue;
		const wanted = target(entry.path);
		const path = taken.has(wanted.toLowerCase())
			? freeChildPath(taken, parentOf(wanted), entry.file.name)
			: wanted;
		try {
			const id = crypto.randomUUID();
			const bytes = new Uint8Array(await entry.file.arrayBuffer());
			await lix.execute(
				"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
				[id, path, bytes],
			);
			taken.add(path.toLowerCase());
			created.push({ id, path });
		} catch (error) {
			console.error("library: unable to import", entry.path, error);
			failed.push(entry.path);
		}
	}
	return {
		created,
		failed,
		undo: async () => {
			for (const file of created)
				await deleteWorkspaceEntry(lix, { kind: "file", id: file.id });
			for (const directory of [...createdDirectories].reverse())
				await deleteWorkspaceEntry(lix, { kind: "directory", path: directory });
		},
	};
}

function saveBlob(blob: Blob, name: string): void {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = name;
	anchor.rel = "noopener";
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** One file as itself; a folder, or several items, as a .zip. */
export async function downloadEntries(
	lix: Lix,
	data: LibraryData,
	entries: readonly LibraryEntry[],
): Promise<void> {
	if (entries.length === 1 && entries[0]!.type === "file") {
		const entry = entries[0]!;
		const result = await lix.execute(
			"SELECT content FROM lix_file WHERE id = $1",
			[entry.id],
		);
		const bytes = decodeFileDataToBytes(
			(result.rows[0] as { content?: unknown } | undefined)?.content,
		);
		saveBlob(new Blob([bytes as BlobPart]), entry.name);
		return;
	}
	const snapshot = await snapshotEntries(lix, data, entries);
	const archive: Record<string, Uint8Array> = {};
	const base = entries.length === 1 ? parentOf(entries[0]!.path) : null;
	for (const file of snapshot.files) {
		const relative =
			base === null
				? file.path.replace(/^\/+/, "")
				: file.path.slice(base === "/" ? 1 : base.length + 1);
		archive[relative] = file.content;
	}
	const zipped = zipSync(archive);
	const name =
		entries.length === 1 ? `${entries[0]!.name}.zip` : "library-items.zip";
	saveBlob(new Blob([zipped as BlobPart], { type: "application/zip" }), name);
}
