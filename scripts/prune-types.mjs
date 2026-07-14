import { access, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

const typesDirectory = path.resolve("dist/types");
const publicDeclarationEntries = [
	"index.d.ts",
	"atelier-instance.d.ts",
	"create-atelier.d.ts",
	"extension-api.d.ts",
	"state-adapters.d.ts",
	"dev-tools/developer-tools-menu.d.ts",
	"dev-tools/simulate-agent-workflow.d.ts",
	"shell/agent-turn-review-range.d.ts",
	"shell/ui-state.d.ts",
];

const publicDeclarations = new Set();
for (const declaration of publicDeclarationEntries) {
	await collectDeclarationDependencies(declaration);
}

await pruneDirectory(typesDirectory);

async function collectDeclarationDependencies(relativePath) {
	if (publicDeclarations.has(relativePath)) return;
	publicDeclarations.add(relativePath);

	const declarationPath = path.join(typesDirectory, relativePath);
	const source = await readFile(declarationPath, "utf8");
	for (const specifier of findDeclarationImports(source)) {
		if (!specifier.startsWith(".")) continue;
		const dependency = await resolveDeclarationImport(
			path.dirname(declarationPath),
			specifier,
		);
		if (dependency) await collectDeclarationDependencies(dependency);
	}
}

function findDeclarationImports(source) {
	const specifiers = new Set();
	const patterns = [
		/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g,
		/\b(?:import|export)\s+(?:type\s+)?(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/g,
		/<reference\s+path=["']([^"']+)["']/g,
	];
	for (const pattern of patterns) {
		for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
	}
	return specifiers;
}

async function resolveDeclarationImport(fromDirectory, specifier) {
	const resolved = path.resolve(fromDirectory, specifier);
	const candidates = specifier.endsWith(".js")
		? [resolved.replace(/\.js$/, ".d.ts")]
		: [`${resolved}.d.ts`, path.join(resolved, "index.d.ts")];

	for (const candidate of candidates) {
		if (!candidate.startsWith(`${typesDirectory}${path.sep}`)) continue;
		try {
			await access(candidate);
			return path
				.relative(typesDirectory, candidate)
				.split(path.sep)
				.join(path.posix.sep);
		} catch {
			// Try the next declaration-module resolution candidate.
		}
	}
	return undefined;
}

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
