import {
	CSV_TEXT_HORIZONTAL_PADDING,
	CSV_TEXT_VERTICAL_PADDING,
	CSV_TEXT_LINE_HEIGHT,
	type CsvTextLine,
} from "./csv-text-wrap";
import { createPortal } from "react-dom";
import { useEditorClosesOnGridScroll } from "./csv-editor-overlay";
import {
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
} from "react";
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
	drawTextCell,
	getMiddleCenterBias,
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
import { csvLinkBoxes, csvLinkHit, type CsvLinkBox } from "./csv-links";
import "./properties.css";

import {
	CSV_COLORS,
	CSV_COLOR_FALLBACKS,
	type CsvPalette,
} from "./csv-palette";
export { CSV_COLORS } from "./csv-palette";
import { selectOptionColor, selectOptions } from "./csv-select-options";
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
	/** Every value the column holds; a select offers these beside metadata. */
	csvOptionValues?: readonly string[];
	/** The info was inferred from values: render typed, edit as plain text. */
	csvInferred?: boolean;
	csvNewOption?: string;
	csvWrappedLines?: CsvTextLine[];
	/**
	 * Where the value leads (`csvCellLinkUrl`). Notion's way: the text keeps
	 * the cell's ink and weight over a quiet underline, and takes the link
	 * colour only under the pointer; a press on it opens the link.
	 */
	csvLink?: string;
};

/**
 * The link cell's text boxes, measured with the font the canvas draws it in.
 * The same boxes answer the hover underline and the click (index.tsx).
 */
export function propertyCellLinkBoxes(
	cell: PropertyCell,
	size: { readonly width: number; readonly height: number },
	measure: (text: string) => number,
): CsvLinkBox[] {
	return csvLinkBoxes(
		{
			text: (cell.displayData ?? cell.data).split(/\r\n|\r|\n/, 1)[0] ?? "",
			wrappedLines:
				cell.allowWrapping && cell.csvWrappedLines
					? cell.csvWrappedLines
					: undefined,
		},
		size,
		measure,
	);
}

/** Underlines a link's text, a hair under its baseline. */
function drawLinkUnderline(
	ctx: CanvasRenderingContext2D,
	rect: { readonly x: number; readonly y: number },
	boxes: readonly CsvLinkBox[],
	color: string,
) {
	ctx.save();
	ctx.textBaseline = "alphabetic";
	const cap = ctx.measureText("H").actualBoundingBoxAscent;
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	ctx.beginPath();
	for (const box of boxes) {
		const y =
			Math.round(rect.y + box.y + CSV_TEXT_LINE_HEIGHT / 2 + cap / 2 + 2) + 0.5;
		ctx.moveTo(rect.x + box.x, y);
		ctx.lineTo(rect.x + box.x + box.width, y);
	}
	ctx.stroke();
	ctx.restore();
}

/**
 * A link cell's text boxes, and whether the pointer is on them. On the text
 * the pointer becomes a hand; beside it the cell is just a cell. Glide hands
 * the hover position to a link cell only (`csvCellRenderers`). Reads the
 * font the caller has set on the context.
 */
function linkState(
	args: Parameters<DrawCellCallback>[0],
	cell: PropertyCell,
): { boxes: CsvLinkBox[]; hovered: boolean } {
	const { ctx, rect, hoverX, hoverY } = args;
	const boxes = propertyCellLinkBoxes(
		cell,
		rect,
		(text) => ctx.measureText(text).width,
	);
	const hovered = csvLinkHit(boxes, hoverX, hoverY);
	// Glide hands its cell renderers' arguments to drawCell as they are; the
	// callback's type leaves the cursor hook out.
	if (hovered)
		(
			args as { overrideCursor?: (cursor: CSSProperties["cursor"]) => void }
		).overrideCursor?.("pointer");
	return { boxes, hovered };
}

/** Select pills mirror the shell's tags: 20px tall with a 6px text inset. */
const PILL_HEIGHT = 20;
const PILL_INSET = 6;
export function drawPropertyCell(
	args: Parameters<DrawCellCallback>[0],
	drawContent: () => void,
	search = "",
	palette: CsvPalette = CSV_COLOR_FALLBACKS,
	searchColor = "#fef08a", // token-literal: canvas fallback for --atelier-highlight
	linkUnderlineColor = "rgb(214, 211, 209)", // token-literal: canvas fallback for --atelier-border-strong
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
		// Glide centres a single line's capitals on the row; wrapped lines sit
		// on their 20px lines the same way, so a wrapped cell and a plain one
		// in the same row share a baseline, and the editor can match both.
		const bias = getMiddleCenterBias(ctx, ctx.font);
		const link = cell.csvLink ? linkState(args, cell) : null;
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
			ctx.fillStyle = link?.hovered ? theme.linkColor : theme.textDark;
			ctx.fillText(line.text, x, y + bias);
		}
		if (link)
			drawLinkUnderline(
				ctx,
				rect,
				link.boxes,
				link.hovered ? theme.linkColor : linkUnderlineColor,
			);
		ctx.restore();
		return;
	}
	const drawText = (draw: () => void = drawContent) => {
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
		draw();
	};
	if (cell.csvLink && cell.kind === GridCellKind.Text) {
		ctx.save();
		ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
		const link = linkState(args, cell);
		ctx.restore();
		// The cell's own text at rest; under the pointer, the same drawing in
		// the link colour. Glide prepares the context's fill once for a run of
		// text cells and trusts it after, so the link colour is restored away
		// — left behind, it painted the next cell's text in the link colour.
		drawText(
			link.hovered
				? () => {
						ctx.save();
						drawTextCell(
							{
								...args,
								theme: { ...theme, textDark: theme.linkColor },
							} as Parameters<typeof drawTextCell>[0],
							cell.displayData ?? cell.data,
							cell.contentAlign,
						);
						ctx.restore();
					}
				: drawContent,
		);
		ctx.save();
		ctx.beginPath();
		ctx.rect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
		ctx.clip();
		ctx.font = `${theme.baseFontStyle} ${theme.fontFamily}`;
		drawLinkUnderline(
			ctx,
			rect,
			link.boxes,
			link.hovered ? theme.linkColor : linkUnderlineColor,
		);
		ctx.restore();
		return;
	}
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
		const [bg, fg] =
			palette[selectOptionColor(info, value) as keyof CsvPalette] ??
			palette.gray;
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
		// A hairline in the chip's own ink keeps it legible on a hovered row
		// or a selected column, whose washes sit close to a pale chip.
		ctx.strokeStyle = fg;
		ctx.globalAlpha = 0.22;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.roundRect(pillX + 0.5, pillY + 0.5, width - 1, PILL_HEIGHT - 1, 2.5);
		ctx.stroke();
		ctx.globalAlpha = 1;
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
	initialValue,
	target,
}) => {
	const cell = value as PropertyCell;
	const info = cell.csvInfo!;
	// Typing on a selected cell opens the editor with that keystroke, and Glide
	// has already put it in the cell's data. It leaves displayData alone,
	// though, so that is where the committed value still is. The keystroke is
	// the start of a search; the committed value is what the list ticks, and
	// what Clear has to offer to clear.
	const typed = initialValue ?? "";
	const committed = typed ? (cell.displayData ?? "") : cell.data;
	const CHECKBOX_OPTIONS = [
		{ value: "yes", color: "blue" },
		{ value: "no", color: "gray" },
	];
	// A checkbox column can hold a value that is neither: an import, an agent,
	// a column retyped over prose. Listing only yes and no left the picker
	// pointing at nothing and the cell's own value nowhere on screen — the
	// select picker has always merged what it finds, and this one does too.
	const options =
		info.type === "checkbox"
			? CHECKBOX_OPTIONS.some((option) => option.value === committed) ||
				!committed
				? CHECKBOX_OPTIONS
				: [...CHECKBOX_OPTIONS, { value: committed, color: "gray" }]
			: selectOptions(info, cell.csvOptionValues ?? []);
	const matching = (option: string, text: string) =>
		option.toLowerCase().includes(text.toLowerCase());
	const [query, setQuery] = useState(typed);
	const [active, setActive] = useState(() => {
		// Enter, Enter must leave the cell as it was, so the list opens on the
		// value the cell already holds rather than on whatever sorts first.
		// The index counts the options the list is actually showing: with the
		// opening keystroke as the query those are already fewer than the
		// column's, and an index into the full list pointed at the wrong row —
		// often at "Create <keystroke>", so one letter and Enter replaced the
		// cell with that letter and added it to the column for good.
		const index = options
			.filter((option) => matching(option.value, typed))
			.findIndex((option) => option.value === committed);
		return index < 0 ? 0 : index;
	});
	// A date cannot be started from one keystroke, and writing the keystroke
	// itself would replace the date with a stray character.
	const initialDraft = info.type === "date" && typed ? "" : cell.data;
	const [draft, setDraft] = useState(initialDraft);
	/**
	 * Whether this date cell opens on a value a date input can show. Decided
	 * once: switching an input's type under a caret mid-word would throw the
	 * caret away the moment a typed date became well formed.
	 */
	const [showsDate] = useState(
		() =>
			info.type === "date" &&
			(initialDraft === "" || /^\d{4}-\d{2}-\d{2}$/.test(initialDraft)),
	);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const activeOptionRef = useRef<HTMLButtonElement>(null);
	const listId = useId();
	const dialogRef = useRef<HTMLDivElement>(null);
	// Which side of the cell the picker sits on, decided from its real height
	// once and then left alone: re-deciding on every render had the whole
	// popover jump as the query filtered the list, sliding the option the
	// pointer was aimed at out from under it. Above the cell it hangs from its
	// bottom edge, so filtering moves the list and not the box.
	const [placement, setPlacement] = useState<
		{ readonly top: number } | { readonly bottom: number } | null
	>(null);
	/** Set when the picker has to scroll because neither side has room. */
	const [capped, setCapped] = useState<number | null>(null);
	// The picker is positioned once, so scrolling the table would detach it
	// from its cell; a scroll closes it instead.
	useEditorClosesOnGridScroll(onFinishedEditing);
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
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		const doc = dialog.ownerDocument;
		// Clicking the open cell again has Glide close and reopen the editor in
		// place, which leaves focus on nothing at all. Escape then had no
		// element to travel up from and the picker sat there. Own Escape for
		// the whole document while the picker is open, and take focus back when
		// it lands nowhere so typing and the arrow keys keep working too.
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (event.isComposing || event.keyCode === 229) return;
			if (dialog.contains(event.target as Node)) return;
			event.preventDefault();
			event.stopPropagation();
			onFinishedEditing();
		};
		const onFocusOut = () => {
			requestAnimationFrame(() => {
				if (!dialog.isConnected) return;
				const focused = doc.activeElement;
				if (focused === null || focused === doc.body) inputRef.current?.focus();
			});
		};
		doc.addEventListener("keydown", onKeyDown, true);
		doc.addEventListener("focusout", onFocusOut);
		return () => {
			doc.removeEventListener("keydown", onKeyDown, true);
			doc.removeEventListener("focusout", onFocusOut);
		};
	}, [onFinishedEditing]);
	const candidates = options.filter((o) => matching(o.value, query));
	const newValue = query.trim();
	const canCreate =
		info.type === "select" &&
		newValue.length > 0 &&
		!options.some((o) => o.value.toLowerCase() === newValue.toLowerCase());
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
	const maxHeight = Math.min(350, window.innerHeight - 24);
	const x = Math.max(8, Math.min(target.x, window.innerWidth - width - 8));
	const below = target.y + target.height + 3;
	useLayoutEffect(() => {
		// Runs before the first paint, so the flip is never visible. A short
		// list is much shorter than the cap, and clamping against the cap
		// pushed the picker up over the very cell it edits.
		if (placement) return;
		const height = dialogRef.current?.getBoundingClientRect().height ?? 0;
		const fitsBelow = below + height <= window.innerHeight - 8;
		const fitsAbove = target.y - 3 - height >= 8;
		if (fitsBelow) setPlacement({ top: below });
		else if (fitsAbove)
			setPlacement({ bottom: window.innerHeight - target.y + 3 });
		else {
			// Neither side holds the whole list. Take the roomier one and let
			// the list scroll inside what is there, rather than covering the
			// very cell being edited.
			const roomBelow = window.innerHeight - 8 - below;
			const roomAbove = target.y - 3 - 8;
			setCapped(Math.max(80, Math.max(roomBelow, roomAbove)));
			setPlacement(
				roomBelow >= roomAbove
					? { top: below }
					: { bottom: window.innerHeight - target.y + 3 },
			);
		}
	}, [below, placement, target.y]);
	return createPortal(
		// oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The dialog contains focusable controls and owns Escape; input-only navigation below leaves button activation native.
		<div
			ref={dialogRef}
			className="csv-property-popover click-outside-ignore"
			data-capped={capped === null ? undefined : "true"}
			role="dialog"
			aria-label={`${info.header} value`}
			tabIndex={-1}
			style={{
				position: "fixed",
				left: x,
				width,
				maxHeight: capped ?? maxHeight,
				...(placement ?? { top: below }),
			}}
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
						aria-label={`${info.header} options`}
						id={listId}
						ref={listRef}
					>
						{candidates.map((o, i) => (
							<button
								type="button"
								role="option"
								aria-selected={committed === o.value}
								id={`${listId}-option-${i}`}
								ref={active === i ? activeOptionRef : undefined}
								className={`csv-option-row ${active === i ? "is-active" : ""}`}
								key={o.value}
								onMouseEnter={() => setActive(i)}
								onClick={() => choose(o.value)}
							>
								<CsvPill {...o} />
								{committed === o.value && <Check size={14} />}
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
					<label>
						{info.type !== "date"
							? "Edit value"
							: showsDate
								? "Choose a date"
								: "Not a date yet"}
					</label>
					<input
						ref={inputRef}
						// A date input renders nothing for a value it cannot parse, so
						// the cell's own value was invisible and Save looked like
						// Cancel. Text keeps it on screen and lets it be corrected.
						type={showsDate ? "date" : "text"}
						{...(showsDate ? {} : { placeholder: "YYYY-MM-DD" })}
						aria-label="Cell value"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
					/>
					<button type="submit">Save</button>
				</form>
			)}
			{committed && (
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
/**
 * Where the text editor puts its text: exactly where the canvas drew it.
 * Glide's bounds carry the cell's trailing grid line (one pixel more than
 * the row and the column); the editor covers the cell the canvas painted,
 * without that line, so its ring lands on the selected cell's ring. A wrapped cell's lines start where `drawPropertyCell`
 * starts them; a single line sits in the middle of the row, as Glide draws
 * it. The bottom inset takes the rest of the row, so the editor is the cell's
 * size until the text outgrows it, and then it grows downward over the rows
 * below — the row itself never changes height while it is edited.
 *
 * `baseline` is how far the canvas's baseline sits below the textarea's on
 * the same 20px line (`csvEditorBaselineShift`).
 */
export function csvTextEditorInsets(
	target: { readonly height: number },
	lines: number,
	baseline = 0,
): { top: number; bottom: number; right: number } {
	const rowHeight = Math.max(0, target.height - 1);
	const textHeight = Math.max(1, lines) * CSV_TEXT_LINE_HEIGHT;
	const top =
		(lines > 1
			? Math.max(CSV_TEXT_VERTICAL_PADDING, (rowHeight - textHeight) / 2)
			: Math.max(0, (rowHeight - CSV_TEXT_LINE_HEIGHT) / 2)) + baseline;
	return {
		top,
		bottom: Math.max(0, rowHeight - top - textHeight),
		right: CSV_TEXT_HORIZONTAL_PADDING,
	};
}

let metricsContext: CanvasRenderingContext2D | null | undefined;
/**
 * The canvas puts a line's baseline half a capital below the line's middle
 * (Glide's middle-centre bias); a textarea puts it where the font's rounded
 * ascent and descent, centred in the line box, leave it. The difference,
 * a fraction of a pixel that depends on the font, is what the editor shifts
 * its text by so that the glyphs do not move when the cell opens.
 */
export function csvEditorBaselineShift(font: string): number {
	if (metricsContext === undefined)
		metricsContext =
			typeof document === "undefined"
				? null
				: document.createElement("canvas").getContext("2d");
	const ctx = metricsContext;
	if (!ctx) return 0;
	ctx.font = font;
	ctx.textBaseline = "alphabetic";
	const metrics = ctx.measureText("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
	if (!Number.isFinite(metrics.fontBoundingBoxAscent)) return 0;
	const ascent = Math.round(metrics.fontBoundingBoxAscent);
	const descent = Math.round(metrics.fontBoundingBoxDescent);
	return (metrics.actualBoundingBoxAscent - ascent + descent) / 2;
}

const TextEditor: ProvideEditorComponent<GridCell> = ({
	value,
	onChange,
	onFinishedEditing,
	validatedSelection,
	target,
	theme,
}) => {
	const typed = useRef(value);
	typed.current = value;
	// Scrolling the table moves the cell out from under the editor; keep what
	// was typed and close, rather than leaving a value floating over the grid.
	useEditorClosesOnGridScroll(() => onFinishedEditing(typed.current));
	// Fixed when the editor opens: typing a line more grows the editor below
	// the cell, and the lines already there stay where they were.
	const [insets] = useState(() =>
		csvTextEditorInsets(
			target,
			(value as PropertyCell).allowWrapping
				? ((value as PropertyCell).csvWrappedLines?.length ?? 1)
				: 1,
			csvEditorBaselineShift(`${theme.baseFontStyle} ${theme.fontFamily}`),
		),
	);
	if (value.kind !== GridCellKind.Text) return null;
	return (
		<div
			className="csv-text-editor"
			style={
				{
					width: Math.max(40, target.width - 1),
					"--csv-editor-inset-top": `${insets.top}px`,
					"--csv-editor-inset-bottom": `${insets.bottom}px`,
					"--csv-editor-inset-right": `${insets.right}px`,
				} as CSSProperties
			}
		>
			<TextCellEntry
				className="csv-text-entry"
				highlight={false}
				altNewline
				value={value.data}
				validatedSelection={validatedSelection}
				onChange={(event) => onChange({ ...value, data: event.target.value })}
			/>
		</div>
	);
};

export const providePropertyEditor: ProvideEditorCallback<GridCell> = (
	cell,
) => {
	const info = (cell as PropertyCell).csvInfo;
	if ((cell as PropertyCell).readonly) return undefined;
	if (
		info &&
		!(cell as PropertyCell).csvInferred &&
		["select", "checkbox", "date"].includes(info.type)
	) {
		return {
			editor: PropertyEditor,
			disablePadding: true,
			disableStyling: true,
		};
	}
	if (cell.kind === GridCellKind.Text) {
		return { editor: TextEditor, disablePadding: true };
	}
	return undefined;
};
