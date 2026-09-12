import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { useCsvPopoverOwner } from "./csv-dismissible-popover";

type ToolbarOption = {
	value: string;
	label: string;
	icon?: ReactNode;
	content?: ReactNode;
};
type ToolbarSelectProps = {
	label: string;
	options: readonly ToolbarOption[];
	placeholder?: string;
	searchable?: boolean;
	/** Size the menu to its options rather than to the trigger. */
	fitOptions?: boolean;
} & (
	| {
			multiple: true;
			value: readonly string[];
			onChange: (value: string[]) => void;
			/** How the chosen values combine; "Matches any of" unless the caller says otherwise. */
			matchHint?: string;
	  }
	| { multiple?: false; value: string; onChange: (value: string) => void }
);

export function CsvToolbarSelect({
	label,
	value,
	options,
	onChange,
	placeholder = "Choose a column",
	searchable = false,
	fitOptions = false,
	multiple,
	...rest
}: ToolbarSelectProps) {
	const matchHint =
		("matchHint" in rest ? rest.matchHint : undefined) ?? "Matches any of";
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const tabTarget = useRef<HTMLElement | null>(null);
	const descriptionId = useId();
	const [query, setQuery] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (!open || !searchable) return;
		const frame = requestAnimationFrame(() => searchRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [open, searchable]);
	const filtered = options.filter((option) =>
		option.label.toLowerCase().includes(query.toLowerCase()),
	);
	const selected = options.filter((option) =>
		multiple ? value.includes(option.value) : option.value === value,
	);
	const toggle = (item: string) => {
		if (multiple)
			onChange(
				value.includes(item)
					? value.filter((selectedValue) => selectedValue !== item)
					: [...value, item],
			);
		else onChange(item);
	};
	const owner = useCsvPopoverOwner();
	return (
		<Menu.Root
			open={open}
			modal={false}
			onOpenChange={(next) => {
				setOpen(next);
				setQuery("");
			}}
		>
			<Menu.Trigger asChild>
				<button
					ref={triggerRef}
					type="button"
					className="csv-toolbar-select"
					aria-label={label}
					aria-describedby={multiple ? descriptionId : undefined}
					title={
						multiple && selected.length
							? selected.map((option) => option.label).join(", ")
							: undefined
					}
				>
					{!multiple && selected[0]?.icon}
					<span className={multiple ? "csv-filter-selected-values" : undefined}>
						{selected.length ? (
							multiple ? (
								<>
									{selected.slice(0, 2).map((option) => (
										<span key={option.value}>
											{option.content ?? option.label}
										</span>
									))}
									{selected.length > 2 && (
										<span className="csv-filter-more">
											+{selected.length - 2}
										</span>
									)}
								</>
							) : (
								(selected[0]!.content ?? selected[0]!.label)
							)
						) : (
							placeholder
						)}
					</span>
					<ChevronDown size={13} aria-hidden="true" />
				</button>
			</Menu.Trigger>
			{multiple && (
				<span id={descriptionId} className="sr-only">
					{selected.length
						? `${matchHint}: ${selected.map((option) => option.label).join(", ")}`
						: "All values"}
				</span>
			)}
			<Menu.Portal>
				<Menu.Content
					data-csv-popover-owner={owner}
					className={`csv-column-menu csv-toolbar-options${fitOptions ? " csv-toolbar-options-fit" : ""}`}
					align="start"
					sideOffset={4}
					collisionPadding={8}
					aria-label={label}
					onCloseAutoFocus={(event) => {
						if (tabTarget.current) {
							event.preventDefault();
							tabTarget.current.focus();
							tabTarget.current = null;
						}
					}}
					onKeyDown={(event) => {
						if (event.key !== "Tab") return;
						event.preventDefault();
						event.stopPropagation();
						const controls = Array.from(
							triggerRef.current
								?.closest('[role="dialog"]')
								?.querySelectorAll<HTMLElement>(
									'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
								) ?? [],
						);
						const index = controls.indexOf(triggerRef.current!);
						tabTarget.current =
							controls[index + (event.shiftKey ? -1 : 1)] ?? triggerRef.current;
						setOpen(false);
					}}
				>
					{searchable && (
						<input
							ref={searchRef}
							className="csv-filter-option-search"
							aria-label="Search filter options"
							placeholder="Search for an option…"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "ArrowDown" || event.key === "ArrowUp") {
									event.preventDefault();
									const items =
										event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
											'[role="menuitemradio"], [role="menuitemcheckbox"]',
										);
									(event.key === "ArrowDown"
										? items?.[0]
										: items?.[items.length - 1]
									)?.focus();
								}
								if (event.key === "Enter" && filtered[0]) {
									event.preventDefault();
									toggle(filtered[0].value);
								}
								if (event.key !== "Escape" && event.key !== "Tab")
									event.stopPropagation();
							}}
						/>
					)}
					{searchable && filtered.length === 0 && (
						<div className="csv-bulk-label">No matching options</div>
					)}
					{multiple ? (
						<>
							<div className="csv-filter-match-hint">
								{matchHint} the selected options
							</div>
							{filtered.map((option) => (
								<Menu.CheckboxItem
									key={option.value}
									checked={value.includes(option.value)}
									textValue={option.label}
									className="csv-column-action"
									onSelect={(event) => event.preventDefault()}
									onCheckedChange={() => toggle(option.value)}
									onKeyDown={(event) => {
										if (
											searchable &&
											event.key === "ArrowUp" &&
											option === filtered[0]
										) {
											event.preventDefault();
											searchRef.current?.focus();
										}
									}}
								>
									{option.icon}
									<span className="csv-bulk-column-title">
										{option.content ?? option.label}
									</span>
									<Menu.ItemIndicator className="csv-toolbar-option-check">
										<Check size={13} aria-hidden="true" />
									</Menu.ItemIndicator>
								</Menu.CheckboxItem>
							))}
							<div className="csv-column-separator" />
							<div className="csv-filter-selection-footer">
								<span aria-live="polite">{value.length} selected</span>
								<Menu.Item
									className="csv-column-action"
									disabled={!value.length}
									onSelect={(event) => {
										event.preventDefault();
										onChange([]);
									}}
								>
									Clear selection
								</Menu.Item>
							</div>
						</>
					) : (
						<Menu.RadioGroup value={value} onValueChange={onChange}>
							{filtered.map((option) => (
								<Menu.RadioItem
									key={option.value}
									value={option.value}
									textValue={option.label}
									className="csv-column-action"
								>
									{option.icon}
									<span className="csv-bulk-column-title">
										{option.content ?? option.label}
									</span>
									<Menu.ItemIndicator className="csv-toolbar-option-check">
										<Check size={13} aria-hidden="true" />
									</Menu.ItemIndicator>
								</Menu.RadioItem>
							))}
						</Menu.RadioGroup>
					)}
				</Menu.Content>
			</Menu.Portal>
		</Menu.Root>
	);
}
