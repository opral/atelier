import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronRight, FolderOpen, House, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import folderBlueIconUrl from "../files/assets/folder-blue.svg";

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
	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				if (!next && !busy) onClose();
			}}
		>
			<Dialog.Portal>
				<Dialog.Backdrop className="atelier-portal fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--atelier-fg)_38%,transparent)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
				<Dialog.Popup
					{...(initialFocus ? { initialFocus } : {})}
					className="atelier-portal fixed top-1/2 left-1/2 z-50 flex w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-panel font-sans text-fg shadow-overlay outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
				>
					<div className="flex flex-col gap-1.5 px-6 pt-6 pb-5">
						<Dialog.Title className="text-[15px] font-semibold text-fg">
							{title}
						</Dialog.Title>
						<Dialog.Description className="text-[13px] leading-relaxed text-fg-subtle">
							{description}
						</Dialog.Description>
					</div>
					{children}
					{busy ? null : (
						<Dialog.Close
							aria-label="Close"
							className="absolute top-4 right-4 grid size-7 place-items-center rounded-md text-fg-subtle hover:bg-bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						>
							<X className="size-4" aria-hidden="true" />
						</Dialog.Close>
					)}
				</Dialog.Popup>
			</Dialog.Portal>
		</Dialog.Root>
	);
}

function DialogFooter({ children }: { readonly children: ReactNode }) {
	return (
		<div className="flex justify-end gap-2 border-t border-border px-6 py-4">
			{children}
		</div>
	);
}

const SECONDARY_BUTTON =
	"border border-border-strong bg-panel text-fg-muted hover:bg-bg-hover hover:text-fg";

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
	useEffect(() => {
		if (!open) return;
		setValue(initialName);
		setEmptyError(false);
		// Select the stem, as Finder does: the extension is rarely the edit.
		requestAnimationFrame(() => {
			const input = inputRef.current;
			if (!input) return;
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
				<label className="flex flex-col gap-2 px-6 pb-5 text-[13px] font-medium text-fg-muted">
					Name
					<input
						ref={inputRef}
						value={value}
						onChange={(event) => {
							setValue(event.target.value);
							setEmptyError(false);
						}}
						aria-label="Name"
						disabled={busy}
						maxLength={255}
						aria-invalid={error ? true : undefined}
						className="h-10 w-full rounded-lg border border-border bg-panel px-3 text-[14px] font-normal text-fg outline-none focus:ring-2 focus:ring-ring"
					/>
					{error || emptyError ? (
						<span role="alert" className="text-[13px] font-normal text-danger">
							{emptyError ? "Enter a name." : error}
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
	count,
	hasFolders,
	busy,
	error,
	onClose,
	onConfirm,
}: {
	readonly open: boolean;
	readonly count: number;
	readonly hasFolders: boolean;
	readonly busy: boolean;
	readonly error: string | null;
	readonly onClose: () => void;
	readonly onConfirm: () => void;
}) {
	const confirmRef = useRef<HTMLButtonElement>(null);
	return (
		<LibraryDialog
			open={open}
			busy={busy}
			title={`Delete ${count} ${count === 1 ? "item" : "items"}`}
			description={
				hasFolders
					? "Folders and everything inside them will be deleted. Their history remains available."
					: "History keeps every version, so this can be restored."
			}
			onClose={onClose}
			initialFocus={confirmRef}
		>
			{error ? (
				<p role="alert" className="px-6 pb-4 text-[13px] text-danger">
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
	count,
	destinations,
	currentDirectory,
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
	const [destination, setDestination] = useState(currentDirectory);
	useEffect(() => {
		if (open) setDestination(currentDirectory);
	}, [currentDirectory, open]);
	const segments = destination.split("/").filter(Boolean);
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
			description="Choose where these items should live."
			onClose={onClose}
		>
			<div className="px-6 pb-5">
				<nav
					aria-label="Destination location"
					className="mb-2 flex min-h-9 items-center gap-1 overflow-x-auto text-[13px]"
				>
					{crumbs.map((crumb, index) => (
						<span key={crumb.path} className="flex shrink-0 items-center gap-1">
							{index > 0 ? (
								<ChevronRight
									aria-hidden="true"
									className="size-3.5 text-fg-subtle"
								/>
							) : null}
							<button
								type="button"
								disabled={busy}
								aria-current={
									crumb.path === destination ? "location" : undefined
								}
								onClick={() => setDestination(crumb.path)}
								className="flex max-w-56 items-center gap-2 rounded-md px-2 py-1.5 text-fg-muted outline-none hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-[current=location]:font-medium aria-[current=location]:text-fg disabled:opacity-50"
							>
								{index === 0 ? (
									<House aria-hidden="true" className="size-3.5" />
								) : null}
								<span className="truncate">{crumb.name}</span>
							</button>
						</span>
					))}
				</nav>
				<ul
					aria-label="Destination folders"
					className="h-52 overflow-y-auto rounded-lg border border-border p-1"
				>
					{folders.length === 0 ? (
						<li className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
							<FolderOpen
								aria-hidden="true"
								className="mb-1 size-7 text-fg-subtle"
								strokeWidth={1.5}
							/>
							<p className="text-[13px] font-medium text-fg-muted">
								No folders inside
							</p>
							<p className="max-w-72 text-xs leading-relaxed text-fg-subtle">
								{destination !== currentDirectory
									? "You can move your items here."
									: "Use the breadcrumb above to choose another folder."}
							</p>
						</li>
					) : (
						folders.map((folder) => (
							<li key={folder.path}>
								<button
									type="button"
									disabled={busy}
									onClick={() => setDestination(folder.path)}
									className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left text-[13px] outline-none hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
								>
									<img
										src={folderBlueIconUrl}
										alt=""
										className="size-4 shrink-0"
									/>
									<span className="min-w-0 flex-1 truncate">{folder.name}</span>
									<ChevronRight
										aria-hidden="true"
										className="size-4 shrink-0 text-fg-subtle"
									/>
								</button>
							</li>
						))
					)}
				</ul>
				<p aria-live="polite" className="mt-3 text-xs text-fg-subtle">
					{destination === currentDirectory
						? "These items are already in this folder."
						: `Move to ${segments.at(-1) ?? "Home"}`}
				</p>
				{error ? (
					<p role="alert" className="mt-2 text-[13px] text-danger">
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
}: {
	readonly toast: LibraryToast | null;
	readonly onDismiss: () => void;
}) {
	const [undoing, setUndoing] = useState(false);
	useEffect(() => {
		if (!toast) return;
		setUndoing(false);
		const timer = setTimeout(onDismiss, toast.undo ? 8000 : 5000);
		return () => clearTimeout(timer);
	}, [onDismiss, toast]);
	if (!toast) return null;
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center px-4">
			<div
				role="status"
				data-testid="library-toast"
				className={`pointer-events-auto flex max-w-full items-center gap-3 rounded-[10px] bg-overlay py-2 pr-2 pl-3.5 text-[13px] text-overlay-fg shadow-overlay ${
					toast.tone === "danger" ? "ring-1 ring-danger" : ""
				}`}
			>
				<span className="min-w-0 truncate">{toast.message}</span>
				{toast.undo ? (
					<button
						type="button"
						disabled={undoing}
						className="rounded-md px-2 py-1 font-semibold text-overlay-accent hover:bg-overlay-hover disabled:opacity-60"
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
					className="grid size-6 place-items-center rounded-md text-overlay-fg-subtle hover:bg-overlay-hover hover:text-overlay-fg"
					onClick={onDismiss}
				>
					<X className="size-3.5" aria-hidden="true" />
				</button>
			</div>
		</div>
	);
}
