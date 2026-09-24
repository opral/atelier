import { bundledPluginArchives, type Lix } from "@lix-js/sdk";

const MARKDOWN_PLUGIN_KEY = "plugin_markdown";
const MARKDOWN_PLUGIN_PATH = `/.lix/plugins/${MARKDOWN_PLUGIN_KEY}.lixplugin`;

/**
 * Installs the SDK's bundled Markdown plugin, the way a host does: its
 * archive written to `/.lix/plugins/<key>.lixplugin` (vendor/lix
 * docs/plugins.md). The plugin projects each Markdown file into
 * `markdown_node` rows, which block conversations attach to and History
 * diffs by row.
 *
 * It runs before seeding, so a new workspace's files are projected as they
 * are written. Lix does not backfill files that were already there, so a
 * workspace opened before the plugin existed has its Markdown files written
 * once more (same bytes) to project them.
 */
export async function installMarkdownPlugin(lix: Lix): Promise<void> {
	const installed = await lix.execute(
		"SELECT id FROM lix_file WHERE path = $1 LIMIT 1",
		[MARKDOWN_PLUGIN_PATH],
	);
	if (installed.rows.length > 0) return;
	const archive = (await bundledPluginArchives()).find(
		(plugin) => plugin.key === MARKDOWN_PLUGIN_KEY,
	);
	if (!archive) throw new Error("The SDK bundles no Markdown plugin.");
	await lix.execute(
		"INSERT INTO lix_file (path, content) VALUES ($1, $2) ON CONFLICT (path) DO UPDATE SET content = excluded.content",
		[MARKDOWN_PLUGIN_PATH, archive.archiveBytes],
	);
	const markdownFiles = await lix.execute<{ id: string; content: Uint8Array }>(
		"SELECT id, content FROM lix_file WHERE path LIKE '%.md'",
	);
	for (const file of markdownFiles.rows) {
		await lix.execute("UPDATE lix_file SET content = $2 WHERE id = $1", [
			file.id,
			file.content,
		]);
	}
}
