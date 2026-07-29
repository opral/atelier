import type { Lix } from "@lix-js/sdk";

const seedTextModules = import.meta.glob(
	["./seed/**/*", "!./seed/**/assets/**/*"],
	{
		eager: true,
		import: "default",
		query: "?raw",
	},
) as Record<string, string>;

const seedAssetUrls = import.meta.glob("./seed/**/assets/**/*", {
	eager: true,
	import: "default",
	query: "?inline",
}) as Record<string, string>;

export async function seedWorkspace(lix: Lix): Promise<void> {
	const textFiles = Object.entries(seedTextModules).map(
		([modulePath, contents]) => ({
			path: modulePath.slice("./seed".length),
			data: new TextEncoder().encode(embedSeedAssets(modulePath, contents)),
		}),
	);
	const assetFiles = Object.entries(seedAssetUrls).map(
		([modulePath, dataUrl]) => ({
			path: modulePath.slice("./seed".length),
			data: decodeSeedAssetDataUrl(dataUrl),
		}),
	);
	const files = [...textFiles, ...assetFiles].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
	const seedProbe = files[0];
	if (seedProbe) {
		const existing = await lix.execute(
			"SELECT id FROM lix_file WHERE path = $1 LIMIT 1",
			[seedProbe.path],
		);
		if (existing.rows.length > 0) return;
	}

	await seedDirectories(
		lix,
		files.map((file) => file.path),
	);

	for (const file of files) {
		await lix.execute("INSERT INTO lix_file (path, data) VALUES ($1, $2)", [
			file.path,
			file.data,
		]);
	}
}

export function decodeSeedAssetDataUrl(dataUrl: string): Uint8Array {
	const separatorIndex = dataUrl.indexOf(",");
	if (!dataUrl.startsWith("data:") || separatorIndex < 0) {
		throw new Error("Seed asset must be an inline data URL.");
	}
	const metadata = dataUrl.slice(5, separatorIndex);
	const payload = dataUrl.slice(separatorIndex + 1);
	if (metadata.split(";").includes("base64")) {
		const binary = atob(payload);
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	}
	return new TextEncoder().encode(decodeURIComponent(payload));
}

export function embedSeedAssets(modulePath: string, contents: string): string {
	if (!modulePath.toLowerCase().endsWith(".md")) return contents;

	const markdownWorkspacePath = modulePath.slice("./seed/".length);
	const markdownDirectory = markdownWorkspacePath
		.split("/")
		.slice(0, -1)
		.join("/");
	let markdown = contents;
	for (const [assetModulePath, dataUrl] of Object.entries(seedAssetUrls)) {
		const assetWorkspacePath = assetModulePath.slice("./seed/".length);
		const relativeAssetPath =
			markdownDirectory &&
			assetWorkspacePath.startsWith(`${markdownDirectory}/`)
				? assetWorkspacePath.slice(markdownDirectory.length + 1)
				: assetWorkspacePath;
		// PDFs and videos must remain workspace-relative so the Markdown asset
		// loader can resolve their bytes from the workspace (validated preview
		// path for PDFs, blob playback + Open file for videos).
		if (/\.(pdf|mp4|mov|webm)$/i.test(assetWorkspacePath)) continue;
		markdown = markdown.replaceAll(`](${relativeAssetPath}`, `](${dataUrl}`);
	}
	return markdown;
}

async function seedDirectories(lix: Lix, filePaths: string[]): Promise<void> {
	const directories = new Set<string>();
	for (const filePath of filePaths) {
		const segments = filePath.split("/").filter(Boolean);
		for (let index = 1; index < segments.length; index += 1) {
			directories.add(`/${segments.slice(0, index).join("/")}`);
		}
	}

	for (const directory of [...directories].sort()) {
		await lix.execute(
			"INSERT INTO lix_directory (path) VALUES ($1) ON CONFLICT(path) DO NOTHING",
			[directory],
		);
	}
}
