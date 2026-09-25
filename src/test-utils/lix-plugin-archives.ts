import { readFile } from "node:fs/promises";
import path from "node:path";

export type LixPluginArchive = {
	readonly key: string;
	readonly fileName: string;
	readonly archiveBytes: Uint8Array;
};

/**
 * The Markdown and CSV plugin archives tests install at
 * `/.lix/plugins/<key>.lixplugin`. The SDK no longer bundles plugins (Lix
 * 9005df301); these are the frozen plugin API v2 archives the vendored Lix
 * tests its own SDK against.
 */
export async function lixPluginArchives(): Promise<LixPluginArchive[]> {
	return await Promise.all(
		(["plugin_markdown", "plugin_csv"] as const).map(async (key) => ({
			key,
			fileName: `${key}.lixplugin`,
			archiveBytes: new Uint8Array(
				await readFile(
					path.resolve(
						import.meta.dirname,
						`../../vendor/lix/packages/lix/tests/fixtures/plugin-api/v2/${key}.lixplugin`,
					),
				),
			),
		})),
	);
}
