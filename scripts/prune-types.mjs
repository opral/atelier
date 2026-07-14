import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const typesDirectory = path.resolve("dist/types");
const publicDeclarations = new Set([
	"index.d.ts",
	"atelier-instance.d.ts",
	"create-atelier.d.ts",
	"extension-api.d.ts",
	"dev-tools/developer-tools-menu.d.ts",
	"dev-tools/simulate-agent-workflow.d.ts",
	"shell/agent-turn-review-range.d.ts",
]);

await pruneDirectory(typesDirectory);

async function pruneDirectory(directory, relativeDirectory = "") {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const relativePath = path.posix.join(relativeDirectory, entry.name);
		const absolutePath = path.join(directory, entry.name);

		if (entry.isFile() && publicDeclarations.has(relativePath)) continue;
		if (
			entry.isDirectory() &&
			[...publicDeclarations].some((declaration) =>
				declaration.startsWith(`${relativePath}/`),
			)
		) {
			await pruneDirectory(absolutePath, relativePath);
			continue;
		}

		await rm(absolutePath, { recursive: true, force: true });
	}
}
