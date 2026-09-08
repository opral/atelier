import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
	AtelierExtensionLoader,
	AtelierJsonValue,
} from "../extension-api";
import { useAtelierRenderContext } from "../atelier-render-context";
import { decodeFileDataToText } from "../lib/decode-file-data";
import { qb, sql } from "../lib/lix-kysely";
import { selectFilesStateAt } from "../queries";

/** Resolve explicit extension view state as well as the ordinary path API. */
export async function readPreparedFile(
	{ lix, location, signal }: Parameters<AtelierExtensionLoader>[0],
	maxContentBytes?: number,
) {
	signal.throwIfAborted();
	const state =
		"view" in location &&
		location.state &&
		typeof location.state === "object" &&
		!Array.isArray(location.state)
			? (location.state as Record<string, AtelierJsonValue>)
			: {};
	const path =
		"path" in location
			? location.path
			: typeof state.filePath === "string"
				? state.filePath
				: undefined;
	const id = typeof state.fileId === "string" ? state.fileId : undefined;
	if (!path && !id) return undefined;
	const commit = [
		state.sourceCommitId,
		state.afterCommitId,
		state.beforeCommitId,
	].find((value) => typeof value === "string");
	const query =
		typeof commit === "string"
			? selectFilesStateAt(lix, commit)
			: qb(lix).selectFrom("lix_file as lix_state_at");
	const row = await query
		.select([
			"id",
			"path",
			"lixcol_change_id",
			sql<string>`lix_active_branch_commit_id()`.as("commit_id"),
			sql<number>`octet_length(content)`.as("size"),
			maxContentBytes === undefined
				? sql<unknown>`content`.as("content")
				: sql<unknown>`case when octet_length(content) <= ${maxContentBytes} then content else null end`.as(
						"content",
					),
		])
		.where(id ? "id" : "path", "=", id ?? path!)
		.executeTakeFirst();

	signal.throwIfAborted();
	return row;
}

/** File bytes stay inside the extension's data model, never a separate host preview. */
export const loadTextFile: AtelierExtensionLoader = async (args) => {
	const row = await readPreparedFile(args);
	return row
		? { id: row.id, path: row.path, content: decodeFileDataToText(row.content) }
		: null;
};

export function preparedFile(
	data: AtelierJsonValue,
): { id: string; path: string; content: string } | null {
	if (!data || typeof data !== "object" || Array.isArray(data)) return null;
	const record = data as Record<string, AtelierJsonValue>;
	return typeof record.id === "string" &&
		typeof record.path === "string" &&
		typeof record.content === "string"
		? { id: record.id, path: record.path, content: record.content }
		: null;
}

/** Retain the formatted document until the interactive surface is populated. */
export function PreparedFileSurface({
	initial,
	children,
	readySelector,
}: {
	readonly initial: ReactNode;
	readonly children: ReactNode;
	readonly readySelector: string;
}) {
	const { connected, hydrated } = useAtelierRenderContext();
	const [ready, setReady] = useState(false);
	const editor = useRef<HTMLDivElement>(null);
	const interactive = ready && connected && hydrated;
	useEffect(() => {
		if (!connected || !hydrated || !editor.current) {
			setReady(false);
			return;
		}
		const element = editor.current;
		const check = () => {
			if (element.querySelector(`${readySelector}, [role="alert"]`))
				setReady(true);
		};
		const observer = new MutationObserver(check);
		observer.observe(element, {
			childList: true,
			subtree: true,
			attributes: true,
		});
		check();
		return () => observer.disconnect();
	}, [connected, hydrated, readySelector]);
	return (
		<div
			className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
			data-atelier-document-surface=""
		>
			{!interactive ? (
				<div
					className="min-h-0 flex-1 overflow-auto"
					data-atelier-initial-content=""
				>
					{initial}
				</div>
			) : null}
			{connected && hydrated ? (
				<div
					ref={editor}
					aria-hidden={!interactive || undefined}
					className={
						interactive
							? "flex min-h-0 flex-1 flex-col"
							: "absolute inset-0 flex min-h-0 flex-col opacity-0 pointer-events-none"
					}
				>
					{children}
				</div>
			) : null}
		</div>
	);
}
