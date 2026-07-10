import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const gzipAsync = promisify(gzip);
const previewDirectory = new URL("../.preview/web/", import.meta.url);

for (const filePath of await findWasmFiles(previewDirectory)) {
	const source = await readFile(filePath);
	const compressed = await gzipAsync(source, { level: 9 });
	await writeFile(new URL(`${filePath.href}.gz`), compressed);
	await unlink(filePath);
	console.log(
		`Compressed ${path.basename(fileURLToPath(filePath))}: ${formatSize(source.length)} → ${formatSize(compressed.length)}`,
	);
}

async function findWasmFiles(directory) {
	const files = [];

	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryUrl = new URL(entry.name, directory);

		if (entry.isDirectory()) {
			entryUrl.pathname += "/";
			files.push(...(await findWasmFiles(entryUrl)));
		} else if (entry.name.endsWith(".wasm")) {
			files.push(entryUrl);
		}
	}

	return files;
}

function formatSize(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}
