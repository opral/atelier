import { useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import {
	ArrowLeft,
	ChevronRight,
	SlidersHorizontal,
	Trash2,
	X,
} from "lucide-react";
import { CSV_TYPES, CsvPill } from "./csv-properties";
import type { CsvColumnInfo } from "./csv-metadata";

export function CsvRowActions({
	count,
	columns,
	columnInfo,
	onEdit,
	onDelete,
	onClear,
}: {
	count: number;
	columns: readonly string[];
	columnInfo: readonly (CsvColumnInfo | undefined)[];
	onEdit?: (column: number, value: string) => void;
	onDelete?: () => void;
	onClear: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [column, setColumn] = useState<number | null>(null);
	const [draft, setDraft] = useState("");
	const info = column === null ? undefined : columnInfo[column];
	const apply = (value: string) => {
		if (column === null) return;
		onEdit?.(column, value);
		setOpen(false);
	};
	return (
		<div className="csv-row-actions" role="group" aria-label="Selected rows">
			<span className="csv-selected-count" role="status">
				{count} selected
			</span>
			{onEdit && (
				<Menu.Root
					open={open}
					onOpenChange={(next) => {
						setOpen(next);
						if (!next) {
							setColumn(null);
							setDraft("");
						}
					}}
				>
					<Menu.Trigger asChild>
						<button
							type="button"
							aria-label="Edit property"
							title="Edit a property for all selected rows"
						>
							<SlidersHorizontal size={15} />
							<span>Edit property</span>
						</button>
					</Menu.Trigger>
					<Menu.Portal>
						<Menu.Content
							className="csv-column-menu csv-bulk-menu"
							align="start"
							sideOffset={6}
							collisionPadding={8}
						>
							{column === null ? (
								<>
									<Menu.Label className="csv-bulk-label">
										Edit {count} selected {count === 1 ? "row" : "rows"}
									</Menu.Label>
									{columns.map((name, index) => {
										const Icon = CSV_TYPES.find(
											(t) => t.type === (columnInfo[index]?.type ?? "text"),
										)!.icon;
										return (
											<Menu.Item
												key={index}
												className="csv-column-action"
												onSelect={(event) => {
													event.preventDefault();
													setColumn(index);
													setDraft("");
												}}
											>
												<Icon size={16} />
												<span className="csv-bulk-column-title">{name}</span>
												<ChevronRight
													size={14}
													className="csv-submenu-chevron"
												/>
											</Menu.Item>
										);
									})}
								</>
							) : (
								<>
									<Menu.Item
										className="csv-column-action"
										onSelect={(event) => {
											event.preventDefault();
											setColumn(null);
											setDraft("");
										}}
									>
										<ArrowLeft size={15} />
										<span className="csv-bulk-column-title">
											{columns[column]}
										</span>
									</Menu.Item>
									<Menu.Separator className="csv-column-separator" />
									{info?.type === "select" ? (
										<>
											<input
												className="csv-bulk-input"
												aria-label="Search options"
												placeholder="Search options…"
												value={draft}
												onChange={(e) => setDraft(e.target.value)}
												onKeyDown={(e) => {
													if (e.key !== "Escape" && e.key !== "Tab")
														e.stopPropagation();
												}}
											/>
											{info.options
												?.filter((o) =>
													o.value.toLowerCase().includes(draft.toLowerCase()),
												)
												.map((option) => (
													<Menu.Item
														key={option.value}
														className="csv-column-action"
														onSelect={() => apply(option.value)}
													>
														<CsvPill
															value={option.value}
															color={option.color}
														/>
													</Menu.Item>
												))}
											{!info.options?.some((o) =>
												o.value.toLowerCase().includes(draft.toLowerCase()),
											) && (
												<div className="csv-bulk-label">
													No matching options
												</div>
											)}
										</>
									) : info?.type === "checkbox" ? (
										<>
											<Menu.Item
												className="csv-column-action"
												onSelect={() => apply("yes")}
											>
												Checked
											</Menu.Item>
											<Menu.Item
												className="csv-column-action"
												onSelect={() => apply("no")}
											>
												Unchecked
											</Menu.Item>
										</>
									) : (
										<form
											className="csv-bulk-form"
											onSubmit={(event) => {
												event.preventDefault();
												apply(draft);
											}}
										>
											<label htmlFor="csv-bulk-value">
												Set value for {count} {count === 1 ? "row" : "rows"}
											</label>
											<input
												id="csv-bulk-value"
												className="csv-bulk-input"
												type={info?.type === "date" ? "date" : "text"}
												inputMode={
													info?.type === "number" ? "decimal" : undefined
												}
												value={draft}
												onChange={(event) => setDraft(event.target.value)}
												onKeyDown={(event) => {
													if (event.key !== "Escape" && event.key !== "Tab")
														event.stopPropagation();
												}}
											/>
											<button type="submit">Apply to selected rows</button>
										</form>
									)}
									<Menu.Separator className="csv-column-separator" />
									<Menu.Item
										className="csv-column-action"
										onSelect={() => apply("")}
									>
										<X size={15} />
										Clear value
									</Menu.Item>
								</>
							)}
						</Menu.Content>
					</Menu.Portal>
				</Menu.Root>
			)}
			{onDelete && (
				<button
					type="button"
					className="csv-bulk-delete"
					aria-label={`Delete ${count} selected ${count === 1 ? "row" : "rows"}`}
					title={`Delete ${count} selected ${count === 1 ? "row" : "rows"}`}
					onClick={onDelete}
				>
					<Trash2 size={16} />
				</button>
			)}
			<button
				type="button"
				aria-label="Clear row selection"
				title="Clear selection (Esc)"
				onClick={onClear}
			>
				<X size={15} />
			</button>
		</div>
	);
}
