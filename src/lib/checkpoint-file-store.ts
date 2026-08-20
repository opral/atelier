import type { Lix } from "@lix-js/sdk";

export type CheckpointFileRow = {
	readonly id: string;
	readonly path: string;
};

const stores = new WeakMap<object, Map<string, readonly CheckpointFileRow[]>>();

function storeFor(lix: Lix): Map<string, readonly CheckpointFileRow[]> {
	let store = stores.get(lix as object);
	if (!store) {
		store = new Map();
		stores.set(lix as object, store);
	}
	return store;
}

/**
 * Shares the immutable result of the shell's checkpoint read with bundled
 * History UI without widening the public extension runtime.
 */
export function publishCheckpointFiles(
	lix: Lix,
	commitId: string,
	files: readonly CheckpointFileRow[],
): void {
	storeFor(lix).set(commitId, files);
}

export function readCheckpointFiles(
	lix: Lix,
	commitId: string,
): readonly CheckpointFileRow[] {
	return storeFor(lix).get(commitId) ?? EMPTY_CHECKPOINT_FILES;
}

const EMPTY_CHECKPOINT_FILES: readonly CheckpointFileRow[] = [];
