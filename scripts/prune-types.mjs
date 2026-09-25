import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".");
const typesDirectory = path.join(root, "dist/types");
const packageJson = JSON.parse(
	await readFile(path.join(root, "package.json"), "utf8"),
);
const files = new Map();

async function collect(directory = typesDirectory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) await collect(absolute);
		else if (entry.name.endsWith(".d.ts")) {
			files.set(
				path.relative(typesDirectory, absolute).split(path.sep).join("/"),
				absolute,
			);
		}
	}
}

await collect();

// TypeScript preserves tsconfig paths in emitted declarations. Consumers do
// not have our private @/ alias, so make every emitted reference relative.
for (const [relative, absolute] of files) {
	const source = await readFile(absolute, "utf8");
	const portable = source.replace(
		/(["'])@\/([^"']+)\1/g,
		(_, quote, target) => {
			let specifier = path.posix.relative(path.posix.dirname(relative), target);
			if (!specifier.startsWith(".")) specifier = `./${specifier}`;
			return `${quote}${specifier}${quote}`;
		},
	);
	if (portable !== source) await writeFile(absolute, portable);
}

const entries = Object.values(packageJson.exports)
	.map((target) => (typeof target === "object" ? target.types : undefined))
	.filter(
		(value) => typeof value === "string" && value.startsWith("./dist/types/"),
	)
	.map((value) => value.slice("./dist/types/".length));
const reachable = new Set();
const queue = [...entries];

while (queue.length > 0) {
	const relative = queue.pop();
	if (reachable.has(relative)) continue;
	const absolute = files.get(relative);
	if (!absolute) throw new Error(`Missing public declaration: ${relative}`);
	reachable.add(relative);
	const source = await readFile(absolute, "utf8");
	for (const [, specifier] of source.matchAll(
		/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g,
	)) {
		if (specifier.endsWith(".css")) continue;
		const base = path.posix
			.normalize(path.posix.join(path.posix.dirname(relative), specifier))
			.replace(/\.js$/, "");
		const dependency = [`${base}.d.ts`, `${base}/index.d.ts`].find(
			(candidate) => files.has(candidate),
		);
		if (!dependency)
			throw new Error(
				`Unresolved declaration import: ${relative} -> ${specifier}`,
			);
		queue.push(dependency);
	}
}

for (const [relative, absolute] of files) {
	if (!reachable.has(relative)) await rm(absolute);
}

async function removeEmptyDirectories(directory = typesDirectory) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const absolute = path.join(directory, entry.name);
		await removeEmptyDirectories(absolute);
		if ((await readdir(absolute)).length === 0)
			await rm(absolute, { recursive: true });
	}
}
await removeEmptyDirectories();
