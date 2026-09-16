import { type ReactNode } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shortcutHint } from "@/lib/platform";
import fileNewIconUrl from "./assets/file-new.svg";
import folderBlueIconUrl from "./assets/folder-blue.svg";
import fileCsvIconUrl from "./assets/file-csv.svg";
import fileExcalidrawIconUrl from "./assets/file-excalidraw.svg";
import fileMdIconUrl from "./assets/file-md.svg";
import {
	DefaultFolderSlot,
	focusRowTrailingControl,
} from "./default-folder-slot";
import type {
	DefaultFolderFileType,
	DefaultFolders,
	PickerFolder,
} from "./default-folder";

export type NewFileMenuProps = {
	/** The trigger. It is rendered as the menu's button, unchanged. */
	readonly children: ReactNode;
	/**
	 * Which edge of the trigger the menu hangs from. The Files view's button
	 * starts a column, so the menu starts where it does; a button at the end
	 * of a header would push a start-aligned menu off its own column.
	 */
	readonly align?: "start" | "end";
	readonly onNewCsv: () => void;
	readonly onNewExcalidraw: () => void;
	readonly onNewFile: () => void;
	readonly onNewFolder: () => void;
	readonly onNewMarkdown: () => void;
	readonly defaultFolders: DefaultFolders;
	readonly folderOptions: readonly PickerFolder[];
	readonly hereDirectory: string;
	readonly existingDirectories: ReadonlySet<string>;
	readonly onSetDefaultFolder?: (
		fileType: DefaultFolderFileType,
		folder: string | null,
	) => void;
	readonly onCreateHereOnce: (fileType: DefaultFolderFileType) => void;
	readonly onCreateFolder: (
		parentDirectory: string,
		name: string,
	) => Promise<string | null>;
};

/**
 * Atelier's New menu: the rows that create, and on each one the slot that
 * says — and sets — the folder that row creates in. Exported whole so a host
 * surface with a New button of its own offers the same menu rather than a
 * lookalike that drifts from it.
 */
export function NewFileMenu({
	children,
	align = "start",
	onNewCsv,
	onNewExcalidraw,
	onNewFile,
	onNewFolder,
	onNewMarkdown,
	defaultFolders,
	folderOptions,
	hereDirectory,
	existingDirectories,
	onSetDefaultFolder,
	onCreateHereOnce,
	onCreateFolder,
}: NewFileMenuProps) {
	// A row's disclosure needs somewhere to persist the choice. Without a
	// preference store the menu is exactly today's menu, slot and all.
	const slotFor = (fileType: DefaultFolderFileType, dataAttr: string) =>
		onSetDefaultFolder ? (
			<DefaultFolderSlot
				fileType={fileType}
				dataAttr={dataAttr}
				folders={folderOptions}
				hereDirectory={hereDirectory}
				existingDirectories={existingDirectories}
				defaultFolder={defaultFolders[fileType]}
				onPick={(folder) => onSetDefaultFolder(fileType, folder)}
				onRemove={() => onSetDefaultFolder(fileType, null)}
				onCreateHereOnce={() => onCreateHereOnce(fileType)}
				onCreateFolder={onCreateFolder}
			/>
		) : null;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent
				align={align}
				aria-label="Create"
				className="w-72 p-1.5 text-xs"
				sideOffset={3}
			>
				<NewMenuItem
					dataAttr="file-new-file"
					iconUrl={fileNewIconUrl}
					label="New file"
					shortcut={shortcutHint("⌘ .")}
					onSelect={onNewFile}
					trailing={slotFor("generic", "file-new-file")}
				/>
				{/* No default folder for New folder: a folder is not a file type,
				    and "always nest one level in" is not a thing anyone wants. */}
				<NewMenuItem
					dataAttr="file-new-folder"
					iconUrl={folderBlueIconUrl}
					label="New folder"
					shortcut={shortcutHint("⇧⌘ .")}
					onSelect={onNewFolder}
				/>
				<DropdownMenuSeparator className="my-1.5" />
				<NewMenuItem
					dataAttr="file-new-markdown"
					iconUrl={fileMdIconUrl}
					label="New Markdown"
					onSelect={onNewMarkdown}
					trailing={slotFor("markdown", "file-new-markdown")}
				/>
				<NewMenuItem
					dataAttr="file-new-csv"
					iconUrl={fileCsvIconUrl}
					label="New CSV"
					onSelect={onNewCsv}
					trailing={slotFor("csv", "file-new-csv")}
				/>
				<NewMenuItem
					dataAttr="file-new-excalidraw"
					iconUrl={fileExcalidrawIconUrl}
					label="New Drawing"
					onSelect={onNewExcalidraw}
					trailing={slotFor("excalidraw", "file-new-excalidraw")}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function NewMenuItem({
	dataAttr,
	iconUrl,
	label,
	shortcut,
	onSelect,
	trailing,
}: {
	readonly dataAttr: string;
	readonly iconUrl: string;
	readonly label: string;
	readonly shortcut?: string;
	readonly onSelect: () => void;
	readonly trailing?: ReactNode;
}) {
	return (
		// The row's hover fill lives on the wrapper so the row stays lit while
		// the pointer is on the control at its trailing edge — and so the
		// control has one colour to sit on rather than two.
		<div
			className={`group/row relative rounded-sm${
				trailing ? " hover:bg-bg-hover focus-within:bg-bg-hover" : ""
			}`}
			data-attr={`${dataAttr}-row`}
		>
			<DropdownMenuItem
				className="gap-2 py-1.75 text-xs"
				data-attr={dataAttr}
				onSelect={onSelect}
				{...(trailing ? { onKeyDown: focusRowTrailingControl } : {})}
			>
				<img
					src={iconUrl}
					alt=""
					aria-hidden="true"
					className="size-3.5 shrink-0"
				/>
				<span className="min-w-0 flex-1 truncate">{label}</span>
				{shortcut ? (
					// The trailing slot is one slot. On a row that has a disclosure
					// the shortcut hint is what sits in it at rest, and it fades as
					// the disclosure fades in — neither is in flow beside the other,
					// so the row's text never shifts.
					<kbd
						className={`ml-3 text-[10px] font-semibold text-fg-subtle${
							trailing
								? " transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0"
								: ""
						}`}
					>
						{shortcut}
					</kbd>
				) : null}
			</DropdownMenuItem>
			{trailing ? (
				// Out of flow on purpose. At rest the row is exactly today's row,
				// and nothing in it moves or changes width when the control
				// appears under the cursor or under the arrow keys.
				<div
					className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center rounded-r-sm pl-4 opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100"
					// The label's tail passes under the control rather than being
					// squeezed by it: the row must not reflow when the control
					// appears, so the control fades the row's own fill over it.
					style={{
						background:
							"linear-gradient(to right, transparent 0, var(--atelier-bg-hover) 14px)",
					}}
				>
					{trailing}
				</div>
			) : null}
		</div>
	);
}
