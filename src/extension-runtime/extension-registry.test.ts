import { describe, expect, test } from "vitest";
import { Puzzle } from "lucide-react";
import {
	findFileHandlerExtension,
	isMarkdownFilePath,
	normalizeFileExtensions,
} from "./file-handlers";
import type { ExtensionDefinition } from "./types";
import { buildExtensionRegistry } from "./extension-registry";
import { ATELIER_BUILTIN_EXTENSION_IDS } from "../extension-api";
import { BUILTIN_EXTENSION_DEFINITIONS } from "./builtin-extension-registry";

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
		const filesOverride = {
			...baseExtension,
			kind: ATELIER_BUILTIN_EXTENSION_IDS.files,
			label: "Host Files",
		};

		const registry = buildExtensionRegistry([filesOverride], []);

		expect(registry.extensionMap.get(ATELIER_BUILTIN_EXTENSION_IDS.files)).toBe(
			filesOverride,
		);
		expect(
			registry.visibleExtensions.find(
				(extension) => extension.kind === ATELIER_BUILTIN_EXTENSION_IDS.files,
			),
		).toBe(filesOverride);
	});

	test("exports every bundled extension id for host overrides", () => {
		expect(new Set(Object.values(ATELIER_BUILTIN_EXTENSION_IDS))).toEqual(
			new Set(
				BUILTIN_EXTENSION_DEFINITIONS.map((definition) => definition.kind),
			),
		);
	});

	test("does not let workspace-installed extensions replace built-ins", () => {
		const installedFiles = {
			...baseExtension,
			kind: ATELIER_BUILTIN_EXTENSION_IDS.files,
			label: "Workspace Files",
		};

		const registry = buildExtensionRegistry([], [installedFiles]);

		expect(
			registry.extensionMap.get(ATELIER_BUILTIN_EXTENSION_IDS.files),
		).not.toBe(installedFiles);
	});
});
