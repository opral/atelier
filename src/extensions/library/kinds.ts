import type { AtelierLibraryKind } from "../../extension-api";
import { findFileHandlerExtension } from "../../extension-runtime/file-handlers";
import type { ExtensionDefinition } from "../../extension-runtime/types";

/**
 * A Library filter. The kinds a file handler can declare, plus the two the
 * Library adds itself: everything, and everything no handler claims.
 */
export type LibraryKind = "all" | AtelierLibraryKind | "other";

export const LIBRARY_KINDS: readonly LibraryKind[] = [
	"all",
	"pages",
	"tables",
	"drawings",
	"media",
	"other",
];

export type LibraryKindCopy = {
	readonly label: string;
	/** "page" / "pages", for counts: "2 pages". */
	readonly one: string;
	readonly many: string;
	readonly emptyTitle: string;
	readonly emptyBody: string;
	/** The New action an empty kind offers; absent offers Upload only. */
	readonly createLabel?: string;
};

export const LIBRARY_KIND_COPY: Record<LibraryKind, LibraryKindCopy> = {
	all: {
		label: "All",
		one: "item",
		many: "items",
		emptyTitle: "Nothing here yet",
		emptyBody: "Create something with New, or drop files and folders here.",
	},
	pages: {
		label: "Pages",
		one: "page",
		many: "pages",
		emptyTitle: "No pages yet",
		emptyBody: "Create one, or drop a .md file here.",
		createLabel: "New page",
	},
	tables: {
		label: "Tables",
		one: "table",
		many: "tables",
		emptyTitle: "No tables yet",
		emptyBody: "Create one, or drop a .csv file here.",
		createLabel: "New table",
	},
	drawings: {
		label: "Drawings",
		one: "drawing",
		many: "drawings",
		emptyTitle: "No drawings yet",
		emptyBody: "Create one, or drop an .excalidraw file here.",
		createLabel: "New drawing",
	},
	media: {
		label: "Media",
		one: "file",
		many: "files",
		emptyTitle: "No media yet",
		emptyBody: "Drop images, videos or PDFs here, or upload them.",
	},
	other: {
		label: "Other",
		one: "file",
		many: "files",
		emptyTitle: "Nothing else here",
		emptyBody:
			"Files no other kind claims — config, code, text, archives — show up here.",
	},
};

export function isLibraryKind(value: unknown): value is LibraryKind {
	return (
		typeof value === "string" && LIBRARY_KINDS.includes(value as LibraryKind)
	);
}

export function countLabel(kind: LibraryKind, count: number): string {
	const copy = LIBRARY_KIND_COPY[kind];
	return `${count} ${count === 1 ? copy.one : copy.many}`;
}

/**
 * The kind of a file: the kind its handler declares, or "other". The text
 * view is the fallback that opens anything, and it declares nothing, so a
 * file only it would open reads as Other.
 */
export function libraryKindOfPath(
	extensions: Iterable<ExtensionDefinition>,
	path: string,
): Exclude<LibraryKind, "all"> {
	return findFileHandlerExtension(extensions, path)?.libraryKind ?? "other";
}

export function matchesLibraryKind(
	kind: LibraryKind,
	fileKind: Exclude<LibraryKind, "all">,
): boolean {
	return kind === "all" || kind === fileKind;
}

/** Dotfiles and anything under a dot-folder (`.lix/`) stay out of Grid. */
export function isHiddenPath(path: string): boolean {
	return path.split("/").some((segment) => segment.startsWith("."));
}

export function fileNameOf(path: string): string {
	return path.split("/").filter(Boolean).at(-1) ?? path;
}

/** The folder a file sits in, as a faint hint: "launch/", or "" at root. */
export function parentHintOf(path: string): string {
	const segments = path.split("/").filter(Boolean);
	segments.pop();
	return segments.length > 0 ? `${segments.at(-1)}/` : "";
}

/** The directory a file sits in, canonical: "/launch", or "/" at root. */
export function parentDirectoryOf(path: string): string {
	const segments = path.split("/").filter(Boolean);
	segments.pop();
	return segments.length > 0 ? `/${segments.join("/")}` : "/";
}

/**
 * The name a person reads for a file. Pages, tables and drawings are
 * documents, and read by their title: `customer-interviews.csv` is
 * "Customer interviews", `README.md` stays "README". Media and everything
 * else keep their file name — a `.png` or a `.json` is a file first.
 */
export function libraryDisplayName(
	path: string,
	kind: Exclude<LibraryKind, "all">,
): string {
	const name = fileNameOf(path);
	if (kind === "media" || kind === "other") return name;
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const spaced = stem.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
	if (spaced.length === 0) return name;
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
