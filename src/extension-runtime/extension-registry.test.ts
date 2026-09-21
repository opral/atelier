import { describe, expect, test } from "vitest";
import { Puzzle } from "lucide-react";
import {
	fileViewExtension,
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

	test("offers checkpoint history as a visible side-panel extension", () => {
		const history = BUILTIN_EXTENSION_DEFINITIONS.find(
			(definition) => definition.kind === ATELIER_BUILTIN_EXTENSION_IDS.history,
		);

		expect(history).toEqual(
			expect.objectContaining({
				label: "History",
				placement: ["left", "right", "main"],
			}),
		);
		expect(history?.hidden).not.toBe(true);
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

test("ordinary CSV files resolve to exactly one built-in CSV handler", () => {
	const { extensionMap } = buildExtensionRegistry([], []);
	const definitions = [...extensionMap.values()];
	const csv = extensionMap.get(ATELIER_BUILTIN_EXTENSION_IDS.csv);
	expect(csv).toBeDefined();
	expect(findFileHandlerExtension(definitions, "/data.csv")).toBe(csv);
	expect(findFileHandlerExtension(definitions, "/data.CSV")).toBe(csv);
	expect(
		definitions.filter((definition) =>
			definition.fileExtensions?.includes("csv"),
		),
	).toEqual([csv]);
});

describe("fileViewExtension", () => {
	test("a path no extension claims opens in the text view", () => {
		const { extensionMap } = buildExtensionRegistry([], []);
		const definitions = [...extensionMap.values()];
		const text = extensionMap.get(ATELIER_BUILTIN_EXTENSION_IDS.text);
		expect(text).toBeDefined();
		// The files a repository is full of and no manifest names: they are
		// files to type into, not file types to apologise for.
		for (const path of [
			"/Dockerfile",
			"/LICENSE",
			"/Makefile",
			"/.gitignore",
			"/.env",
			"/notes.unknown",
		]) {
			expect(fileViewExtension(definitions, path)).toBe(text);
		}
	});

	test("a declared handler still wins over the text view", () => {
		const { extensionMap } = buildExtensionRegistry([], []);
		const definitions = [...extensionMap.values()];
		expect(fileViewExtension(definitions, "/data.csv")).toBe(
			extensionMap.get(ATELIER_BUILTIN_EXTENSION_IDS.csv),
		);
		expect(fileViewExtension(definitions, "/readme.md")).toBe(
			extensionMap.get(ATELIER_BUILTIN_EXTENSION_IDS.markdown),
		);
	});

	test("without a text view the caller's own fallback stands", () => {
		const markdown = {
			...baseExtension,
			kind: "markdown",
			fileExtensions: ["md"],
		};
		expect(fileViewExtension([markdown], "/Dockerfile")).toBeUndefined();
	});
});
