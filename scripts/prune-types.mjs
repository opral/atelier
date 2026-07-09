import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const typesDirectory = path.resolve("dist/types");
const publicDeclarations = new Set(["index.d.ts", "create-atelier.d.ts"]);

for (const entry of await readdir(typesDirectory, { withFileTypes: true })) {
	if (entry.isFile() && publicDeclarations.has(entry.name)) continue;
	await rm(path.join(typesDirectory, entry.name), {
		recursive: true,
		force: true,
	});
}
