import { useEffect, useMemo, type MouseEvent, type ReactNode } from "react";
import { DiffGlyph } from "@/components/diff-glyph";
import { fileIconUrl } from "../files/file-icons";
import { KindIcon } from "./kind-icon";
import type { ExtensionRuntime, ExtensionView } from "../../extension-runtime/types";
import { ATELIER_BUILTIN_EXTENSION_IDS } from "../../extension-api";
import { LIBRARY_KIND_COPY, type LibraryKind } from "./kinds";
import {
	useLibraryData,
	useLibraryReviewMarks,
	type LibraryFile,
} from "./library-data";
import {
	LIBRARY_EXTENSION_ID,
	RECENT_LIMIT,
	libraryLocationFromState,
	libraryState,
	preferredMode,
	pushRecentFile,
	recentFileIds,
} from "./library-state";

const SIDEBAR_KINDS: readonly (LibraryKind | "database")[] = [
	"all",
	"pages",
	"tables",
	"drawings",
	"media",
	"database",
	"other",
];

export function isNewTabClick(event: MouseEvent): boolean {
	return event.metaKey || event.ctrlKey || event.button === 1;
}

/**
 * Remembers every document that comes to the front, so Recent is "what I
 * opened", whichever surface opened it.
 */
export function useTrackRecentDocuments(
	atelier: ExtensionRuntime,
	view: ExtensionView,
): void {
	const activeFileId = atelier.documents.activeFileId;
	const preferences = view.preferences;
	useEffect(() => {
		if (!activeFileId) return;
		pushRecentFile(preferences, activeFileId);
	}, [activeFileId, preferences]);
}

/** Opens a Library location in the Library tab in front, or the home one. */
export function openLibraryLocation(
	atelier: ExtensionRuntime,
	view: ExtensionView,
	kind: LibraryKind,
	options: { readonly newTab?: boolean } = {},
): void {
	const location = {
		kind,
		mode: preferredMode(view.preferences, kind),
		dirPath: "/",
	};
	const active = atelier.views.activeMain;
	const inLibraryTab =
		active?.extensionId === LIBRARY_EXTENSION_ID && !options.newTab;
	void atelier.views
		.open(LIBRARY_EXTENSION_ID, {
			state: libraryState(location),
			...(options.newTab ? { newTab: true } : {}),
			...(inLibraryTab ? { instanceId: active.instanceId } : {}),
		})
		.catch((error: unknown) => {
			console.error("library: unable to open the Library", error);
		});
}

/**
 * The Library's left panel: the kinds, the Database, and what was opened
 * last. It navigates; the Library view in the main area shows.
 */
export function LibrarySidebar({
	atelier,
	view,
}: {
	readonly atelier: ExtensionRuntime;
	readonly view: ExtensionView;
}) {
	useTrackRecentDocuments(atelier, view);
	const { data } = useLibraryData();
	const marks = useLibraryReviewMarks(atelier, data);
	const active = atelier.views.activeMain;
	const activeKind: LibraryKind | "database" | null =
		active?.extensionId === LIBRARY_EXTENSION_ID
			? libraryLocationFromState(active.state, view.preferences).kind
			: active?.extensionId === ATELIER_BUILTIN_EXTENSION_IDS.sqlExplorer
				? "database"
				: null;
	const recentIds = recentFileIds(view.preferences);
	const recent = useMemo(() => {
		if (!data) return [];
		const byId = new Map(data.files.map((file) => [file.id, file]));
		const files: LibraryFile[] = [];
		for (const id of recentIds) {
			const file = byId.get(id);
			if (file && !file.hidden) files.push(file);
			if (files.length === RECENT_LIMIT) break;
		}
		// Until enough has been opened, the most recently changed files fill
		// the list (data.files is newest first), so Recent is never a blank.
		for (const file of data.files) {
			if (files.length >= RECENT_LIMIT) break;
			if (!file.hidden && !files.includes(file)) files.push(file);
		}
		return files;
		// recentIds is a fresh array per render; its content is the key.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [data, recentIds.join("\0")]);
	const activeFileId = atelier.documents.activeFileId;

	return (
		<nav
			aria-label="Library"
			className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-1 pb-2 pr-1"
			data-testid="library-sidebar"
		>
			<ul className="flex flex-col gap-px">
				{SIDEBAR_KINDS.map((kind) => {
					const isActive = activeKind === kind;
					const label =
						kind === "database" ? "Database" : LIBRARY_KIND_COPY[kind].label;
					const icon = <KindIcon kind={kind} />;
					const changed =
						kind !== "database" &&
						kind !== "all" &&
						marks.kinds.has(kind);
					return (
						<li key={kind}>
							<SidebarRow
								active={isActive}
								dimmed={marks.active && !changed && kind !== "all"}
								icon={icon}
								label={label}
								testId={`library-kind-${kind}`}
								trailing={
									changed ? <DiffGlyph kind="modified" size={10} /> : null
								}
								onClick={(event) => {
									if (kind === "database") {
										void atelier.views
											.open(ATELIER_BUILTIN_EXTENSION_IDS.sqlExplorer, {
												...(isNewTabClick(event) ? { newTab: true } : {}),
											})
											.catch((error: unknown) => {
												console.error(
													"library: unable to open the SQL Explorer",
													error,
												);
											});
										return;
									}
									openLibraryLocation(atelier, view, kind, {
										newTab: isNewTabClick(event),
									});
								}}
							/>
						</li>
					);
				})}
			</ul>
			{recent.length > 0 ? (
				<>
					<p className="mt-4 mb-1 px-1.5 text-[11px] font-semibold tracking-[0.06em] text-fg-subtle uppercase select-none">
						Recent
					</p>
					<ul className="flex flex-col gap-px" data-testid="library-recent">
						{recent.map((file) => {
							const glyph = marks.files.get(file.path);
							return (
								<li key={file.id}>
									<SidebarRow
										active={activeFileId === file.id}
										dimmed={marks.active && !glyph}
										icon={
											<img
												src={fileIconUrl(file.path)}
												alt=""
												aria-hidden="true"
												className="size-3.5 shrink-0"
											/>
										}
										label={file.displayName}
										title={file.path}
										trailing={glyph ? <DiffGlyph kind={glyph} size={10} /> : null}
										onClick={(event) => {
											void atelier.documents
												.open(file.path, {
													fileId: file.id,
													...(isNewTabClick(event) ? { newTab: true } : {}),
												})
												.catch((error: unknown) => {
													console.error("library: unable to open", error);
												});
										}}
									/>
								</li>
							);
						})}
					</ul>
				</>
			) : null}
		</nav>
	);
}

function SidebarRow({
	active,
	dimmed,
	icon,
	label,
	title,
	trailing,
	testId,
	onClick,
}: {
	readonly active: boolean;
	readonly dimmed: boolean;
	readonly icon: ReactNode;
	readonly label: string;
	readonly title?: string;
	readonly trailing?: ReactNode;
	readonly testId?: string;
	readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
	return (
		<button
			type="button"
			title={title}
			aria-current={active ? "page" : undefined}
			data-testid={testId}
			className={`flex h-7 w-full select-none items-center gap-2 rounded-control px-1.5 text-left text-[13px] transition-[background-color,opacity] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
				active
					? "bg-bg-active font-medium text-fg"
					: "text-fg-muted hover:bg-bg-hover-strong"
			}${dimmed ? " opacity-[0.45] hover:opacity-100" : ""}`}
			onMouseDown={(event) => {
				// Middle-click opens in a new tab; keep focus where it is.
				if (event.button === 1) event.preventDefault();
			}}
			onAuxClick={(event) => {
				if (event.button === 1) onClick(event);
			}}
			onClick={onClick}
		>
			{icon}
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{trailing}
		</button>
	);
}
