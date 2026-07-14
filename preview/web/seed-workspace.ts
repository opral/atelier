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
			id: `preview-seed:${modulePath.slice("./seed".length)}`,
			path: modulePath.slice("./seed".length),
			data: new TextEncoder().encode(embedSeedAssets(modulePath, contents)),
		}),
	);
	const assetFiles = Object.entries(seedAssetUrls).map(
		([modulePath, dataUrl]) => ({
			id: `preview-seed:${modulePath.slice("./seed".length)}`,
			path: modulePath.slice("./seed".length),
			data: decodeSeedAssetDataUrl(dataUrl),
		}),
	);
	const files = [...textFiles, ...assetFiles].sort((left, right) =>
		left.path.localeCompare(right.path),
	);

	await seedDirectories(
		lix,
		files.map((file) => file.path),
	);

	for (const file of files) {
		await lix.execute(
			"INSERT INTO lix_file (id, path, data) VALUES ($1, $2, $3)",
			[file.id, file.path, file.data],
		);
	}

	if (files.length > 0) {
		await lix.createBranch({ name: "Seed workspace" });
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
		// PDFs must remain workspace-relative so the Markdown asset loader can
		// validate their bytes and render them through the consent-aware path.
		if (assetWorkspacePath.toLowerCase().endsWith(".pdf")) continue;
		markdown = markdown.replaceAll(`](${relativeAssetPath}`, `](${dataUrl}`);
	}
	return markdown;
}

async function seedDirectories(lix: Lix, filePaths: string[]): Promise<void> {
	const directories = new Set<string>();
	for (const filePath of filePaths) {
		const segments = filePath.split("/").filter(Boolean);
		for (let index = 1; index < segments.length; index += 1) {
			directories.add(`/${segments.slice(0, index).join("/")}/`);
		}
	}

	for (const directory of [...directories].sort()) {
		await lix.execute("INSERT INTO lix_directory (path) VALUES ($1)", [
			directory,
		]);
	}
}
