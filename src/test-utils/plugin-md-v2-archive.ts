/**
 * The current Lix checkout stores the Markdown plugin as source plus schema
 * JSON, not as a prebuilt `.lixplugin` archive. Test SDK compatibility handles
 * `installPlugin()` by registering those schemas directly, so the archive bytes
 * are intentionally empty.
 */
export const markdownPluginV2ArchiveBytes = new Uint8Array();
