import { useEffect, useRef, useState, type ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import type { CsvOptionEdit } from "./csv-option-edit";

export function CsvOptionDetails({
	value,
	options,
	used,
	existingValues,
	onEdit,
	children,
}: {
	value: string;
	options: readonly string[];
	used: number;
	existingValues: readonly string[];
	onEdit: (edit: CsvOptionEdit) => void;
	children: ReactNode;
}) {
	const [name, setName] = useState(value);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const cancelRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (confirmDelete) cancelRef.current?.focus();
	}, [confirmDelete]);
	const trimmed = name.trim();
	const duplicate =
		trimmed !== value && [...options, ...existingValues].includes(trimmed);
	const index = options.indexOf(value);
	return (
		<>
			<form
				className="csv-option-name-form"
				onSubmit={(event) => {
					event.preventDefault();
					if (trimmed && !duplicate && trimmed !== value)
						onEdit({ kind: "rename", value, name: trimmed });
				}}
			>
				<input
					aria-label="Option name"
					value={name}
					aria-invalid={duplicate || undefined}
					onChange={(event) => setName(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Escape") event.stopPropagation();
					}}
				/>
				<button
					type="submit"
					onKeyDown={(event) => {
						if (event.key === "Tab") event.stopPropagation();
					}}
					disabled={!trimmed || duplicate || trimmed === value}
				>
					Save
				</button>
				{duplicate && (
					<span role="alert">An option or cell already uses this name.</span>
				)}
			</form>
			{children}
			<Menu.Separator className="csv-column-separator" />
			<Menu.Item
				className="csv-column-action"
				disabled={index <= 0}
				onSelect={(event) => {
					event.preventDefault();
					onEdit({ kind: "move", value, before: options[index - 1]! });
				}}
			>
				<ArrowUp />
				Move up
			</Menu.Item>
			<Menu.Item
				className="csv-column-action"
				disabled={index >= options.length - 1}
				onSelect={(event) => {
					event.preventDefault();
					onEdit({ kind: "move", value, before: options[index + 2] ?? null });
				}}
			>
				<ArrowDown />
				Move down
			</Menu.Item>
			<Menu.Separator className="csv-column-separator" />
			{confirmDelete ? (
				<div className="csv-option-delete-confirm">
					<p>
						Clear this value from {used} {used === 1 ? "row" : "rows"} and
						delete the option?
					</p>
					<div>
						<button
							ref={cancelRef}
							type="button"
							onKeyDown={(event) => {
								if (event.key === "Tab") event.stopPropagation();
							}}
							onClick={() => setConfirmDelete(false)}
						>
							Cancel
						</button>
						<button
							type="button"
							className="csv-column-destructive"
							onKeyDown={(event) => {
								if (event.key === "Tab") event.stopPropagation();
							}}
							onClick={() => onEdit({ kind: "delete", value })}
						>
							Delete option
						</button>
					</div>
				</div>
			) : (
				<Menu.Item
					className="csv-column-action csv-column-destructive"
					onSelect={(event) => {
						event.preventDefault();
						if (used) setConfirmDelete(true);
						else onEdit({ kind: "delete", value });
					}}
				>
					<Trash2 />
					Delete option
				</Menu.Item>
			)}
		</>
	);
}
