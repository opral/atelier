import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
	Check,
	ChevronDown,
	Folder,
	FolderPlus,
	Plus,
	RotateCcw,
	Search,
	Trash2,
} from "lucide-react";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import folderBlueIconUrl from "./assets/folder-blue.svg";
import {
	defaultFolderState,
	fileTypeNoun,
	filterPickerFolders,
	folderDisplayName,
	type DefaultFolderFileType,
	type DefaultFolderState,
	type PickerFolder,
} from "./default-folder";

const MENU_ITEM =
	'[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/**
 * Radix walks the open menu with the arrow keys and owns which item has focus.
 * Stepping from a row to the control at its trailing edge is the same move —
 * the control is a menu item too — so it is done by finding the neighbouring
 * item rather than by inventing a second focus system beside Radix's.
 */
function siblingMenuItem(
	from: HTMLElement | null,
	direction: 1 | -1,
): HTMLElement | null {
	if (!from) return null;
	const content = from.closest<HTMLElement>("[data-radix-menu-content]");
	if (!content) return null;
	const items = [...content.querySelectorAll<HTMLElement>(MENU_ITEM)].filter(
		(item) => item.closest("[data-radix-menu-content]") === content,
	);
	const index = items.indexOf(from);
	return (index < 0 ? undefined : items[index + direction]) ?? null;
}

function focusSiblingMenuItem(
	from: HTMLElement | null,
	direction: 1 | -1,
): boolean {
	const next = siblingMenuItem(from, direction);
	if (!next) return false;
	next.focus();
	return true;
}

/** ArrowRight on a row steps into the control at its trailing edge. */
export function focusRowTrailingControl(
	event: ReactKeyboardEvent<HTMLElement>,
): void {
	if (event.key !== "ArrowRight") return;
	if (focusSiblingMenuItem(event.currentTarget, 1)) {
		event.preventDefault();
		event.stopPropagation();
	}
}

type SlotMode = "menu" | "picker" | "new-folder";

export type DefaultFolderSlotProps = {
	readonly fileType: DefaultFolderFileType;
	/** Every folder in the repository, root first, in tree order. */
	readonly folders: readonly PickerFolder[];
	readonly hereDirectory: string;
	readonly existingDirectories: ReadonlySet<string>;
	readonly defaultFolder: string | undefined;
	readonly onPick: (folder: string) => void;
	readonly onRemove: () => void;
	/** Creates in the folder in view without touching the default. */
	readonly onCreateHereOnce: () => void;
	/** Creates a folder and resolves to its path, or null if it could not. */
	readonly onCreateFolder: (
		parentDirectory: string,
		name: string,
	) => Promise<string | null>;
	readonly dataAttr: string;
};

/**
 * The New menu's trailing slot: one place on the row that is empty at rest,
 * shows a folder glyph when the row has no default, and names the default
 * when it has one. It is never the thing that creates — the row is — so the
 * two clicks cannot be confused.
 */
export function DefaultFolderSlot({
	fileType,
	folders,
	hereDirectory,
	existingDirectories,
	defaultFolder,
	onPick,
	onRemove,
	onCreateHereOnce,
	onCreateFolder,
	dataAttr,
}: DefaultFolderSlotProps) {
	const state = useMemo(
		() =>
			defaultFolderState({
				defaultFolder,
				hereDirectory,
				existingDirectories,
			}),
		[defaultFolder, existingDirectories, hereDirectory],
	);
	const [open, setOpen] = useState(false);
	const [hovered, setHovered] = useState(false);
	const [mode, setMode] = useState<SlotMode>("picker");
	const triggerRef = useRef<HTMLDivElement>(null);
	// Where `New folder…` will put the folder: whichever option the picker was
	// resting on when it was chosen, and the repository root otherwise.
	const pickerParentRef = useRef("/");
	// Radix opens a submenu when the pointer merely crosses its trigger. The
	// label is a button: it opens on a click or a key and on nothing else, so
	// an open is accepted only when one of those has just happened.
	const intentRef = useRef(false);
	const noun = fileTypeNoun(fileType);

	const handleOpenChange = useCallback(
		(next: boolean) => {
			if (next) {
				if (!intentRef.current) return;
				intentRef.current = false;
				setMode(state.kind === "unset" ? "picker" : "menu");
			}
			setOpen(next);
		},
		[state.kind],
	);
	const close = useCallback(() => {
		// Focus moves back to the trigger first: the panel plays an exit
		// animation and stays mounted through it, so focus left inside it lands
		// on the body when it finally goes, and the keyboard loses the menu.
		const trigger = triggerRef.current;
		// Picking the folder you are already in makes the slot say nothing and
		// leave, so the row it belongs to catches the focus it drops.
		const row = siblingMenuItem(trigger, -1);
		trigger?.focus();
		setOpen(false);
		requestAnimationFrame(() => {
			if (triggerRef.current?.isConnected) triggerRef.current.focus();
			else row?.focus();
		});
	}, []);

	// Inside the default folder itself, here and the default are the same
	// place, so the row has nothing to say and the slot is omitted entirely.
	// The consequence is deliberate: the default is changed from anywhere the
	// row would actually send the file somewhere else.
	if (state.kind === "here") return null;

	return (
		<Menu.Sub open={open} onOpenChange={handleOpenChange}>
			<SlotTooltip
				anchorRef={triggerRef}
				label={triggerTitle(state, noun)}
				// Only where the slot cannot say it itself: a glyph with no default
				// behind it, or a default whose folder is gone. A named folder is
				// already the sentence, and the panel replaces the tooltip
				// outright — over an open picker it would name what the picker
				// is already showing.
				show={hovered && !open && state.kind !== "set"}
			/>
			<Menu.SubTrigger
				ref={triggerRef}
				data-attr={`${dataAttr}-default-folder`}
				aria-label={triggerTitle(state, noun)}
				className={
					// A broken default gets the room to say so; the folder's name is
					// the half of that sentence the user needs.
					(state.kind === "missing" ? "max-w-[176px] " : "max-w-[128px] ") +
					"flex h-5 cursor-default items-center gap-1 rounded-control border border-transparent px-1.5 text-[11px] outline-hidden select-none " +
					// At rest it is a caption on the row: it says where the row
					// creates. It draws its boundary once the pointer or the arrow
					// keys reach it, which is the same moment it can be pressed —
					// so a thing that looks pressable always is.
					"data-[highlighted]:border-[var(--color-border-subtle)] data-[highlighted]:bg-[var(--color-bg-control)] " +
					"data-[state=open]:border-[var(--color-border-strong)] data-[state=open]:bg-[var(--color-bg-control)] " +
					(state.kind === "missing"
						? "text-[var(--color-text-status-warning)]"
						: "text-[var(--color-text-tertiary)]")
				}
				onPointerDown={() => {
					intentRef.current = true;
				}}
				onPointerEnter={() => setHovered(true)}
				onFocus={() => setHovered(true)}
				onBlur={() => setHovered(false)}
				onPointerLeave={(event) => {
					// Radix closes a submenu when the pointer wanders off its
					// trigger. This one holds a search field; it closes on Escape,
					// on a pick, or on a press outside.
					event.preventDefault();
					setHovered(false);
				}}
				onKeyDown={(event) => {
					if (
						event.key === "Enter" ||
						event.key === " " ||
						event.key === "ArrowRight"
					) {
						intentRef.current = true;
						return;
					}
					if (event.key === "ArrowLeft" && !open) {
						// Back out to the row this control belongs to.
						if (focusSiblingMenuItem(event.currentTarget, -1)) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}}
			>
				{/* "in" only where the row really does create in there. */}
				{state.kind === "set" ? (
					<span className="shrink-0 opacity-80">in</span>
				) : null}
				{state.kind === "unset" ? (
					// Nothing is set, so there is no folder to name and nothing to
					// disclose: one glyph that says what pressing it would do.
					<FolderPlus aria-hidden="true" className="size-3.5 shrink-0" />
				) : state.kind === "missing" ? (
					<Folder aria-hidden="true" className="size-3 shrink-0" />
				) : (
					<img
						src={folderBlueIconUrl}
						alt=""
						aria-hidden="true"
						className="size-3.5 shrink-0"
					/>
				)}
				{state.kind === "unset" ? null : (
					<span className="min-w-0 truncate">
						{folderDisplayName(state.folder)}
					</span>
				)}
				{state.kind === "missing" ? (
					<span className="shrink-0 opacity-90">· missing</span>
				) : null}
				{state.kind === "unset" ? null : (
					<ChevronDown aria-hidden="true" className="size-2.5 shrink-0" />
				)}
			</Menu.SubTrigger>
			<Menu.Portal>
				<DropdownMenuSubContent
					className="w-64 p-1.5 text-xs"
					sideOffset={6}
					alignOffset={-6}
					collisionPadding={8}
					aria-label={
						mode === "menu" ? `Default folder options` : `Default folder`
					}
					onEscapeKeyDown={(event) => {
						// Radix's default closes the whole New menu. Escape here backs
						// out one step, to the row the control belongs to.
						event.preventDefault();
						event.stopPropagation();
						close();
					}}
				>
					{mode === "menu" ? (
						<LabelMenu
							noun={noun}
							state={state}
							onChangeFolder={() => setMode("picker")}
							onCreateHereOnce={onCreateHereOnce}
							onRecreateFolder={async () => {
								if (state.kind !== "missing") return;
								const segments = state.folder.split("/").filter(Boolean);
								const name = segments.at(-1) ?? "";
								const parent = `/${segments.slice(0, -1).join("/")}`;
								await onCreateFolder(parent === "/" ? "/" : `${parent}/`, name);
								close();
							}}
							onRemove={() => {
								onRemove();
								close();
							}}
						/>
					) : mode === "picker" ? (
						<FolderPicker
							noun={noun}
							folders={folders}
							selected={state.kind === "unset" ? null : state.folder}
							onHighlight={(folder) => {
								pickerParentRef.current = folder;
							}}
							onPick={(folder) => {
								onPick(folder);
								close();
							}}
							onNewFolder={() => setMode("new-folder")}
						/>
					) : (
						<NewFolderField
							parentDirectory={pickerParentRef.current}
							onCancel={() => setMode("picker")}
							onCreate={async (parent, name) => {
								const created = await onCreateFolder(parent, name);
								if (created) onPick(created);
								close();
							}}
						/>
					)}
				</DropdownMenuSubContent>
			</Menu.Portal>
		</Menu.Sub>
	);
}

/** How long a pointer rests on the glyph before it is named. */
const TOOLTIP_DELAY_MS = 350;

/**
 * The glyph says nothing on its own, so it is named where it is looked at.
 *
 * Not Radix's tooltip: that is a dismissable layer, and a layer over an open
 * menu takes the first Escape for itself, leaving the menu to need a second.
 * This is a label and nothing else — portalled, because the menu scrolls its
 * own contents and would clip it.
 */
function SlotTooltip({
	anchorRef,
	label,
	show,
}: {
	readonly anchorRef: { readonly current: HTMLElement | null };
	readonly label: string;
	readonly show: boolean;
}) {
	const [at, setAt] = useState<{ left: number; top: number } | null>(null);
	useEffect(() => {
		if (!show) {
			setAt(null);
			return;
		}
		const timer = setTimeout(() => {
			const rect = anchorRef.current?.getBoundingClientRect();
			if (rect)
				setAt({ left: rect.left + rect.width / 2, top: rect.bottom + 6 });
		}, TOOLTIP_DELAY_MS);
		return () => clearTimeout(timer);
	}, [anchorRef, show]);
	if (at === null || typeof document === "undefined") return null;
	return createPortal(
		<div
			role="tooltip"
			data-attr="default-folder-tooltip"
			className="atelier-portal pointer-events-none fixed z-50 max-w-64 -translate-x-1/2 rounded-md bg-[var(--color-bg-tooltip)] px-3 py-1.5 font-sans text-xs text-balance text-[var(--color-text-tooltip)] shadow-md"
			style={{ left: at.left, top: at.top }}
		>
			{label}
		</div>,
		document.body,
	);
}

function triggerTitle(state: DefaultFolderState, noun: string): string {
	if (state.kind === "unset") return `Set default folder for ${noun}`;
	if (state.kind === "missing") {
		return `Default folder for ${noun} is ${folderDisplayName(state.folder)}, which no longer exists — creating here instead`;
	}
	return `Default folder for ${noun}: ${state.folder}`;
}

function PanelHeading({ children }: { readonly children: ReactNode }) {
	return (
		<div className="px-1.5 pt-0.5 pb-1.5 text-[11px] font-semibold text-[var(--color-text-tertiary)]">
			{children}
		</div>
	);
}

function LabelMenu({
	noun,
	state,
	onChangeFolder,
	onCreateHereOnce,
	onRecreateFolder,
	onRemove,
}: {
	readonly noun: string;
	readonly state: DefaultFolderState;
	readonly onChangeFolder: () => void;
	readonly onCreateHereOnce: () => void;
	readonly onRecreateFolder: () => void;
	readonly onRemove: () => void;
}) {
	const folderName =
		state.kind === "unset" ? "" : folderDisplayName(state.folder);
	return (
		<>
			<PanelHeading>Default folder for {noun}</PanelHeading>
			{state.kind === "missing" ? (
				<DropdownMenuItem
					className="gap-2 py-1.5 text-xs"
					data-attr="default-folder-recreate"
					onSelect={(event) => {
						event.preventDefault();
						onRecreateFolder();
					}}
				>
					<RotateCcw aria-hidden="true" className="size-3.5 shrink-0" />
					<span className="min-w-0 flex-1 truncate">Recreate {folderName}</span>
				</DropdownMenuItem>
			) : null}
			<DropdownMenuItem
				className="gap-2 py-1.5 text-xs"
				data-attr="default-folder-change"
				onSelect={(event) => {
					event.preventDefault();
					onChangeFolder();
				}}
			>
				<Folder aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="min-w-0 flex-1 truncate">Change folder…</span>
			</DropdownMenuItem>
			{state.kind === "missing" ? null : (
				// The only item here that creates. It closes the whole menu, as
				// every other creation path does, and leaves the default alone.
				<DropdownMenuItem
					className="gap-2 py-1.5 text-xs"
					data-attr="default-folder-create-here"
					onSelect={onCreateHereOnce}
				>
					<FolderPlus aria-hidden="true" className="size-3.5 shrink-0" />
					<span className="min-w-0 flex-1 truncate">Create here this time</span>
				</DropdownMenuItem>
			)}
			<DropdownMenuSeparator className="my-1" />
			<DropdownMenuItem
				className="gap-2 py-1.5 text-xs text-[var(--color-text-status-danger)] focus:text-[var(--color-text-status-danger)] [&_svg:not([class*='text-'])]:text-[var(--color-text-status-danger)]"
				data-attr="default-folder-remove"
				onSelect={(event) => {
					event.preventDefault();
					onRemove();
				}}
			>
				<Trash2 aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="min-w-0 flex-1 truncate">Remove default</span>
			</DropdownMenuItem>
		</>
	);
}

function FolderPicker({
	noun,
	folders,
	selected,
	onHighlight,
	onPick,
	onNewFolder,
}: {
	readonly noun: string;
	readonly folders: readonly PickerFolder[];
	readonly selected: string | null;
	readonly onHighlight: (folder: string) => void;
	readonly onPick: (folder: string) => void;
	readonly onNewFolder: () => void;
}) {
	const [query, setQuery] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
	// Strictly on mount. The panel outlives its close by one exit animation, so
	// an effect that re-ran on every render would pull focus back out of the
	// menu on the way out and drop it on the body.
	const highlightRef = useRef(onHighlight);
	highlightRef.current = onHighlight;
	useEffect(() => {
		highlightRef.current("/");
		// Radix focuses the submenu's first item on open; the field is what the
		// picker is for, so it takes focus back on the next frame.
		const frame = requestAnimationFrame(() => searchRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);
	const visible = useMemo(
		() => filterPickerFolders(folders, query),
		[folders, query],
	);
	return (
		<>
			<PanelHeading>Default folder for {noun}</PanelHeading>
			<div className="relative px-0.5 pb-1.5">
				<Search
					aria-hidden="true"
					className="pointer-events-none absolute top-3.5 left-2.5 size-3 -translate-y-1/2 text-[var(--color-icon-tertiary)]"
				/>
				<input
					ref={searchRef}
					type="text"
					value={query}
					placeholder="Search folders"
					aria-label="Search folders"
					data-attr="default-folder-search"
					className="h-7 w-full rounded-control border border-[var(--color-border-subtle)] bg-[var(--color-bg-control)] pr-2 pl-7 text-xs text-[var(--color-text-primary)] outline-hidden placeholder:text-[var(--color-text-quaternary)] focus-visible:border-[var(--color-border-strong)]"
					onChange={(event) => setQuery(event.target.value)}
					onKeyDown={(event) => {
						// Radix runs typeahead on every character typed inside its
						// content and would steal focus out of the field.
						event.stopPropagation();
						if (event.key === "ArrowDown") {
							event.preventDefault();
							const content = event.currentTarget.closest<HTMLElement>(
								"[data-radix-menu-content]",
							);
							content?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
						}
						if (event.key === "Enter") {
							event.preventDefault();
							const first = visible[0];
							if (first) onPick(first.path);
						}
					}}
				/>
			</div>
			<div
				className="max-h-56 overflow-x-hidden overflow-y-auto"
				data-attr="default-folder-list"
			>
				{visible.length === 0 ? (
					<div className="px-2 py-3 text-center text-[11px] text-[var(--color-text-tertiary)]">
						No folder matches “{query.trim()}”.
					</div>
				) : (
					visible.map((folder) => (
						<DropdownMenuItem
							key={folder.path}
							className="gap-1.5 py-1 text-xs"
							data-attr="default-folder-option"
							data-folder-path={folder.path}
							title={folder.path}
							onFocus={() => onHighlight(folder.path)}
							style={{
								// Indentation stops mattering past a handful of levels and
								// would push a deep folder's own name out of the panel.
								paddingLeft: 6 + Math.min(folder.depth, 8) * 11,
							}}
							onKeyDown={(event) => {
								if (event.key !== "ArrowUp") return;
								const content = event.currentTarget.closest<HTMLElement>(
									"[data-radix-menu-content]",
								);
								const first = content?.querySelector<HTMLElement>(MENU_ITEM);
								if (first !== event.currentTarget) return;
								event.preventDefault();
								event.stopPropagation();
								content
									?.querySelector<HTMLInputElement>(
										"[data-attr='default-folder-search']",
									)
									?.focus();
							}}
							onSelect={(event) => {
								event.preventDefault();
								onPick(folder.path);
							}}
						>
							<img
								src={folderBlueIconUrl}
								alt=""
								aria-hidden="true"
								className={`size-3.5 shrink-0${folder.context ? " opacity-40" : ""}`}
							/>
							<span
								className={`min-w-0 flex-1 truncate${folder.context ? " text-[var(--color-text-tertiary)]" : ""}`}
							>
								{folder.name}
							</span>
							{selected === folder.path ? (
								<Check
									aria-hidden="true"
									className="size-3.5 shrink-0 text-[var(--color-icon-brand)]"
								/>
							) : null}
						</DropdownMenuItem>
					))
				)}
			</div>
			<DropdownMenuSeparator className="my-1" />
			<DropdownMenuItem
				className="gap-2 py-1.5 text-xs"
				data-attr="default-folder-new-folder"
				onSelect={(event) => {
					event.preventDefault();
					onNewFolder();
				}}
			>
				<Plus aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="min-w-0 flex-1 truncate">New folder…</span>
			</DropdownMenuItem>
		</>
	);
}

function NewFolderField({
	parentDirectory: parent,
	onCancel,
	onCreate,
}: {
	// `New folder…` creates inside the folder the picker was resting on, so a
	// nested folder can be made without leaving the picker, and at the
	// repository root when it was resting on nothing. The parent is named
	// above the field either way, because "where did that folder go" is the
	// only way this can go wrong.
	readonly parentDirectory: string;
	readonly onCancel: () => void;
	readonly onCreate: (parentDirectory: string, name: string) => void;
}) {
	const [name, setName] = useState("");
	const fieldRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		const frame = requestAnimationFrame(() => fieldRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);
	const trimmed = name.trim();
	return (
		<>
			<PanelHeading>
				New folder in{" "}
				{parent === "/" ? "the repository root" : folderDisplayName(parent)}
			</PanelHeading>
			<div className="px-0.5 pb-1">
				<input
					ref={fieldRef}
					type="text"
					value={name}
					placeholder="Folder name"
					aria-label={`New folder in ${parent}`}
					data-attr="default-folder-new-folder-name"
					className="h-7 w-full rounded-control border border-[var(--color-border-subtle)] bg-[var(--color-bg-control)] px-2 text-xs text-[var(--color-text-primary)] outline-hidden placeholder:text-[var(--color-text-quaternary)] focus-visible:border-[var(--color-border-strong)]"
					onChange={(event) => setName(event.target.value)}
					onKeyDown={(event) => {
						event.stopPropagation();
						if (event.key === "Enter") {
							event.preventDefault();
							if (trimmed.length > 0) onCreate(parent, trimmed);
						}
						if (event.key === "Escape") {
							event.preventDefault();
							onCancel();
						}
					}}
				/>
			</div>
			<div className="px-1.5 pb-1 text-[11px] text-[var(--color-text-tertiary)]">
				Enter creates it and sets it as the default. Escape goes back.
			</div>
		</>
	);
}
