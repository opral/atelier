import csvPluginUrl from "../../vendor/lix/packages/lix/tests/fixtures/plugin-api/v2/plugin_csv.lixplugin?url";
import markdownPluginUrl from "../../vendor/lix/packages/lix/tests/fixtures/plugin-api/v2/plugin_markdown.lixplugin?url";

const PLUGIN_URLS = {
	plugin_markdown: markdownPluginUrl,
	plugin_csv: csvPluginUrl,
} as const;

/**
 * Fetches a plugin archive for the preview to install at
 * `/.lix/plugins/<key>.lixplugin`. The SDK no longer bundles plugins (Lix
 * 9005df301), so the preview serves the vendored Lix's frozen plugin API v2
 * archives as static assets.
 */
export async function lixPluginArchive(
	key: keyof typeof PLUGIN_URLS,
): Promise<Uint8Array> {
	const response = await fetch(PLUGIN_URLS[key]);
	if (!response.ok)
		throw new Error(`Could not load the ${key} archive: ${response.status}`);
	return new Uint8Array(await response.arrayBuffer());
}
