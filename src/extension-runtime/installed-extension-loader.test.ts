import { describe, expect, test, vi } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	loadInstalledExtensionsFromLix,
	reconcileInstalledExtensionCandidates,
} from "./installed-extension-loader";
import { parseExtensionManifest } from "./extension-manifest";
import { Puzzle } from "lucide-react";
import type { ExtensionDefinition } from "./types";

const textEncoder = new TextEncoder();

async function writeInstalledExtensionFile(
	lix: Awaited<ReturnType<typeof openLix>>,
	path: string,
	data: string,
): Promise<void> {
	await lix.execute(
		"INSERT INTO lix_file (path, data) VALUES (?, ?) \
		 ON CONFLICT (path) DO UPDATE SET data = excluded.data",
		[
			`/.lix/app_data/atelier/extensions/table-viewer/${path}`,
			textEncoder.encode(data),
		],
	);
}

describe("parseManifest", () => {
	test("normalizes file extension handlers from extension manifests", () => {
		const manifest = parseExtensionManifest(
			"/.lix/app_data/atelier/extensions/table-viewer/manifest.json",
			JSON.stringify({
				apiVersion: 1,
				id: "table-viewer",
				name: "Table Viewer",
				entry: "./index.js",
				fileExtensions: [" .CSV ", ".TSV"],
			}),
		);

		expect(manifest.fileExtensions).toEqual(["csv", "tsv"]);
	});

	test("rejects missing versions, coerced values, and unknown fields", () => {
		const path = "/.lix/app_data/atelier/extensions/example/manifest.json";
		expect(() =>
			parseExtensionManifest(
				path,
				JSON.stringify({ id: "example", name: "Example", entry: "index.js" }),
			),
		).toThrow("apiVersion 1");
		expect(() =>
			parseExtensionManifest(
				path,
				JSON.stringify({
					apiVersion: 1,
					id: { invalid: true },
					name: "Example",
					entry: "index.js",
				}),
			),
		).toThrow('field "id" must be a non-empty string');
		expect(() =>
			parseExtensionManifest(
				path,
				JSON.stringify({
					apiVersion: 1,
					id: "example",
					name: "Example",
					entry: "index.js",
					icon: "puzzle",
				}),
			),
		).toThrow("unknown fields: icon");
	});

	test("loads installed extensions from the extension storage root", async () => {
		const lix = await openLix();
		try {
			await writeInstalledExtensionFile(
				lix,
				"manifest.json",
				JSON.stringify({
					apiVersion: 1,
					id: "table-viewer",
					name: "Table Viewer",
					entry: "./index.js",
					fileExtensions: ["csv"],
				}),
			);
			await writeInstalledExtensionFile(
				lix,
				"index.js",
				"export default { mount({ element }) { element.textContent = 'table'; } }",
			);

			const mount = vi.fn();
			const importModule = vi.fn(async () => ({ mount }));
			const candidates = await loadInstalledExtensionsFromLix(lix, {
				importModule,
			});
			const tableViewer = candidates[0]?.definition;

			expect(tableViewer).toMatchObject({
				kind: "table-viewer",
				label: "Table Viewer",
				description: "Workspace extension: Table Viewer",
				fileExtensions: ["csv"],
			});
			expect(tableViewer?.mount).toEqual(expect.any(Function));
			expect(importModule).toHaveBeenCalledWith(
				"export default { mount({ element }) { element.textContent = 'table'; } }",
				"/.lix/app_data/atelier/extensions/table-viewer/index.js",
			);
		} finally {
			await lix.close();
		}
	});
});

describe("reconcileInstalledExtensionCandidates", () => {
	const definition: ExtensionDefinition = {
		kind: "example",
		label: "Example",
		description: "Example",
		icon: Puzzle,
		mount: () => {},
	};
	const manifestPath =
		"/.lix/app_data/atelier/extensions/example/manifest.json";

	test("keeps the last-known-good definition when a reload fails", () => {
		const previous = new Map([[manifestPath, definition]]);
		const next = reconcileInstalledExtensionCandidates(previous, [
			{ manifestPath, error: new SyntaxError("Unexpected token") },
		]);
		expect(next.get(manifestPath)).toBe(definition);
	});

	test("removes definitions whose manifests were deleted", () => {
		const previous = new Map([[manifestPath, definition]]);
		const next = reconcileInstalledExtensionCandidates(previous, []);
		expect(next.size).toBe(0);
	});
});
