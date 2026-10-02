import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronRight, FolderOpen, House, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import folderBlueIconUrl from "../files/assets/folder-blue.svg";

/**
 * The element focused last outside a menu. A dialog opened from a menu item
 * returns focus there when it closes: the item it was opened from is gone.
 */
let focusBeforeMenu: HTMLElement | null = null;
let trackingFocus = false;
function trackFocusBeforeMenu() {
	if (trackingFocus || typeof document === "undefined") return;
	trackingFocus = true;
	document.addEventListener("focusin", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (target.closest('[role="menu"], [role="dialog"]')) return;
		focusBeforeMenu = target;
	});
}

function LibraryDialog({
	open,
	busy,
	title,
	description,
	onClose,
	initialFocus,
	children,
}: {
	readonly open: boolean;
	readonly busy: boolean;
	readonly title: string;
	readonly description: string;
	readonly onClose: () => void;
	readonly initialFocus?: React.RefObject<HTMLElement | null>;
	readonly children: ReactNode;
}) {
	trackFocusBeforeMenu();
	const returnTo = useRef<HTMLElement | null>(null);
	const wasOpen = useRef(false);
	useEffect(() => {
		if (open) {
			const active = document.activeElement;
			returnTo.current =
				active instanceof HTMLElement && !active.closest('[role="menu"]')
					? active
					: focusBeforeMenu;
			wasOpen.current = true;
			return;
		}
		if (!wasOpen.current) return;
		wasOpen.current = false;
		// After the close animation, only if nothing else has taken focus.
		const timer = setTimeout(() => {
			const target = returnTo.current;
			returnTo.current = null;
			if (
				target?.isConnected &&
				(document.activeElement === document.body ||
					document.activeElement === null)
			)
				target.focus({ preventScroll: true });
		}, 200);
		return () => clearTimeout(timer);
	}, [open]);
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop className="atelier-portal atw:fixed atw:inset-0 atw:z-50 atw:bg-[color-mix(in_srgb,var(--atelier-fg)_38%,transparent)] atw:transition-opacity atw:duration-150 atw:data-[ending-style]:opacity-0 atw:data-[starting-style]:opacity-0" />
				<Dialog.Popup
					{...(initialFocus ? { initialFocus } : {})}
					className="atelier-portal atw:fixed atw:top-1/2 atw:left-1/2 atw:z-50 atw:flex atw:w-[min(480px,calc(100vw-2rem))] atw:-translate-x-1/2 atw:-translate-y-1/2 atw:flex-col atw:overflow-hidden atw:rounded-xl atw:border atw:border-border atw:bg-panel atw:font-sans atw:text-fg atw:shadow-overlay atw:outline-none atw:transition-[opacity,scale] atw:duration-150 atw:data-[ending-style]:scale-95 atw:data-[ending-style]:opacity-0 atw:data-[starting-style]:scale-95 atw:data-[starting-style]:opacity-0"
				>
					<div className="atw:flex atw:flex-col atw:gap-1.5 atw:px-6 atw:pt-6 atw:pb-5">
						<Dialog.Title className="atw:text-[15px] atw:font-semibold atw:text-fg">
							{title}
						</Dialog.Title>
						<Dialog.Description className="atw:text-[13px] atw:leading-relaxed atw:text-fg-subtle">
							{description}
						</Dialog.Description>
					</div>
					{children}
					{busy ? null : (
						<Dialog.Close
							aria-label="Close"
							className="atw:absolute atw:top-4 atw:right-4 atw:grid atw:size-7 atw:place-items-center atw:rounded-md atw:text-fg-subtle atw:hover:bg-bg-hover atw:hover:text-fg atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:outline-none"
						>
							<X className="atw:size-4" aria-hidden="true" />
						</Dialog.Close>
					)}
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function DialogFooter({ children }: { readonly children: ReactNode }) {
	return (
		<div className="atw:flex atw:justify-end atw:gap-2 atw:border-t atw:border-border atw:px-6 atw:py-4">
			{children}
		</div>
	);
}

const SECONDARY_BUTTON =
	"atw:border atw:border-border-strong atw:bg-panel atw:text-fg-muted atw:hover:bg-bg-hover atw:hover:text-fg";

/** Names a new folder, or renames an item. Enter saves, Escape cancels. */
export function NameDialog({
	open,
	title,
	submitLabel,
	initialName,
	busy,
	error,
	onClose,
	onSubmit,
}: {
	readonly open: boolean;
	readonly title: string;
	readonly submitLabel: string;
	readonly initialName: string;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onClose: () => void;
	readonly onSubmit: (name: string) => void;
}) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState(initialName);
	const [emptyError, setEmptyError] = useState(false);
	// An error answers the name that was submitted; editing the name dismisses
	// it until the next attempt.
	const [errorDismissed, setErrorDismissed] = useState(false);
	useEffect(() => setErrorDismissed(false), [error]);
	const shownError = errorDismissed ? null : error;
	useEffect(() => {
		if (!open) return;
		setValue(initialName);
		setEmptyError(false);
		// Select the stem, as Finder does: the extension is rarely the edit.
		requestAnimationFrame(() => {
			const input = inputRef.current;
			if (!input) return;
			input.focus();
			const dot = initialName.lastIndexOf(".");
			input.setSelectionRange(0, dot > 0 ? dot : initialName.length);
		});
	}, [initialName, open]);
	return (
		<LibraryDialog
			open={open}
			busy={busy}
			title={title}
			description="Choose a name. Press Enter to save or Escape to cancel."
			onClose={onClose}
			initialFocus={inputRef}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					const name = value.trim();
					// An empty name says why nothing happened.
					setEmptyError(name.length === 0);
					if (name && !busy) onSubmit(name);
				}}
			>
				<label className="atw:flex atw:flex-col atw:gap-2 atw:px-6 atw:pb-5 atw:text-[13px] atw:font-medium atw:text-fg-muted">
					Name
					<input
						ref={inputRef}
						value={value}
						onChange={(event) => {
							setValue(event.target.value);
							setEmptyError(false);
							setErrorDismissed(true);
						}}
						aria-label="Name"
						disabled={busy}
						maxLength={255}
						aria-invalid={shownError || emptyError ? true : undefined}
						className="atw:h-10 atw:w-full atw:rounded-lg atw:border atw:border-border atw:bg-panel atw:px-3 atw:text-[14px] atw:font-normal atw:text-fg atw:outline-none atw:focus:ring-2 atw:focus:ring-ring"
					/>
					{shownError || emptyError ? (
						<span
							role="alert"
							className="atw:text-[13px] atw:font-normal atw:text-danger"
						>
							{emptyError ? "Enter a name." : shownError}
						</span>
					) : null}
				</label>
				<DialogFooter>
					<Button
						type="button"
						className={SECONDARY_BUTTON}
						disabled={busy}
						onClick={onClose}
					>
						Cancel
					</Button>
					<Button type="submit" disabled={busy}>
						{busy ? "Saving…" : submitLabel}
					</Button>
				</DialogFooter>
			</form>
		</LibraryDialog>
	);
}

export function DeleteDialog({
	open,
	count: openCount,
	name: openName,
	hasFolders: openHasFolders,
	busy,
	error,
	onClose,
	onConfirm,
}: {
	readonly open: boolean;
	readonly count: number;
	/** The one item's name, when there is one: the dialog says what it deletes. */
	readonly name?: string;
	readonly hasFolders: boolean;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
}) {
	const confirmRef = useRef<HTMLButtonElement>(null);
	// The dialog fades out after its item is cleared: keep saying what it
	// was about until it is gone.
	const shown = useRef({
		count: openCount,
		name: openName,
		hasFolders: openHasFolders,
	});
	if (open)
		shown.current = {
			count: openCount,
			name: openName,
			hasFolders: openHasFolders,
		};
	const { count, name, hasFolders } = shown.current;
	return (
		<LibraryDialog
			open={open}
			busy={busy}
			title={
				count === 1 && name
					? `Delete “${name}”?`
					: `Delete ${count} ${count === 1 ? "item" : "items"}?`
			}
			description={
				hasFolders
					? count === 1
						? "The folder and everything inside it will be deleted. Its history remains available."
						: "Folders and everything inside them will be deleted. Their history remains available."
					: "History keeps every version, so this can be restored."
			}
			onClose={onClose}
			initialFocus={confirmRef}
		>
			{error ? (
				<p
					role="alert"
					className="atw:px-6 atw:pb-4 atw:text-[13px] atw:text-danger"
				>
					{error}
				</p>
			) : null}
			<DialogFooter>
				<Button
					type="button"
					className={SECONDARY_BUTTON}
					disabled={busy}
					onClick={onClose}
				>
					Cancel
				</Button>
				<Button
					ref={confirmRef}
					type="button"
					variant="destructive"
					disabled={busy}
					onClick={onConfirm}
				>
					{busy ? "Deleting…" : "Delete"}
				</Button>
			</DialogFooter>
		</LibraryDialog>
	);
}

/** Browse to a folder one level at a time, then move there. */
export function MoveDialog({
	open,
	count: openCount,
	destinations: openDestinations,
	currentDirectory: openCurrentDirectory,
	busy,
	error,
	onClose,
	onMove,
}: {
	readonly open: boolean;
	readonly count: number;
	readonly destinations: readonly string[];
	readonly currentDirectory: string;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onClose: () => void;
	readonly onMove: (destination: string) => void;
}) {
	// As DeleteDialog: hold the content while the dialog fades out.
	const shown = useRef({
		count: openCount,
		destinations: openDestinations,
		currentDirectory: openCurrentDirectory,
	});
	if (open)
		shown.current = {
			count: openCount,
			destinations: openDestinations,
			currentDirectory: openCurrentDirectory,
		};
	const { count, destinations, currentDirectory } = shown.current;
	const [destination, setDestination] = useState(currentDirectory);
	const crumbsRef = useRef<HTMLElement>(null);
	const currentCrumbRef = useRef<HTMLButtonElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const cameFrom = useRef<string | null>(null);
	useEffect(() => {
		if (!open) return;
		setDestination(currentDirectory);
		cameFrom.current = null;
	}, [currentDirectory, open]);
	const segments = destination.split("/").filter(Boolean);
	// The folder being chosen is the last crumb, and the folder just left
	// (going up) is in the list: keep both in view.
	useEffect(() => {
		if (!open) return;
		const nav = crumbsRef.current;
		if (nav) nav.scrollLeft = nav.scrollWidth;
		// Entering a folder from the list removes the row that had focus:
		// the folder now being chosen takes it.
		if (document.activeElement === document.body)
			firstFocusable()?.focus({ preventScroll: true });
		const frame = requestAnimationFrame(() => {
			const from = cameFrom.current;
			const row = from
				? listRef.current?.querySelector<HTMLElement>(
						`[data-path="${CSS.escape(from)}"]`,
					)
				: null;
			row?.scrollIntoView({ block: "nearest" });
		});
		return () => cancelAnimationFrame(frame);
	}, [destination, open]);
	// Keyboard users walk down the list: it takes focus (its first folder),
	// or the folder being chosen when there is none below.
	const firstRowRef = useRef<HTMLButtonElement>(null);
	const firstFocusable = () => firstRowRef.current ?? currentCrumbRef.current;
	// Read when the popup opens, after its rows have mounted.
	const initialFocusRef = useMemo<React.RefObject<HTMLElement | null>>(
		() => ({
			get current() {
				return firstRowRef.current ?? currentCrumbRef.current;
			},
		}),
		[],
	);
	const choose = (next: string) => {
		cameFrom.current = destination;
		setDestination(next);
	};
	const crumbs = [
		{ path: "/", name: "Home" },
		...segments.map((name, index) => ({
			path: `/${segments.slice(0, index + 1).join("/")}`,
			name,
		})),
	];
	const folders = destinations
		.filter(
			(path) =>
				path !== "/" &&
				(path.slice(0, path.lastIndexOf("/")) || "/") === destination,
		)
		.map((path) => ({ path, name: path.split("/").at(-1)! }));
	const canMove =
		destination !== currentDirectory && destinations.includes(destination);
	return (
		<LibraryDialog
			open={open}
			busy={busy}
			title={`Move ${count} ${count === 1 ? "item" : "items"}`}
			// The list, or the folder being chosen — never "Home": on a deep
			// path Home is scrolled out of view, its focus ring clipped.
			initialFocus={initialFocusRef}
			description="Choose where these items should live."
			onClose={onClose}
		>
			<div className="atw:px-6 atw:pb-5">
				<nav
					ref={(nav) => {
						crumbsRef.current = nav;
						// On open the popup mounts after the effect: scroll on attach.
						if (nav) nav.scrollLeft = nav.scrollWidth;
					}}
					aria-label="Destination location"
					className="atw:mb-2 atw:flex atw:min-h-9 atw:items-center atw:gap-1 atw:overflow-x-auto atw:px-0.5 atw:text-[13px] atw:[scrollbar-width:none]"
				>
					{crumbs.map((crumb, index) => (
						<span
							key={crumb.path}
							className="atw:flex atw:shrink-0 atw:items-center atw:gap-1"
						>
							{index > 0 ? (
								<ChevronRight
									aria-hidden="true"
									className="atw:size-3.5 atw:text-fg-subtle"
								/>
							) : null}
							<button
								type="button"
								disabled={busy}
								ref={crumb.path === destination ? currentCrumbRef : undefined}
								aria-current={
									crumb.path === destination ? "location" : undefined
								}
								onClick={() => choose(crumb.path)}
								className="atw:flex atw:max-w-56 atw:items-center atw:gap-2 atw:rounded-md atw:px-2 atw:py-1.5 atw:text-fg-muted atw:outline-none atw:hover:bg-bg-hover atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:aria-[current=location]:font-medium atw:aria-[current=location]:text-fg atw:disabled:opacity-50"
							>
								{index === 0 ? (
									<House aria-hidden="true" className="atw:size-3.5" />
								) : null}
								<span className="atw:truncate">{crumb.name}</span>
							</button>
						</span>
					))}
				</nav>
				<ul
					ref={listRef}
					aria-label="Destination folders"
					// Five and a half rows: the half row says the list scrolls.
					className="atw:h-[233px] atw:overflow-y-auto atw:rounded-lg atw:border atw:border-border atw:p-1"
				>
					{folders.length === 0 ? (
						<li className="atw:flex atw:h-full atw:flex-col atw:items-center atw:justify-center atw:gap-2 atw:px-6 atw:text-center">
							<FolderOpen
								aria-hidden="true"
								className="atw:mb-1 atw:size-7 atw:text-fg-subtle"
								strokeWidth={1.5}
							/>
							<p className="atw:text-[13px] atw:font-medium atw:text-fg-muted">
								No folders inside
							</p>
							<p className="atw:max-w-72 atw:text-xs atw:leading-relaxed atw:text-fg-subtle">
								{destination !== currentDirectory
									? "You can move your items here."
									: "Use the breadcrumb above to choose another folder."}
							</p>
						</li>
					) : (
						folders.map((folder, index) => (
							<li key={folder.path} data-path={folder.path}>
								<button
									ref={index === 0 ? firstRowRef : undefined}
									type="button"
									disabled={busy}
									onClick={() => choose(folder.path)}
									className="atw:flex atw:min-h-10 atw:w-full atw:cursor-pointer atw:items-center atw:gap-3 atw:rounded-md atw:px-3 atw:py-2 atw:text-left atw:text-[13px] atw:outline-none atw:hover:bg-bg-hover atw:focus-visible:ring-2 atw:focus-visible:ring-inset atw:focus-visible:ring-ring atw:disabled:opacity-50"
								>
									<img
										src={folderBlueIconUrl}
										alt=""
										className="atw:size-4 atw:shrink-0"
									/>
									<span className="atw:min-w-0 atw:flex-1 atw:truncate">
										{folder.name}
									</span>
									<ChevronRight
										aria-hidden="true"
										className="atw:size-4 atw:shrink-0 atw:text-fg-subtle"
									/>
								</button>
							</li>
						))
					)}
				</ul>
				<p
					aria-live="polite"
					className="atw:mt-3 atw:text-xs atw:text-fg-subtle"
				>
					{destination === currentDirectory
						? "These items are already in this folder."
						: `Move to ${segments.at(-1) ?? "Home"}`}
				</p>
				{error ? (
					<p role="alert" className="atw:mt-2 atw:text-[13px] atw:text-danger">
						{error}
					</p>
				) : null}
			</div>
			<DialogFooter>
				<Button
					type="button"
					className={SECONDARY_BUTTON}
					disabled={busy}
					onClick={onClose}
				>
					Cancel
				</Button>
				<Button
					type="button"
					disabled={busy || !canMove}
					onClick={() => onMove(destination)}
				>
					{busy ? "Moving…" : "Move here"}
				</Button>
			</DialogFooter>
		</LibraryDialog>
	);
}

export type LibraryToast = {
	readonly id: number;
	readonly message: string;
	readonly tone?: "danger";
	readonly undo?: () => Promise<void>;
};

/** One line at the foot of the Library: what just happened, and Undo. */
export function ToastLine({
	toast,
	onDismiss,
	placement = "container",
	raised = false,
}: {
	readonly toast: LibraryToast | null;
	readonly onDismiss: () => void;
	/**
	 * "viewport" floats at the foot of the window, over everything: for a
	 * narrow surface (the sidebar) that cannot hold a readable toast.
	 */
	readonly placement?: "container" | "viewport";
	/** Clears the review float, which sits at the same foot. */
	readonly raised?: boolean;
}) {
	const [undoing, setUndoing] = useState(false);
	useEffect(() => {
		if (!toast) return;
		setUndoing(false);
		const timer = setTimeout(onDismiss, toast.undo ? 8000 : 5000);
		return () => clearTimeout(timer);
	}, [onDismiss, toast]);
	if (!toast) return null;
	const line = (
		<div
			className={
				placement === "viewport"
					? `atelier-portal atw:pointer-events-none atw:fixed atw:inset-x-0 atw:z-50 atw:flex atw:justify-center atw:px-4 atw:font-sans ${raised ? "atw:bottom-28" : "atw:bottom-12"}`
					: `atw:pointer-events-none atw:absolute atw:inset-x-0 atw:z-30 atw:flex atw:justify-center atw:px-4 ${raised ? "atw:bottom-20" : "atw:bottom-5"}`
			}
		>
			<div
				role="status"
				data-testid="library-toast"
				className={`atw:pointer-events-auto atw:flex atw:max-w-full atw:items-center atw:gap-3 atw:rounded-[10px] atw:bg-overlay atw:py-2 atw:pr-2 atw:pl-3.5 atw:text-[13px] atw:text-overlay-fg atw:shadow-overlay ${
					toast.tone === "danger" ? "atw:ring-1 atw:ring-danger" : ""
				}`}
			>
				<span className="atw:min-w-0 atw:text-pretty">{toast.message}</span>
				{toast.undo ? (
					<button
						type="button"
						disabled={undoing}
						className="atw:rounded-md atw:px-2 atw:py-1 atw:font-semibold atw:text-overlay-accent atw:hover:bg-overlay-hover atw:disabled:opacity-60"
						onClick={() => {
							const undo = toast.undo;
							if (!undo) return;
							setUndoing(true);
							void undo()
								.catch((error: unknown) => {
									console.error("library: undo failed", error);
								})
								.finally(onDismiss);
						}}
					>
						{undoing ? "Undoing…" : "Undo"}
					</button>
				) : null}
				<button
					type="button"
					aria-label="Dismiss"
					className="atw:grid atw:size-6 atw:place-items-center atw:rounded-md atw:text-overlay-fg-subtle atw:hover:bg-overlay-hover atw:hover:text-overlay-fg"
					onClick={onDismiss}
				>
					<X className="atw:size-3.5" aria-hidden="true" />
				</button>
			</div>
		</div>
	);
	return placement === "viewport" && typeof document !== "undefined"
		? createPortal(line, document.body)
		: line;
}
