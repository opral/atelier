import { describe, expect, test } from "vitest";
import { coerceAtelierUserPreferences } from "@/shell/ui-state";
import {
	DEFAULT_FOLDERS_PREFERENCE_KEY,
	defaultFolderState,
	defaultFoldersKey,
	filterPickerFolders,
	fileTypeNoun,
	parseDefaultFolders,
	pickerFolders,
	resolveCreateDirectory,
	withDefaultFolder,
} from "./default-folder";

const DIRECTORIES = new Set([
	"/drawings/",
	"/src/",
	"/src/agents/",
	"/.lix/",
	"/assets/",
]);

describe("the resolution rule", () => {
	test("no default means here", () => {
		expect(
			resolveCreateDirectory({
				hereDirectory: "/src/",
				existingDirectories: DIRECTORIES,
			}),
		).toBe("/src/");
	});

	test("a default wins over here, from anywhere in the repository", () => {
		for (const here of ["/", "/src/", "/src/agents/", "/assets/"]) {
			expect(
				resolveCreateDirectory({
					hereDirectory: here,
					defaultFolder: "/drawings/",
					existingDirectories: DIRECTORIES,
				}),
			).toBe("/drawings/");
		}
	});

	test("a one-off beats the default and leaves it alone", () => {
		expect(
			resolveCreateDirectory({
				hereDirectory: "/src/",
				defaultFolder: "/drawings/",
				existingDirectories: DIRECTORIES,
				oneOffHere: true,
			}),
		).toBe("/src/");
	});

	test("inside the default folder, here and the default are the same place", () => {
		expect(
			resolveCreateDirectory({
				hereDirectory: "/drawings/",
				defaultFolder: "/drawings/",
				existingDirectories: DIRECTORIES,
			}),
		).toBe("/drawings/");
		expect(
			defaultFolderState({
				hereDirectory: "/drawings/",
				defaultFolder: "/drawings/",
				existingDirectories: DIRECTORIES,
			}),
		).toEqual({ kind: "here", folder: "/drawings/" });
	});

	test("a default whose folder is gone falls back to here", () => {
		expect(
			resolveCreateDirectory({
				hereDirectory: "/src/",
				defaultFolder: "/drawings/",
				existingDirectories: new Set(["/src/"]),
			}),
		).toBe("/src/");
		expect(
			defaultFolderState({
				hereDirectory: "/src/",
				defaultFolder: "/drawings/",
				existingDirectories: new Set(["/src/"]),
			}),
		).toEqual({ kind: "missing", folder: "/drawings/" });
	});

	test("the repository root is always a place that exists", () => {
		expect(
			resolveCreateDirectory({
				hereDirectory: "/src/",
				defaultFolder: "/",
				existingDirectories: new Set(),
			}),
		).toBe("/");
	});

	test("a trailing slash is not part of the answer", () => {
		expect(
			resolveCreateDirectory({
				hereDirectory: "/src",
				defaultFolder: "/drawings",
				existingDirectories: DIRECTORIES,
			}),
		).toBe("/drawings/");
	});

	test("an empty or absent default is not a default", () => {
		for (const defaultFolder of [undefined, null, ""]) {
			expect(
				defaultFolderState({
					hereDirectory: "/src/",
					defaultFolder,
					existingDirectories: DIRECTORIES,
				}),
			).toEqual({ kind: "unset" });
		}
	});
});

describe("persistence", () => {
	test("round-trips one default folder per file type", () => {
		const stored = withDefaultFolder({}, "excalidraw", "/drawings/");
		expect(stored).toEqual({ excalidraw: "/drawings/" });
		expect(parseDefaultFolders(stored)).toEqual({ excalidraw: "/drawings/" });
	});

	test("keeps the other types when one changes", () => {
		const first = withDefaultFolder({}, "excalidraw", "/drawings/");
		const second = withDefaultFolder(
			parseDefaultFolders(first),
			"markdown",
			"/notes/",
		);
		expect(second).toEqual({
			excalidraw: "/drawings/",
			markdown: "/notes/",
		});
	});

	test("removing a default deletes the key rather than blanking it", () => {
		const stored = withDefaultFolder(
			{ excalidraw: "/drawings/", csv: "/data/" },
			"excalidraw",
			null,
		);
		expect(stored).toEqual({ csv: "/data/" });
		expect("excalidraw" in stored).toBe(false);
	});

	test("normalizes what it stores and what it reads", () => {
		expect(withDefaultFolder({}, "csv", "/data")).toEqual({ csv: "/data/" });
		expect(parseDefaultFolders({ csv: "/data" })).toEqual({ csv: "/data/" });
	});

	test("survives junk from an older workspace", () => {
		expect(parseDefaultFolders(undefined)).toEqual({});
		expect(parseDefaultFolders(null)).toEqual({});
		expect(parseDefaultFolders("drawings")).toEqual({});
		expect(parseDefaultFolders(["/drawings/"])).toEqual({});
		expect(
			parseDefaultFolders({
				excalidraw: "/drawings/",
				markdown: 7,
				csv: "",
				png: "/images/",
			}),
		).toEqual({ excalidraw: "/drawings/" });
	});

	test("survives the workspace store's own coercion", () => {
		const preferences = coerceAtelierUserPreferences({
			version: 1,
			layout: { sizes: {} },
			review: { autoAcceptAgentChanges: false },
			extensions: {
				atelier_files: {
					showHiddenFiles: true,
					[DEFAULT_FOLDERS_PREFERENCE_KEY]: withDefaultFolder(
						{},
						"excalidraw",
						"/drawings/",
					),
				},
			},
		});
		expect(
			parseDefaultFolders(
				preferences.extensions?.atelier_files?.[DEFAULT_FOLDERS_PREFERENCE_KEY],
			),
		).toEqual({ excalidraw: "/drawings/" });
	});

	test("the memo key tracks content, not identity", () => {
		expect(defaultFoldersKey({ excalidraw: "/drawings/" })).toBe(
			defaultFoldersKey(parseDefaultFolders({ excalidraw: "/drawings" })),
		);
		expect(defaultFoldersKey({ excalidraw: "/drawings/" })).not.toBe(
			defaultFoldersKey({ excalidraw: "/sketches/" }),
		);
		expect(defaultFoldersKey({ excalidraw: "/drawings/" })).not.toBe(
			defaultFoldersKey({}),
		);
	});
});

describe("the picker's folders", () => {
	test("lists every folder in tree order with the root first", () => {
		expect(pickerFolders(["/src/agents/", "/src/", "/assets/"])).toEqual([
			{ path: "/", name: "Repository root", depth: 0 },
			{ path: "/assets/", name: "assets", depth: 1 },
			{ path: "/src/", name: "src", depth: 1 },
			{ path: "/src/agents/", name: "agents", depth: 2 },
		]);
	});

	test("hides what the tree hides, unless hidden files are shown", () => {
		expect(pickerFolders(["/.lix/", "/src/"]).map((f) => f.path)).toEqual([
			"/",
			"/src/",
		]);
		expect(
			pickerFolders(["/.lix/", "/src/"], { showHiddenFiles: true }).map(
				(f) => f.path,
			),
		).toEqual(["/", "/.lix/", "/src/"]);
	});

	test("search matches the name and the path, and keeps ancestors as context", () => {
		const folders = pickerFolders([
			"/src/",
			"/src/agents/",
			"/assets/",
			"/docs/assets/",
		]);
		expect(
			filterPickerFolders(folders, "agents").map((f) => [f.path, f.context]),
		).toEqual([
			["/", true],
			["/src/", true],
			["/src/agents/", false],
		]);
		expect(
			filterPickerFolders(folders, "docs/as").map((f) => [f.path, f.context]),
		).toEqual([
			["/", true],
			["/docs/", true],
			["/docs/assets/", false],
		]);
		expect(
			filterPickerFolders(folders, "ASSETS")
				.filter((f) => !f.context)
				.map((f) => f.path),
		).toEqual(["/assets/", "/docs/assets/"]);
		expect(filterPickerFolders(folders, "root")[0]?.path).toBe("/");
		expect(filterPickerFolders(folders, "nothing-here")).toEqual([]);
		expect(filterPickerFolders(folders, "   ")).toHaveLength(folders.length);
	});
});

describe("how a row names its type", () => {
	test.each([
		["excalidraw", "drawings"],
		["markdown", "Markdown files"],
		["csv", "CSV files"],
		["generic", "files"],
	] as const)("%s reads as %s", (fileType, noun) => {
		expect(fileTypeNoun(fileType)).toBe(noun);
	});
});
