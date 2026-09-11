import type { Lix } from "@lix-js/sdk";

/**
 * Whether workspace paths exist, answered synchronously from a cache that
 * fills in the background. Callers read `exists(path)` (undefined until
 * known) and learn about answers through `subscribe`.
 *
 * The cache follows the workspace: once the file list has been observed,
 * a file created, renamed, or deleted after the first look changes the
 * answer. `close` stops following when the editor goes away.
 */
export function createDocumentExistence(lix: Lix | null | undefined) {
	const known = new Map<string, boolean>();
	const pending = new Set<string>();
	const listeners = new Set<() => void>();
	// Every file path, once the observed list has arrived, and each id's path.
	let paths: Set<string> | null = null;
	const pathById = new Map<string, string>();
	let closed = false;
	const notify = () => {
		for (const listener of listeners) listener();
	};
	// Hosts and tests may hand the editor a stub without SQL access; then
	// existence simply stays unknown and links render plain.
	const hasSql =
		typeof (lix as { execute?: unknown } | null)?.execute === "function";
	const lookup = (path: string) => {
		if (!hasSql || !lix || pending.has(path)) return;
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
	// A stub without `observe` answers each path once and never changes.
	const events =
		hasSql &&
		lix &&
		typeof (lix as { observe?: unknown }).observe === "function"
			? lix.observe("SELECT id, path FROM lix_file", [])
			: null;
	if (events) {
		void (async () => {
			try {
				for (;;) {
					const event = await events.next();
					if (!event || closed) break;
					paths = new Set(
						event.result.rows.map((row) => String(row.path ?? "")),
					);
					pathById.clear();
					for (const row of event.result.rows) {
						pathById.set(String(row.id ?? ""), String(row.path ?? ""));
					}
					notify();
				}
			} catch {
				// The one-off lookups keep answering.
			}
		})();
	}
	return {
		exists: (path: string): boolean | undefined => {
			if (paths) return paths.has(path);
			const answer = known.get(path);
			if (answer === undefined) lookup(path);
			return answer;
		},
		/** The path of a file id, once the file list has been observed. */
		pathOf: (id: string): string | undefined => pathById.get(id),
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		close: () => {
			closed = true;
			events?.close();
		},
	};
}
