import { describe, expect, test } from "vitest";

import {
	buildFilesystemTree,
	isWatchedEntryId,
	watchedEntryRows,
	type FilesystemTreeNode,
} from "./build-filesystem-tree.js";
import type { FilesystemEntryRow } from "@/queries";

const baseEntries: FilesystemEntryRow[] = [
	{
		id: "dir_docs",
		parent_id: null,
		path: "/docs/",
		display_name: "docs",
		kind: "directory",
	},
	{
		id: "dir_guides",
		parent_id: "dir_docs",
		path: "/docs/guides/",
		display_name: "guides",
		kind: "directory",
	},
	{
		id: "file_root",
		parent_id: null,
		path: "/README.md",
		display_name: "README.md",
		kind: "file",
	},
	{
		id: "file_nested",
		parent_id: "dir_guides",
		path: "/docs/guides/intro.md",
		display_name: "intro.md",
		kind: "file",
	},
];

describe("buildFilesystemTree", () => {
	test("nests directories and files with stable ordering", () => {
		const tree = buildFilesystemTree(baseEntries);
		expect(tree).toHaveLength(2);

		const [docs, rootFile] = tree;
		expect(docs.type).toBe("directory");
		if (docs.type === "directory") {
			expect(docs.path).toBe("/docs/");
			expect(docs).not.toHaveProperty("hidden");
			expect(docs.children).toHaveLength(1);
			const [guides] = docs.children;
			expect(guides.type).toBe("directory");
			if (guides.type === "directory") {
				expect(guides.children).toHaveLength(1);
				const [nestedFile] = guides.children;
				expect(nestedFile.type).toBe("file");
				expect(nestedFile.path).toBe("/docs/guides/intro.md");
				expect(nestedFile).not.toHaveProperty("hidden");
			}
		}

		expect(rootFile.type).toBe("file");
		if (rootFile.type === "file") {
			expect(rootFile.path).toBe("/README.md");
			expect(rootFile).not.toHaveProperty("hidden");
		}
	});

	test("omits paths with dot-prefixed segments", () => {
		const tree = buildFilesystemTree([
			{
				id: "file_visible",
				parent_id: null,
				path: "/visible.md",
				display_name: "visible.md",
				kind: "file",
			},
			{
				id: "dir_docs",
				parent_id: null,
				path: "/docs/",
				display_name: "docs",
				kind: "directory",
			},
			{
				id: "file_nested_visible",
				parent_id: "dir_docs",
				path: "/docs/visible.md",
				display_name: "visible.md",
				kind: "file",
			},
			{
				id: "file_dot",
				parent_id: null,
				path: "/.hidden.md",
				display_name: ".hidden.md",
				kind: "file",
			},
			{
				id: "dir_dot",
				parent_id: null,
				path: "/.lix/",
				display_name: ".lix",
				kind: "directory",
			},
			{
				id: "file_dot_child",
				parent_id: "dir_dot",
				path: "/.lix/config.json",
				display_name: "config.json",
				kind: "file",
			},
			{
				id: "dir_nested_dot",
				parent_id: "dir_docs",
				path: "/docs/.drafts/",
				display_name: ".drafts",
				kind: "directory",
			},
			{
				id: "file_nested_dot_child",
				parent_id: "dir_nested_dot",
				path: "/docs/.drafts/outline.md",
				display_name: "outline.md",
				kind: "file",
			},
		]);

		expect(collectPaths(tree)).toEqual([
			"/docs/",
			"/docs/visible.md",
			"/visible.md",
		]);
	});

	test("parents watched rows by path when parent ids do not match Lix ids", () => {
		const tree = buildFilesystemTree([
			{
				id: "dir_docs",
				parent_id: null,
				path: "/docs/",
				display_name: "docs",
				kind: "directory",
				source: "lix",
			},
			{
				id: "watched:/docs/notes.txt",
				parent_id: "watched:/docs/",
				path: "/docs/notes.txt",
				display_name: "notes.txt",
				kind: "file",
				source: "watched",
			},
		]);

		expect(collectPaths(tree)).toEqual(["/docs/", "/docs/notes.txt"]);
	});

	test("dedupes by normalized path with Lix rows winning", () => {
		const tree = buildFilesystemTree([
			{
				id: "watched:/docs/",
				parent_id: null,
				path: "/docs/",
				display_name: "docs",
				kind: "directory",
				source: "watched",
			},
			{
				id: "watched:/docs/notes.txt",
				parent_id: "watched:/docs/",
				path: "/docs/notes.txt",
				display_name: "notes.txt",
				kind: "file",
				source: "watched",
			},
			{
				id: "dir_docs",
				parent_id: null,
				path: "/docs",
				display_name: "docs",
				kind: "directory",
				source: "lix",
			},
			{
				id: "file_notes",
				parent_id: "dir_docs",
				path: "/docs/notes.txt",
				display_name: "notes.txt",
				kind: "file",
				source: "lix",
			},
		]);

		const [docs] = tree;
		expect(docs).toMatchObject({
			type: "directory",
			id: "dir_docs",
			path: "/docs/",
			source: "lix",
		});
		if (docs?.type !== "directory") throw new Error("expected docs directory");
		expect(docs.children).toHaveLength(1);
		expect(docs.children[0]).toMatchObject({
			type: "file",
			id: "file_notes",
			path: "/docs/notes.txt",
			source: "lix",
		});
	});
});

describe("watchedEntryRows", () => {
	test("builds watched rows with synthetic ids and synthesized ancestors", () => {
		const rows = watchedEntryRows([
			{ path: "/notes/daily/todo.md", kind: "file" },
			{ path: "/assets", kind: "directory" },
		]);

		expect(rows).toEqual([
			expect.objectContaining({
				id: "watched:/notes/",
				path: "/notes/",
				display_name: "notes",
				kind: "directory",
				source: "watched",
			}),
			expect.objectContaining({
				id: "watched:/notes/daily/",
				path: "/notes/daily/",
				display_name: "daily",
				kind: "directory",
				source: "watched",
			}),
			expect.objectContaining({
				id: "watched:/notes/daily/todo.md",
				path: "/notes/daily/todo.md",
				display_name: "todo.md",
				kind: "file",
				source: "watched",
			}),
			expect.objectContaining({
				id: "watched:/assets/",
				path: "/assets/",
				display_name: "assets",
				kind: "directory",
				source: "watched",
			}),
		]);
		expect(rows.every((row) => isWatchedEntryId(row.id))).toBe(true);
	});

	test("merges into the tree with lix entries winning on path collisions", () => {
		const tree = buildFilesystemTree([
			...baseEntries,
			...watchedEntryRows([
				{ path: "/README.md", kind: "file" },
				{ path: "/docs/guides/draft.md", kind: "file" },
			]),
		]);

		expect(collectPaths(tree)).toEqual([
			"/docs/",
			"/docs/guides/",
			"/docs/guides/draft.md",
			"/docs/guides/intro.md",
			"/README.md",
		]);
		const readme = tree.find((node) => node.path === "/README.md");
		expect(readme).toMatchObject({ id: "file_root", source: "lix" });
		const docs = tree[0];
		if (docs?.type !== "directory") throw new Error("expected docs directory");
		expect(docs.id).toBe("dir_docs");
		const guides = docs.children[0];
		if (guides?.type !== "directory") {
			throw new Error("expected guides directory");
		}
		expect(guides.id).toBe("dir_guides");
		expect(guides.children[0]).toMatchObject({
			id: "watched:/docs/guides/draft.md",
			source: "watched",
		});
	});
});

function collectPaths(nodes: readonly FilesystemTreeNode[]): string[] {
	const paths: string[] = [];
	for (const node of nodes) {
		paths.push(node.path);
		if (node.type === "directory") {
			paths.push(...collectPaths(node.children));
		}
	}
	return paths;
}
