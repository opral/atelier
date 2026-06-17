import { describe, expect, test, vi } from "vitest";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	loadInstalledExtensionsFromLix,
	parseManifest,
} from "./installed-extension-loader";

const textEncoder = new TextEncoder();

async function writeInstalledExtensionFile(
	lix: Awaited<ReturnType<typeof openLix>>,
	path: string,
	data: string,
): Promise<void> {
	await lix.execute(
		"INSERT INTO lix_file_by_branch (path, data, lixcol_branch_id, lixcol_global) VALUES (?, ?, ?, ?)",
		[
			`/.lix_system/app_data/flashtype/extensions/table-viewer/${path}`,
			textEncoder.encode(data),
			"global",
			true,
		],
	);
}

describe("parseManifest", () => {
	test("normalizes file extension handlers from extension manifests", () => {
		const manifest = parseManifest(
			"/.lix_system/app_data/flashtype/extensions/table-viewer/manifest.json",
			JSON.stringify({
				id: "table-viewer",
				name: "Table Viewer",
				entry: "./index.js",
				fileExtensions: [" .CSV ", ".TSV", ""],
			}),
		);

		expect(manifest.fileExtensions).toEqual(["csv", "tsv"]);
	});

	test("loads installed extensions from the extension storage root", async () => {
		const lix = await openLix();
		try {
			await writeInstalledExtensionFile(
				lix,
				"manifest.json",
				JSON.stringify({
					id: "table-viewer",
					name: "Table Viewer",
					description: "Shows tables",
					entry: "./index.js",
					fileExtensions: ["csv"],
				}),
			);
			await writeInstalledExtensionFile(
				lix,
				"index.js",
				"export function render({ target }) { target.textContent = 'table'; }",
			);

			const render = vi.fn();
			const importModule = vi.fn(async () => ({ render }));
			const definitions = await loadInstalledExtensionsFromLix(lix, {
				importModule,
			});
			const tableViewer = definitions.find(
				(definition) => definition.kind === "table-viewer",
			);

			expect(tableViewer).toMatchObject({
				kind: "table-viewer",
				label: "Table Viewer",
				description: "Shows tables",
				fileExtensions: ["csv"],
			});
			expect(tableViewer?.render).toEqual(expect.any(Function));
			expect(importModule).toHaveBeenCalledWith(
				"export function render({ target }) { target.textContent = 'table'; }",
				"/.lix_system/app_data/flashtype/extensions/table-viewer/index.js",
			);
		} finally {
			await lix.close();
		}
	});
});
