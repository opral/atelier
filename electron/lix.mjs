import { app } from "electron";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { initLix, openLix } from "@lix-js/sdk";
import { createBetterSqlite3Backend } from "@lix-js/better-sqlite3-backend";

let lixPromise = null;
let lifecycle = Promise.resolve();

function enqueue(operation) {
	lifecycle = lifecycle.catch(() => {}).then(operation);
	return lifecycle;
}

function getLixFilename() {
	return path.join(app.getPath("documents"), "lix", "main.lix");
}

function getLixStoragePaths() {
	const filename = getLixFilename();
	return [filename, `${filename}-wal`, `${filename}-shm`, `${filename}-journal`];
}

export async function ensureLixOpen() {
	let outPromise;
	await enqueue(async () => {
		if (!lixPromise) {
			lixPromise = (async () => {
				const filename = getLixFilename();
				await mkdir(path.dirname(filename), { recursive: true });
				const backend = await createBetterSqlite3Backend({ filename });
				await initLix({ backend });
				return await openLix({ backend });
			})();
		}
		outPromise = lixPromise;
	});
	return await outPromise;
}

export async function closeLix() {
	await enqueue(async () => {
		if (!lixPromise) {
			return;
		}
		const currentPromise = lixPromise;
		try {
			const lix = await currentPromise;
			await lix.close();
		} finally {
			lixPromise = null;
		}
	});
}

export async function wipeLixStorage() {
	await closeLix();
	for (const pathToDelete of getLixStoragePaths()) {
		await rm(pathToDelete, { force: true });
	}
}
