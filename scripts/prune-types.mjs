import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const typesDirectory = path.resolve("dist/types");
const publicDeclarations = new Set([
	"index.d.ts",
	"atelier-instance.d.ts",
	"atelier-error-boundary.d.ts",
	"create-atelier.d.ts",
	"extension-api.d.ts",
	"components/diff-glyph.d.ts",
	"components/diff-glyph-geometry.d.ts",
	"file-icons.d.ts",
	"atelier.d.ts",
	"atelier-file.d.ts",
	"history.d.ts",
	"load-atelier.d.ts",
	"atelier-state.d.ts",
	"atelier-render-context.d.ts",
	"extensions/markdown/markdown-content.d.ts",
	"lib/workspace-file-ops.d.ts",
	"state-adapters.d.ts",
	"dev-tools/developer-tools-menu.d.ts",
	"dev-tools/simulate-agent-workflow.d.ts",
	"extension-runtime/external-write-review.d.ts",
	"extension-runtime/types.d.ts",
	"extension-runtime/use-debounced-payload-persistence.d.ts",
	"shell/agent-turn-review-range.d.ts",
	"shell/ui-state.d.ts",
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
