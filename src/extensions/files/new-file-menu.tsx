import { useRef, type ReactNode } from "react";
import { Upload } from "lucide-react";
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
	/** Absent in the Library, which creates things of a kind, not files. */
	readonly onNewFile?: () => void;
	/**
	 * The row ⌘ . makes here, marked with the shortcut. Without New file
	 * only: where there is one, ⌘ . is New file's.
	 */
	readonly shortcutType?: "markdown" | "csv" | "excalidraw";
	/** Absent where folders are not shown, e.g. the Library's Grid. */
	readonly onNewFolder?: () => void;
	readonly onNewMarkdown: () => void;
	/** Adds "Upload…" at the end: the same import a drop does. */
	readonly onUpload?: () => void;
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
	shortcutType,
	onNewFolder,
	onNewMarkdown,
	onUpload,
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
	// A row that created something opens it, focused: the menu must not hand
	// focus back to its button as it closes and take it from the new file.
	const shortcutFor = (type: "markdown" | "csv" | "excalidraw") =>
		!onNewFile && type === shortcutType
			? { shortcut: shortcutHint("⌘ .") }
			: {};
	const choseRef = useRef(false);
	const chose = (action: () => void) => (): void => {
		choseRef.current = true;
		action();
	};
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
			<DropdownMenuContent
				onCloseAutoFocus={(event) => {
					if (!choseRef.current) return;
					choseRef.current = false;
					event.preventDefault();
				}}
				align={align}
				aria-label="Create"
				className="atw:w-72 atw:p-1.5 atw:text-xs"
				sideOffset={3}
			>
				{onNewFile ? (
					<NewMenuItem
						dataAttr="file-new-file"
						iconUrl={fileNewIconUrl}
						label="New file"
						shortcut={shortcutHint("⌘ .")}
						onSelect={chose(onNewFile)}
						trailing={slotFor("generic", "file-new-file")}
					/>
				) : null}
				{/* No default folder for New folder: a folder is not a file type,
				    and "always nest one level in" is not a thing anyone wants. */}
				{onNewFolder ? (
					<NewMenuItem
						dataAttr="file-new-folder"
						iconUrl={folderBlueIconUrl}
						label="New folder"
						shortcut={shortcutHint("⇧⌘ .")}
						onSelect={chose(onNewFolder)}
					/>
				) : null}
				{onNewFile || onNewFolder ? (
					<DropdownMenuSeparator className="atw:my-1.5" />
				) : null}
				<NewMenuItem
					dataAttr="file-new-markdown"
					iconUrl={fileMdIconUrl}
					label="New Markdown"
					{...shortcutFor("markdown")}
					onSelect={chose(onNewMarkdown)}
					trailing={slotFor("markdown", "file-new-markdown")}
				/>
				<NewMenuItem
					dataAttr="file-new-csv"
					iconUrl={fileCsvIconUrl}
					label="New CSV"
					{...shortcutFor("csv")}
					onSelect={chose(onNewCsv)}
					trailing={slotFor("csv", "file-new-csv")}
				/>
				<NewMenuItem
					dataAttr="file-new-excalidraw"
					iconUrl={fileExcalidrawIconUrl}
					label="New Drawing"
					{...shortcutFor("excalidraw")}
					onSelect={chose(onNewExcalidraw)}
					trailing={slotFor("excalidraw", "file-new-excalidraw")}
				/>
				{onUpload ? (
					<>
						<DropdownMenuSeparator className="atw:my-1.5" />
						<DropdownMenuItem
							className="atw:gap-2 atw:py-1.75 atw:text-xs"
							data-attr="file-new-upload"
							onSelect={chose(onUpload)}
						>
							<Upload
								aria-hidden="true"
								className="atw:size-3.5 atw:shrink-0 atw:text-fg-subtle"
								strokeWidth={2}
							/>
							<span className="atw:min-w-0 atw:flex-1 atw:truncate">
								Upload…
							</span>
						</DropdownMenuItem>
					</>
				) : null}
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
		// control has one colour to sit on rather than two. It stays lit while
		// the control's panel is open, too: the pointer leaves the row to reach
		// the panel, and the row must not change under it on the way.
		<div
			className={`atw:group/row atw:relative atw:rounded-sm${
				trailing
					? " atw:hover:bg-bg-hover atw:focus-within:bg-bg-hover atw:has-data-[state=open]:bg-bg-hover"
					: ""
			}`}
			data-attr={`${dataAttr}-row`}
		>
			<DropdownMenuItem
				className="atw:gap-2 atw:py-1.75 atw:text-xs"
				data-attr={dataAttr}
				onSelect={onSelect}
				{...(trailing ? { onKeyDown: focusRowTrailingControl } : {})}
			>
				<img
					src={iconUrl}
					alt=""
					aria-hidden="true"
					className="atw:size-3.5 atw:shrink-0"
				/>
				<span className="atw:min-w-0 atw:flex-1 atw:truncate">{label}</span>
				{shortcut ? (
					// The trailing slot is one slot. On a row that has a disclosure
					// the shortcut hint is what sits in it at rest, and it fades as
					// the disclosure fades in — neither is in flow beside the other,
					// so the row's text never shifts.
					<kbd
						className={`atw:ml-3 atw:text-[10px] atw:font-semibold atw:text-fg-subtle${
							trailing
								? " atw:transition-opacity atw:group-hover/row:opacity-0 atw:group-focus-within/row:opacity-0 atw:group-has-data-[state=open]/row:opacity-0"
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
				//
				// It reaches the row's edge and pads the control in from there,
				// rather than stopping short of it: the control's panel opens a
				// few pixels beyond the control, and the pointer crosses that
				// strip to reach it. Owned by this wrapper the strip is inert;
				// owned by the row's menu item beneath, Radix would focus that
				// item as the pointer passed and close the panel for it. For the
				// same reason the wrapper stays visible and clickable while the
				// panel is open, not only while the row is hovered.
				<div
					className="atw:pointer-events-none atw:absolute atw:inset-y-0 atw:right-0 atw:flex atw:items-center atw:rounded-r-sm atw:pr-1.5 atw:pl-4 atw:opacity-0 atw:transition-opacity atw:group-hover/row:pointer-events-auto atw:group-hover/row:opacity-100 atw:group-focus-within/row:pointer-events-auto atw:group-focus-within/row:opacity-100 atw:group-has-data-[state=open]/row:pointer-events-auto atw:group-has-data-[state=open]/row:opacity-100"
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
