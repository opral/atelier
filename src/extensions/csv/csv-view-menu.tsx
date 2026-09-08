import { useId, useLayoutEffect, useRef, useState } from "react";
import {
	Check,
	ChevronDown,
	Pencil,
	Plus,
	RotateCcw,
	Table2,
	Trash2,
	X,
} from "lucide-react";
import { CsvDismissiblePopover } from "./csv-dismissible-popover";
import type { CsvSavedView } from "./csv-views";

export function CsvViewMenu({
	views,
	activeId,
	dirty,
	onSelect,
	onSave,
	onRename,
	onDelete,
}: {
	views: readonly CsvSavedView[];
	activeId: string | null;
	dirty: boolean;
	onSelect: (id: string | null) => void;
	onSave?: (id: string, name: string) => void;
	onRename?: (id: string, name: string) => void;
	onDelete?: (id: string) => void;
}) {
	const nameInputId = useId();
	const nameInput = useRef<HTMLInputElement>(null);
	const cancelDelete = useRef<HTMLButtonElement>(null);
	const newViewAction = useRef<HTMLButtonElement>(null);
	const renameViewAction = useRef<HTMLButtonElement>(null);
	const deleteViewAction = useRef<HTMLButtonElement>(null);
	const previousMode = useRef("list");
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<"list" | "create" | "rename" | "delete">(
		"list",
	);
	const [name, setName] = useState("");
	useLayoutEffect(() => {
		if (mode === "list") {
			if (previousMode.current === "create") newViewAction.current?.focus();
			if (previousMode.current === "rename") renameViewAction.current?.focus();
			if (previousMode.current === "delete") deleteViewAction.current?.focus();
		}
		previousMode.current = mode;
		if (mode === "create" || mode === "rename") nameInput.current?.focus();
		if (mode === "delete") cancelDelete.current?.focus();
	}, [mode]);
	const trigger = useRef<HTMLButtonElement>(null);
	const active = views.find((view) => view.id === activeId);
	const duplicate =
		name.trim().toLowerCase() === "default view" ||
		views.some(
			(view) =>
				view.name.toLowerCase() === name.trim().toLowerCase() &&
				(mode !== "rename" || view.id !== activeId),
		);
	const close = () => {
		setOpen(false);
		trigger.current?.focus();
	};
	const submit = () => {
		if (!name.trim() || duplicate) return;
		if (mode === "rename" && active) onRename?.(active.id, name.trim());
		else onSave?.(crypto.randomUUID(), name.trim());
		close();
	};
	return (
		<div
			className="csv-view-switcher"
			onKeyDown={(event) => {
				// Escape backs out of a form the way its Cancel button does; the
				// popover itself closes on the next Escape.
				if (event.key !== "Escape" || mode === "list") return;
				event.preventDefault();
				setMode("list");
			}}
		>
			<button
				type="button"
				ref={trigger}
				aria-label="Views"
				aria-haspopup="dialog"
				aria-expanded={open}
				title={active?.name ?? "Default view"}
				onClick={() => {
					setMode("list");
					setOpen(!open);
				}}
			>
				<Table2 size={14} aria-hidden="true" />
				<span className="csv-view-name">{active?.name ?? "Default view"}</span>
				<ChevronDown size={12} aria-hidden="true" />
			</button>
			{active && dirty && (
				<>
					<span
						className="csv-view-dirty"
						title="Unsaved view changes"
						aria-label="Unsaved view changes"
					/>
					{onSave && (
						<button
							type="button"
							className="csv-save-view"
							onClick={() => onSave(active.id, active.name)}
						>
							Save changes
						</button>
					)}
				</>
			)}
			{open && (
				<CsvDismissiblePopover
					label="Views"
					trigger={trigger}
					onDismiss={() => setOpen(false)}
					className="csv-views-popover"
				>
					<div className="csv-toolbar-popover-title">
						<span>
							{mode === "create"
								? "Save current view"
								: mode === "rename"
									? "Rename view"
									: mode === "delete"
										? "Delete view"
										: "Views"}
						</span>
						<button type="button" aria-label="Close views" onClick={close}>
							<X size={13} />
						</button>
					</div>
					{mode === "list" ? (
						<>
							<div
								className="csv-view-list"
								role="group"
								aria-label="Saved views"
							>
								{[{ id: null, name: "Default view" }, ...views].map((view) => (
									<button
										type="button"
										key={view.id ?? "default"}
										aria-pressed={activeId === view.id}
										onClick={() => {
											onSelect(view.id);
											close();
										}}
									>
										<Table2 size={14} aria-hidden="true" />
										<span>{view.name}</span>
										{activeId === view.id && (
											<Check size={13} aria-hidden="true" />
										)}
									</button>
								))}
							</div>
							{onSave && (
								<div className="csv-view-menu-actions">
									<button
										type="button"
										ref={newViewAction}
										onClick={() => {
											setName("");
											setMode("create");
										}}
									>
										<Plus size={14} />
										Save as new view
									</button>
									{active && (
										<>
											<button
												type="button"
												ref={renameViewAction}
												onClick={() => {
													setName(active.name);
													setMode("rename");
												}}
											>
												<Pencil size={14} />
												Rename view
											</button>
											{dirty && (
												<button
													type="button"
													onClick={() => {
														onSelect(active.id);
														close();
													}}
												>
													<RotateCcw size={14} />
													Reset changes
												</button>
											)}
											<button
												type="button"
												className="csv-view-delete"
												ref={deleteViewAction}
												onClick={() => setMode("delete")}
											>
												<Trash2 size={14} />
												Delete view
											</button>
										</>
									)}
								</div>
							)}
						</>
					) : mode === "delete" ? (
						<>
							<p className="csv-view-help">
								Delete “{active?.name}”? Your CSV rows stay unchanged.
							</p>
							<div className="csv-view-form-actions">
								<button
									type="button"
									ref={cancelDelete}
									onClick={() => setMode("list")}
								>
									Cancel
								</button>
								<button
									type="button"
									className="csv-view-delete"
									onClick={() => {
										if (active) onDelete?.(active.id);
										close();
									}}
								>
									Delete view
								</button>
							</div>
						</>
					) : (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								submit();
							}}
						>
							<label htmlFor={nameInputId}>View name</label>
							<input
								id={nameInputId}
								aria-label="View name"
								ref={nameInput}
								maxLength={80}
								value={name}
								placeholder="e.g. Needs follow-up"
								aria-invalid={duplicate || undefined}
								onChange={(event) => setName(event.target.value)}
							/>
							{duplicate ? (
								<p className="csv-view-error" role="alert">
									A view with this name already exists.
								</p>
							) : (
								mode === "create" && (
									<p className="csv-view-help">
										Saves filters, sorting, search, and column layout.
									</p>
								)
							)}
							<div className="csv-view-form-actions">
								<button type="button" onClick={() => setMode("list")}>
									Cancel
								</button>
								<button
									type="submit"
									className="csv-save-view"
									disabled={!name.trim() || duplicate}
								>
									{mode === "rename" ? "Rename" : "Save view"}
								</button>
							</div>
						</form>
					)}
				</CsvDismissiblePopover>
			)}
		</div>
	);
}
