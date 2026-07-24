import type { LixSnapshotStorage } from "@lix-js/sdk";

const DATABASE_NAME = "atelier-preview";
const STORE_NAME = "lix-snapshots";

export class IndexedDbSnapshotStorage implements LixSnapshotStorage {
	async load(namespace: string): Promise<Uint8Array | undefined> {
		const database = await openDatabase();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, "readonly");
			const request = transaction.objectStore(STORE_NAME).get(namespace);
			request.onsuccess = () => {
				const snapshot = request.result;
				resolve(
					snapshot instanceof ArrayBuffer
						? new Uint8Array(snapshot)
						: undefined,
				);
			};
			request.onerror = () => reject(request.error);
		});
	}

	async save(namespace: string, snapshot: Uint8Array): Promise<void> {
		const database = await openDatabase();
		await new Promise<void>((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, "readwrite");
			transaction
				.objectStore(STORE_NAME)
				.put(snapshot.slice().buffer, namespace);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
	}
}

function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore(STORE_NAME);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}
