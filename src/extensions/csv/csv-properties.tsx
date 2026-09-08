import {
	CSV_TEXT_HORIZONTAL_PADDING,
	CSV_TEXT_VERTICAL_PADDING,
	CSV_TEXT_LINE_HEIGHT,
	type CsvTextLine,
} from "./csv-text-wrap";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";
import {
	CaseSensitive,
	CalendarDays,
	Check,
	CircleChevronDown,
	Hash,
	Link,
	Mail,
	Plus,
	SquareCheck,
	X,
} from "lucide-react";
import {
	GridCellKind,
	TextCellEntry,
	type GridCell,
	type TextCell,
	type DrawCellCallback,
	type ProvideEditorCallback,
	type ProvideEditorComponent,
} from "@glideapps/glide-data-grid";
import {
	csvSearchMatches,
	drawCsvSearchHighlights,
} from "./csv-search-highlight";
import type { CsvColumnInfo } from "./csv-metadata";
import "./properties.css";

import {
	CSV_COLORS,
	CSV_COLOR_FALLBACKS,
	type CsvPalette,
} from "./csv-palette";
export { CSV_COLORS } from "./csv-palette";
export const CSV_TYPES = [
	{ type: "text", label: "Text", icon: CaseSensitive },
	{ type: "select", label: "Select", icon: CircleChevronDown },
	{ type: "checkbox", label: "Checkbox", icon: SquareCheck },
	{ type: "date", label: "Date", icon: CalendarDays },
	{ type: "number", label: "Number", icon: Hash },
	{ type: "email", label: "Email", icon: Mail },
	{ type: "url", label: "URL", icon: Link },
] as const;
const headerPaths: Record<string, string> = {
	text: '<path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16M22 9v7M3.304 13h6.392"/><circle cx="18.5" cy="12.5" r="3.5"/>',
	select: '<circle cx="12" cy="12" r="9"/><path d="m8 10 4 4 4-4"/>',
	checkbox:
		'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m7 12 3 3 7-7"/>',
	date: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
	number: '<path d="M4 9h16M3 15h16M10 3 8 21M16 3l-2 18"/>',
	email:
		'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
	url: '<path d="M10 13a5 5 0 0 0 7 .2l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7-.2l-3 3a5 5 0 0 0 7 7l2-2"/>',
};
export const CSV_HEADER_ICONS = Object.fromEntries(
	Object.entries(headerPaths).map(([type, paths]) => [
		type,
		({ fgColor }: { fgColor: string }) =>
			`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${fgColor}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`,
	]),
);
export function optionColor(color?: string) {
	return CSV_COLORS[color as keyof typeof CSV_COLORS] ?? CSV_COLORS.gray;
}
export function CsvPill({ value, color }: { value: string; color?: string }) {
	const [background, colorValue] = optionColor(color);
	return (
		<span className="csv-option-pill" style={{ background, color: colorValue }}>
			{value}
		</span>
	);
}
export type PropertyCell = TextCell & {
	csvInfo?: CsvColumnInfo;
	csvNewOption?: string;
	csvWrappedLines?: CsvTextLine[];
};
/** Select pills mirror the shell's tags: 20px tall with a 6px text inset. */
const PILL_HEIGHT = 20;
const PILL_INSET = 6;
export function drawPropertyCell(
	args: Parameters<DrawCellCallback>[0],
	drawContent: () => void,
	search = "",
	palette: CsvPalette = CSV_COLOR_FALLBACKS,
	searchColor = "#fef08a",
) {
	const cell = args.cell as PropertyCell;
	const info = cell.csvInfo;
	const { ctx, rect, theme } = args;
	if (cell.allowWrapping && cell.csvWrappedLines) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
		ctx.clip();
		ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
		ctx.textBaseline = "middle";
		ctx.textAlign = "left";
		const matches = csvSearchMatches(cell.data, search);
		for (const [index, line] of cell.csvWrappedLines.entries()) {
			const x = rect.x + CSV_TEXT_HORIZONTAL_PADDING;
			const y =
				rect.y +
				Math.max(
					CSV_TEXT_VERTICAL_PADDING,
					(rect.height - cell.csvWrappedLines.length * CSV_TEXT_LINE_HEIGHT) /
						2,
				) +
				CSV_TEXT_LINE_HEIGHT * (index + 0.5);
			if (y > rect.y + rect.height) break;
			ctx.fillStyle = searchColor;
			for (const match of matches) {
				const start = Math.max(match.start, line.start) - line.start;
				const end = Math.min(match.end, line.end) - line.start;
				if (end <= start) continue;
				const left = ctx.measureText(line.text.slice(0, start)).width;
				const right = ctx.measureText(line.text.slice(0, end)).width;
				ctx.fillRect(x + left, y - 9, right - left, 18);
			}
			ctx.fillStyle = theme.textDark;
			ctx.fillText(line.text, x, y);
		}
		ctx.restore();
		return;
	}
	const drawText = () => {
		if (
			search &&
			(args.cell.kind === GridCellKind.Text ||
				args.cell.kind === GridCellKind.Uri)
		) {
			ctx.save();
			ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
			const text =
				(args.cell.displayData ?? args.cell.data).split("\n", 1)[0] ?? "";
			drawCsvSearchHighlights(
				ctx,
				text,
				search,
				rect.x + theme.cellHorizontalPadding + 0.5,
				rect.y + rect.height / 2,
				rect.width - theme.cellHorizontalPadding * 2,
				18,
				searchColor,
			);
			ctx.restore();
		}
		drawContent();
	};
	if (!info || cell.kind !== GridCellKind.Text) {
		drawText();
		return;
	}
	const value = cell.data;
	ctx.save();
	ctx.beginPath();
	ctx.rect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
	ctx.clip();
	if (info.type === "select" && value) {
		const option = info.options?.find((o) => o.value === value);
		const [bg, fg] = palette[option?.color as keyof CsvPalette] ?? palette.gray;
		// The pill is the shell's 20px tag (6px inset, 3px radius) and starts on
		// the same inset as plain text so columns of mixed types share one edge.
		const inset = theme.cellHorizontalPadding;
		const pillX = rect.x + inset;
		const pillY = rect.y + (rect.height - PILL_HEIGHT) / 2;
		ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
		const width = Math.min(
			ctx.measureText(value).width + PILL_INSET * 2,
			rect.width - inset * 2,
		);
		ctx.fillStyle = bg;
		ctx.beginPath();
		ctx.roundRect(pillX, pillY, width, PILL_HEIGHT, 3);
		ctx.fill();
		ctx.fillStyle = fg;
		ctx.textBaseline = "middle";
		let label = value;
		const labelWidth = width - PILL_INSET * 2;
		if (ctx.measureText(label).width > labelWidth) {
			while (label.length && ctx.measureText(label + "…").width > labelWidth)
				label = label.slice(0, -1);
			label += "…";
		}
		const textX = pillX + PILL_INSET;
		const textY = rect.y + rect.height / 2 + 1;
		drawCsvSearchHighlights(
			ctx,
			value,
			search,
			textX,
			textY,
			labelWidth - (label !== value ? ctx.measureText("…").width : 0),
			18,
			searchColor,
		);
		ctx.fillText(label, textX, textY);
		if (!option) {
			ctx.fillStyle = theme.textMedium;
			ctx.fillRect(pillX, pillY + PILL_HEIGHT - 2, width, 2);
		}
	} else if (
		info.type === "checkbox" &&
		/^(yes|no|true|false|1|0)?$/i.test(value)
	) {
		const checked = /^(yes|true|1)$/i.test(value);
		const x = rect.x + theme.cellHorizontalPadding,
			y = rect.y + (rect.height - 16) / 2;
		if (search && csvSearchMatches(value, search).length) {
			ctx.fillStyle = searchColor;
			ctx.fillRect(x - 3, y - 3, 22, 22);
		}
		ctx.fillStyle = checked ? theme.accentColor : theme.bgCell;
		ctx.strokeStyle = checked ? theme.accentColor : theme.textLight;
		ctx.beginPath();
		ctx.roundRect(x, y, 16, 16, 3);
		ctx.fill();
		ctx.stroke();
		if (checked) {
			ctx.strokeStyle = theme.accentFg;
			ctx.lineWidth = 1.7;
			ctx.beginPath();
			ctx.moveTo(x + 4, y + 8);
			ctx.lineTo(x + 7, y + 11);
			ctx.lineTo(x + 12, y + 5);
			ctx.stroke();
		} else if (!value) {
			ctx.strokeStyle = theme.textLight;
			ctx.beginPath();
			ctx.moveTo(x + 5, y + 8);
			ctx.lineTo(x + 11, y + 8);
			ctx.stroke();
		}
	} else {
		drawText();
	}
	ctx.restore();
}

const PropertyEditor: ProvideEditorComponent<GridCell> = ({
	value,
	onFinishedEditing,
	target,
}) => {
	const cell = value as PropertyCell;
	const info = cell.csvInfo!;
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [draft, setDraft] = useState(cell.data);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const activeOptionRef = useRef<HTMLButtonElement>(null);
	const listId = useId();
	useEffect(() => {
		// Glide restores canvas focus after an edit closes. A double-click can
		// reopen immediately, so focus the new editor after that restoration.
		let inner = 0;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => inputRef.current?.focus());
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	}, []);
	const options =
		info.type === "checkbox"
			? [
					{ value: "yes", color: "blue" },
					{ value: "no", color: "gray" },
				]
			: (info.options ?? []);
	const candidates = options.filter((o) =>
		o.value.toLowerCase().includes(query.toLowerCase()),
	);
	const newValue = query.trim();
	const canCreate =
		info.type === "select" &&
		newValue.length > 0 &&
		!options.some((o) => o.value === newValue);
	const activeValue = candidates[active]?.value;
	useEffect(() => {
		const list = listRef.current;
		const option = activeOptionRef.current;
		if (!list || !option) return;
		// Scroll only the option list, keeping the table and its overlay anchored.
		const listBounds = list.getBoundingClientRect();
		const optionBounds = option.getBoundingClientRect();
		if (optionBounds.top < listBounds.top)
			list.scrollTop -= listBounds.top - optionBounds.top;
		else if (optionBounds.bottom > listBounds.bottom)
			list.scrollTop += optionBounds.bottom - listBounds.bottom;
	}, [active, activeValue, query, canCreate]);
	const choose = (text: string, create = false) =>
		onFinishedEditing({
			...cell,
			data: text,
			displayData: text,
			...(create ? { csvNewOption: text } : {}),
		});
	const width = Math.max(260, Math.min(330, window.innerWidth - 24));
	const height = Math.min(350, window.innerHeight - 24);
	const x = Math.max(8, Math.min(target.x, window.innerWidth - width - 8));
	const y = Math.max(
		8,
		Math.min(target.y + target.height + 3, window.innerHeight - height - 8),
	);
	return createPortal(
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The dialog contains focusable controls and owns Escape; input-only navigation below leaves button activation native.
		<div
			className="csv-property-popover click-outside-ignore"
			role="dialog"
			aria-label={`${info.header} value`}
			tabIndex={-1}
			style={{ position: "fixed", left: x, top: y, width, maxHeight: height }}
			onKeyDown={(e) => {
				e.stopPropagation();
				// Enter/Escape belong to the IME while a candidate is composing.
				if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
				if (e.key === "Escape") {
					e.preventDefault();
					onFinishedEditing();
				}
				if (
					(info.type === "select" || info.type === "checkbox") &&
					e.target === inputRef.current
				) {
					const count = candidates.length + (canCreate ? 1 : 0);
					if (e.key === "ArrowDown") {
						e.preventDefault();
						setActive((n) => Math.max(0, Math.min(n + 1, count - 1)));
					}
					if (e.key === "ArrowUp") {
						e.preventDefault();
						setActive((n) => Math.max(n - 1, 0));
					}
					if (e.key === "Enter") {
						e.preventDefault();
						if (candidates[active]) choose(candidates[active]!.value);
						else if (canCreate) choose(newValue, true);
					}
				}
			}}
		>
			{info.type === "select" || info.type === "checkbox" ? (
				<>
					<input
						ref={inputRef}
						className="csv-option-search"
						placeholder="Search for an option…"
						aria-label="Search for an option"
						role="combobox"
						aria-expanded="true"
						aria-controls={listId}
						aria-activedescendant={
							candidates[active] || (canCreate && active === candidates.length)
								? `${listId}-option-${active}`
								: undefined
						}
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setActive(0);
						}}
					/>
					<div className="csv-popover-label">
						{info.type === "select"
							? "Select an option or create one"
							: "Choose a value"}
					</div>
					<div
						className="csv-option-list"
						role="listbox"
						id={listId}
						ref={listRef}
					>
						{candidates.map((o, i) => (
							<button
								type="button"
								role="option"
								aria-selected={cell.data === o.value}
								id={`${listId}-option-${i}`}
								ref={active === i ? activeOptionRef : undefined}
								className={`csv-option-row ${active === i ? "is-active" : ""}`}
								key={o.value}
								onMouseEnter={() => setActive(i)}
								onClick={() => choose(o.value)}
							>
								<CsvPill {...o} />
								{cell.data === o.value && <Check size={14} />}
							</button>
						))}
						{canCreate && (
							<button
								type="button"
								role="option"
								aria-selected={false}
								id={`${listId}-option-${candidates.length}`}
								ref={active === candidates.length ? activeOptionRef : undefined}
								className={`csv-option-row ${active === candidates.length ? "is-active" : ""}`}
								onMouseEnter={() => setActive(candidates.length)}
								onClick={() => choose(newValue, true)}
							>
								<Plus size={14} />
								<span>Create</span>
								<CsvPill value={newValue} />
							</button>
						)}
						{candidates.length === 0 && !canCreate && (
							<div className="csv-popover-label">
								No options yet. Type to create one.
							</div>
						)}
					</div>
				</>
			) : (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						choose(draft);
					}}
					className="csv-value-form"
				>
					<label>{info.type === "date" ? "Choose a date" : "Edit value"}</label>
					<input
						ref={inputRef}
						type={info.type === "date" ? "date" : "text"}
						aria-label="Cell value"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
					/>
					<button type="submit">Save</button>
				</form>
			)}
			{cell.data && (
				<button
					type="button"
					className="csv-option-clear"
					onClick={() => choose("")}
				>
					<X size={13} />
					Clear value
				</button>
			)}
		</div>,
		document.body,
	);
};
const TextEditor: ProvideEditorComponent<GridCell> = ({
	value,
	onChange,
	validatedSelection,
	target,
}) => {
	if (value.kind !== GridCellKind.Text) return null;
	const entry = (
		<TextCellEntry
			className={value.allowWrapping ? "csv-wrapped-text-entry" : undefined}
			highlight={false}
			altNewline
			value={value.data}
			validatedSelection={validatedSelection}
			onChange={(event) => onChange({ ...value, data: event.target.value })}
		/>
	);
	return value.allowWrapping ? (
		<div style={{ width: Math.max(40, target.width - 2) }}>{entry}</div>
	) : (
		entry
	);
};

export const providePropertyEditor: ProvideEditorCallback<GridCell> = (
	cell,
) => {
	const info = (cell as PropertyCell).csvInfo;
	if ((cell as PropertyCell).readonly) return undefined;
	if (info && ["select", "checkbox", "date"].includes(info.type)) {
		return {
			editor: PropertyEditor,
			disablePadding: true,
			disableStyling: true,
		};
	}
	if (cell.kind === GridCellKind.Text) {
		return { editor: TextEditor, disablePadding: cell.allowWrapping === true };
	}
	return undefined;
};
