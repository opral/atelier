import { DocumentLoading } from "../components/document-loading";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type {
	AtelierExtensionLoader,
	AtelierJsonValue,
} from "../extension-api";
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
	const id =
		"path" in location && typeof location.fileId === "string"
			? location.fileId
			: typeof state.fileId === "string"
				? state.fileId
				: undefined;
	if (!path && !id) return undefined;
	const commit = [
		state.sourceCommitId,
		state.afterCommitId,
		state.beforeCommitId,
	].find((value) => typeof value === "string");
	const query =
		typeof commit === "string"
			? selectFilesStateAt(lix, commit)
			: qb(lix).selectFrom("lix_file as lix_as_of");
	const row = await query
		.select([
			"id",
			"path",
			"lixcol_change_id",
			(typeof commit === "string"
				? sql<string>`${commit}`
				: sql<string>`lix_active_branch_commit_id()`
			).as("commit_id"),
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

/** See `holdInitialMs`: long enough for a quick open, short of feeling slow. */
const PREPARED_PICTURE_HOLD_MS = 400;

/**
 * Retain the formatted document until the interactive surface is populated.
 *
 * The surface outlives the document it shows: a mounted view handed the next
 * document names it in `documentKey`, and the surface returns to the prepared
 * picture of that document until the interactive one is populated again,
 * without the frame around it moving.
 */
export function PreparedFileSurface({
	initial,
	children,
	readySelector,
	documentKey = "",
	diff = false,
	holdInitialMs = PREPARED_PICTURE_HOLD_MS,
}: {
	readonly initial: ReactNode;
	readonly children: ReactNode;
	readonly readySelector: string;
	/** Which document the surface shows; a change starts the wait again. */
	readonly documentKey?: string;
	/**
	 * The interactive surface is a comparison, so the prepared document — one
	 * revision of the file — is the wrong picture. Wait for the comparison
	 * instead of painting a page that is about to be replaced.
	 */
	readonly diff?: boolean;
	/**
	 * How long the prepared picture stays out of sight. It is never drawn
	 * exactly like the interactive surface — a plain table for a canvas grid,
	 * frontmatter as YAML for a property panel, text without its gutter — so
	 * on an open that is quick anyway it flashed for a frame or two before
	 * the surface replaced it. The picture is for the open that is not.
	 */
	readonly holdInitialMs?: number;
}) {
	const [readyFor, setReadyFor] = useState<string | null>(null);
	const [revealedFor, setRevealedFor] = useState<string | null>(
		holdInitialMs ? null : documentKey,
	);
	const editor = useRef<HTMLDivElement>(null);
	const interactive = readyFor === documentKey;
	const initialRevealed = !holdInitialMs || revealedFor === documentKey;
	useEffect(() => {
		if (!holdInitialMs || interactive) return;
		const timer = setTimeout(() => setRevealedFor(documentKey), holdInitialMs);
		return () => clearTimeout(timer);
	}, [documentKey, holdInitialMs, interactive]);
	// A layout effect, so a surface that is populated in the same commit — a
	// comparison's frame waiting for its sides — is shown before the browser
	// paints, never the prepared picture for one frame first.
	useLayoutEffect(() => {
		if (!editor.current) {
			setReadyFor(null);
			return;
		}
		const element = editor.current;
		const check = () => {
			if (
				element.querySelector(
					`${readySelector}, [role="alert"], [data-atelier-diff-pending]`,
				)
			)
				setReadyFor(documentKey);
		};
		const observer = new MutationObserver(check);
		observer.observe(element, {
			childList: true,
			subtree: true,
			attributes: true,
		});
		check();
		return () => observer.disconnect();
	}, [documentKey, readySelector]);
	return (
		<div
			className="relative flex min-h-0 flex-1 flex-col overflow-hidden"
			data-atelier-document-surface=""
		>
			{!interactive ? (
				<div
					className={`min-h-0 flex-1 overflow-auto${initialRevealed ? "" : " invisible"}`}
					data-atelier-initial-content=""
					data-atelier-awaiting-diff={diff || undefined}
				>
					{diff ? <DocumentLoading /> : initial}
				</div>
			) : null}
			{
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
			}
		</div>
	);
}
