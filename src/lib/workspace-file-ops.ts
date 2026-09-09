import type { Lix } from "@lix-js/sdk";
import { qb } from "./lix-kysely";

/**
 * Canonical workspace file operations for the lix ecosystem.
 *
 * The File Explorer extension and host-built file surfaces (e.g. LixRay's
 * directory browser) share these so mutation semantics can never fork:
 * files move and delete by id, folders by path, and the engine keeps
 * children consistent. Deletion asks for no confirmation by convention —
 * lix history makes every delete recoverable.
 */
export type WorkspaceEntryRef =
	| ({ readonly kind: "file" } & (
			| { readonly id: string }
			| { readonly path: string }
	  ))
	| { readonly kind: "directory"; readonly path: string };

/** Thrown when a rename would land on an already-occupied path. */
export class WorkspacePathTakenError extends Error {
	constructor(readonly path: string) {
		super(`'${path}' already exists`);
		this.name = "WorkspacePathTakenError";
	}
}

export async function renameWorkspaceEntry(
	lix: Lix,
	entry: WorkspaceEntryRef,
	nextPath: string,
): Promise<void> {
	const destination = await workspaceEntryAtPath(lix, nextPath);
	if (destination) {
		// Another client may already have applied this rename to the same file.
		// Treat that replay as complete instead of inventing a collision suffix.
		if (
			entry.kind === destination.kind &&
			("id" in entry && "id" in destination
				? entry.id === destination.id
				: "path" in entry && entry.path === nextPath)
		)
			return;
		throw new WorkspacePathTakenError(nextPath);
	}
	if (entry.kind === "file") {
		let update = qb(lix).updateTable("lix_file").set({ path: nextPath });
		update =
			"id" in entry
				? update.where("id", "=", entry.id)
				: update.where("path", "=", entry.path);
		await update.execute();
		return;
	}
	await qb(lix)
		.updateTable("lix_directory")
		.set({ path: nextPath })
		.where("path", "=", entry.path)
		.execute();
}

export async function deleteWorkspaceEntry(
	lix: Lix,
	entry: WorkspaceEntryRef,
): Promise<void> {
	if (entry.kind === "file") {
		let remove = qb(lix).deleteFrom("lix_file");
		remove =
			"id" in entry
				? remove.where("id", "=", entry.id)
				: remove.where("path", "=", entry.path);
		await remove.execute();
		return;
	}
	await qb(lix)
		.deleteFrom("lix_directory")
		.where("path", "=", entry.path)
		.execute();
}

async function workspaceEntryAtPath(
	lix: Lix,
	path: string,
): Promise<WorkspaceEntryRef | null> {
	const [file] = await qb(lix)
		.selectFrom("lix_file")
		.where("path", "=", path)
		.select(["id"])
		.limit(1)
		.execute();
	if (file) return { kind: "file", id: file.id };
	const [directory] = await qb(lix)
		.selectFrom("lix_directory")
		.where("path", "=", path)
		.select(["path"])
		.limit(1)
		.execute();
	return directory ? { kind: "directory", path: directory.path } : null;
}
