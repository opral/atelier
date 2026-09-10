import type { Lix } from "@lix-js/sdk";

/**
 * Whether workspace paths exist, answered synchronously from a cache that
 * fills in the background. Callers read `exists(path)` (undefined until
 * known) and learn about answers through `subscribe`.
 */
export function createDocumentExistence(lix: Lix | null | undefined) {
	const known = new Map<string, boolean>();
	const pending = new Set<string>();
	const listeners = new Set<() => void>();
	const notify = () => {
		for (const listener of listeners) listener();
	};
	const lookup = (path: string) => {
		// Hosts and tests may hand the editor a stub without SQL access; then
		// existence simply stays unknown and links render plain.
		if (typeof (lix as { execute?: unknown } | null)?.execute !== "function")
			return;
		if (!lix || pending.has(path)) return;
		pending.add(path);
		void lix
			.execute("SELECT id FROM lix_file WHERE path = $1 LIMIT 1", [path])
			.then(
				(result) => {
					known.set(path, result.rows.length > 0);
				},
				() => {
					known.set(path, false);
				},
			)
			.finally(() => {
				pending.delete(path);
				notify();
			});
	};
	return {
		exists: (path: string): boolean | undefined => {
			const answer = known.get(path);
			if (answer === undefined) lookup(path);
			return answer;
		},
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
