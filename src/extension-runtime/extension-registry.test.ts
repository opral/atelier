import { describe, expect, test } from "vitest";
import { Puzzle } from "lucide-react";
import {
	findFileHandlerExtension,
	isMarkdownFilePath,
	normalizeFileExtensions,
} from "./file-handlers";
import type { ExtensionDefinition } from "./types";
import { buildExtensionRegistry } from "./extension-registry";

const baseExtension = {
	label: "Extension",
	description: "Extension",
	icon: Puzzle,
	mount: () => {},
} satisfies Omit<ExtensionDefinition, "kind">;

describe("findFileHandlerExtension", () => {
	test("returns the first extension that declares the file extension", () => {
		const markdown = {
			...baseExtension,
			kind: "markdown",
			fileExtensions: ["md", "markdown"],
		};
		const csv = {
			...baseExtension,
			kind: "csv",
			fileExtensions: ["csv"],
		};

		expect(findFileHandlerExtension([markdown, csv], "/data.CSV")).toBe(csv);
	});

	test("normalizes extension declarations before matching", () => {
		const csv = {
			...baseExtension,
			kind: "csv",
			fileExtensions: [" .CSV "],
		};

		expect(findFileHandlerExtension([csv], "/data.csv")).toBe(csv);
		expect(normalizeFileExtensions([" .CSV ", ".tsv", " "])).toEqual([
			"csv",
			"tsv",
		]);
	});

	test("returns undefined when no extension handles the extension", () => {
		const markdown = {
			...baseExtension,
			kind: "markdown",
			fileExtensions: ["md"],
		};

		expect(findFileHandlerExtension([markdown], "/data.txt")).toBeUndefined();
	});

	test("detects markdown extensions from literal path text", () => {
		expect(isMarkdownFilePath("/docs/readme.MD")).toBe(true);
		expect(isMarkdownFilePath("/docs/%6d.md")).toBe(true);
		expect(isMarkdownFilePath("/docs/readme.md%20")).toBe(false);
	});
});

describe("buildExtensionRegistry", () => {
	test("lets a host registration replace a built-in with the same id", () => {
		const historyOverride = {
			...baseExtension,
			kind: "atelier_history",
			label: "Host History",
		};

		const registry = buildExtensionRegistry([historyOverride], []);

		expect(registry.extensionMap.get("atelier_history")).toBe(historyOverride);
		expect(
			registry.visibleExtensions.find(
				(extension) => extension.kind === "atelier_history",
			),
		).toBe(historyOverride);
	});

	test("keeps explicit built-in remaps ahead of exact-id host overrides", () => {
		const exactFilesOverride = {
			...baseExtension,
			kind: "atelier_files",
			label: "Exact Files",
		};
		const remappedFilesOverride = {
			...baseExtension,
			kind: "atelier_files",
			label: "Remapped Files",
		};

		const registry = buildExtensionRegistry(
			[exactFilesOverride],
			[],
			[remappedFilesOverride],
		);

		expect(registry.extensionMap.get("atelier_files")).toBe(
			remappedFilesOverride,
		);
	});

	test("does not let workspace-installed extensions replace built-ins", () => {
		const installedHistory = {
			...baseExtension,
			kind: "atelier_history",
			label: "Workspace History",
		};

		const registry = buildExtensionRegistry([], [installedHistory]);

		expect(registry.extensionMap.get("atelier_history")).not.toBe(
			installedHistory,
		);
	});
});
