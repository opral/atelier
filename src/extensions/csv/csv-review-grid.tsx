import {
	useCallback,
	useLayoutEffect,
	useRef,
	useMemo,
	useState,
	type CSSProperties,
} from "react";
import {
	Plus,
	Minus,
	Circle,
	Check,
	Square,
	ChevronsUpDown,
	ChevronsDownUp,
} from "lucide-react";
import { CSV_TYPES } from "./csv-properties";
import { CsvReviewTrigger } from "./csv-review-popover";
import {
	csvReviewChanges,
	type buildCsvReviewModel,
	type CsvReviewRow,
} from "./csv-review-model";
import {
	csvReviewFoldCountLabel,
	csvReviewFoldRangeLabel,
	csvReviewRowNumber,
	csvReviewSegments,
	visibleCsvReviewRows,
	type CsvReviewSegment,
} from "./csv-review-folds";
import type { CsvColumnInfo } from "./csv-metadata";
import type { CsvFilterGroup } from "./csv-filter";
import { csvSearchMatches } from "./csv-search-highlight";
import "./csv-review-grid.css";

type Model = ReturnType<typeof buildCsvReviewModel>;
type Status = Model["columns"][number]["status"];
type Sort = { column: number; direction: 1 | -1 } | null;

/** A band is exactly a row tall, so the grid's rhythm never breaks. */
const BAND_HEIGHT = 40;

export function CsvReviewSummary({ model }: { model: Model }) {
	const { count, details } = csvReviewChanges(model);
	return count ? (
		<CsvReviewTrigger
			className="csv-review-summary"
			label="Review changes"
			title="Changes in this table"
			details={details}
		>
			{count}
			<span className="csv-review-summary-word">
				{" "}
				{count === 1 ? "change" : "changes"}
			</span>
		</CsvReviewTrigger>
	) : (
		<span className="csv-review-summary" aria-label="No changes">
			0<span className="csv-review-summary-word"> changes</span>
		</span>
	);
}

/**
 * The quiet half of the toolbar's review sentence: "4 changes · Show all 42
 * rows". Tertiary text, no border and no background, so entering review adds a
 * link to a sentence and no chrome at all. A review with nothing folded says
 * nothing.
 */
export function CsvReviewFoldAction({ folds }: { folds: CsvReviewFolds }) {
	if (!folds.count) return null;
	return (
		<>
			<span className="csv-review-fold-separator" aria-hidden="true">
				·
			</span>
			<button
				type="button"
				className="csv-review-fold-action"
				onClick={folds.toggleAll}
			>
				{folds.allShown ? (
					<>
						Show changes
						<span className="csv-review-fold-action-word"> only</span>
					</>
				) : (
					<>
						Show all
						<span className="csv-review-fold-action-word">
							{" "}
							{folds.rowCount} {folds.rowCount === 1 ? "row" : "rows"}
						</span>
					</>
				)}
			</button>
		</>
	);
}

export type CsvReviewFolds = {
	readonly rows: readonly CsvReviewRow[];
	readonly segments: readonly CsvReviewSegment[];
	readonly open: ReadonlySet<string>;
	/** How many bands the review has; zero means there is nothing to fold. */
	readonly count: number;
	/** How many rows the review shows once every band is open. */
	readonly rowCount: number;
	readonly allShown: boolean;
	readonly toggle: (key: string) => void;
	readonly toggleAll: () => void;
};

const NOTHING_OPEN: ReadonlySet<string> = new Set();

/**
 * The folded shape of a review, shared by the grid and the toolbar action.
 *
 * The toolbar says how many rows there are and opens or closes every band; the
 * grid draws them. Both read one state, so "Show all 42 rows" can never
 * disagree with what the table is showing.
 */
export function useCsvReviewFolds(
	model: Model | null,
	{
		search,
		filter,
		sort,
	}: { search: string; filter: CsvFilterGroup; sort: Sort },
): CsvReviewFolds {
	const rows = useMemo(
		() => (model ? visibleCsvReviewRows(model, { search, filter, sort }) : []),
		[model, search, filter, sort],
	);
	// A review with nothing to report has nothing to fold: it keeps every row
	// and the toolbar offers no action.
	const folding = useMemo(
		() => (model ? csvReviewChanges(model).count > 0 : false),
		[model],
	);
	const segments = useMemo(
		() => csvReviewSegments(rows, { folding }),
		[rows, folding],
	);
	const keys = useMemo(
		() =>
			segments.flatMap((segment) =>
				segment.type === "fold" ? [segment.key] : [],
			),
		[segments],
	);
	const [open, setOpen] = useState<ReadonlySet<string>>(NOTHING_OPEN);
	const allShown = keys.length > 0 && keys.every((key) => open.has(key));
	const toggle = useCallback(
		(key: string) =>
			setOpen((previous) => {
				const next = new Set(previous);
				if (!next.delete(key)) next.add(key);
				return next;
			}),
		[],
	);
	const toggleAll = useCallback(
		() => setOpen(allShown ? NOTHING_OPEN : new Set(keys)),
		[allShown, keys],
	);
	return {
		rows,
		segments,
		open,
		count: keys.length,
		rowCount: rows.length,
		allShown,
		toggle,
		toggleAll,
	};
}

type DisplayItem =
	| {
			readonly kind: "row";
			readonly key: string;
			readonly row: CsvReviewRow;
			readonly index: number;
			readonly height: number;
			readonly fold?: string;
	  }
	| {
			readonly kind: "band";
			readonly key: string;
			readonly segment: Extract<CsvReviewSegment, { type: "fold" }>;
			readonly height: number;
	  };

type FoldFlight = {
	readonly direction: "open" | "close";
	readonly animations: readonly Animation[];
	/** Where the reveal had got to, so a reversal picks up from there. */
	readonly progress: () => number;
};

const NO_FLIGHT: ReadonlyMap<string, "open" | "close"> = new Map();

export function CsvReviewGrid({
	model,
	initialScroll,
	widths,
	wrapped,
	rowHeight,
	search,
	filter,
	sort,
	folds: providedFolds,
}: {
	model: Model;
	initialScroll?: { x: number; y: number };
	widths: readonly number[];
	wrapped: readonly boolean[];
	rowHeight: (row: Model["rows"][number]) => number;
	search: string;
	filter: CsvFilterGroup;
	sort: Sort;
	folds?: CsvReviewFolds;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const startingScroll = useRef(initialScroll);
	const [scrollTop, setScrollTop] = useState(initialScroll?.y ?? 0);
	useLayoutEffect(() => {
		if (!scrollRef.current || !startingScroll.current) return;
		scrollRef.current.scrollLeft = startingScroll.current.x;
		scrollRef.current.scrollTop = startingScroll.current.y;
	}, []);
	// Seeded at a guess and corrected as soon as the scroller exists: the
	// virtual window is sized from this, so a window taller than the guess
	// painted a blank strip below the last row until the first scroll.
	const [viewportHeight, setViewportHeight] = useState(900);
	useLayoutEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller || typeof ResizeObserver === "undefined") return;
		const measure = () => setViewportHeight(scroller.clientHeight);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(scroller);
		return () => observer.disconnect();
	}, []);
	// A grid rendered on its own still folds; a grid the toolbar drives shares
	// that toolbar's state instead.
	const ownFolds = useCsvReviewFolds(model, { search, filter, sort });
	const folds = providedFolds ?? ownFolds;
	const [flight, setFlight] = useState(NO_FLIGHT);

	const items = useMemo(() => {
		const result: DisplayItem[] = [];
		for (const segment of folds.segments) {
			if (segment.type === "row") {
				result.push({
					kind: "row",
					key: segment.row.key,
					row: segment.row,
					index: segment.index,
					height: rowHeight(segment.row),
				});
				continue;
			}
			result.push({
				kind: "band",
				key: `band:${segment.key}`,
				segment,
				height: BAND_HEIGHT,
			});
			// A closing fold keeps its rows mounted until the reveal has run back
			// down to nothing; they are then dropped at zero height, so the drop
			// itself moves nothing.
			if (folds.open.has(segment.key) || flight.has(segment.key))
				for (const [offset, row] of segment.rows.entries())
					result.push({
						kind: "row",
						key: row.key,
						row,
						index: segment.index + offset,
						height: rowHeight(row),
						fold: segment.key,
					});
		}
		return result;
	}, [folds.segments, folds.open, flight, rowHeight]);

	// The offsets describe the settled grid and nothing else. An opening fold
	// is drawn by animating the height of the cells inside its rows, which
	// never changes the row list and never changes what `offsets` says a row is
	// worth — so the virtual window, the spacer rows and the scroll position
	// cannot drift out of step with a reveal that is still in flight. What is
	// in flight is only shorter than what the offsets claim, and only below the
	// fold, which is why a 2000-row file can open a fold near the bottom of its
	// scroll without the page moving underneath the reader.
	const offsets = useMemo(() => {
		const result = [0];
		for (const item of items)
			result.push(result[result.length - 1]! + item.height);
		return result;
	}, [items]);
	const virtual = items.length > 200;
	const start = virtual
		? Math.max(
				0,
				offsets.findIndex((offset) => offset >= Math.max(0, scrollTop - 400)) -
					1,
			)
		: 0;
	const end = virtual
		? Math.min(
				items.length,
				Math.max(
					start + 1,
					offsets.findIndex(
						(offset) => offset > scrollTop + viewportHeight + 400,
					) === -1
						? items.length
						: offsets.findIndex(
								(offset) => offset > scrollTop + viewportHeight + 400,
							),
				),
			)
		: items.length;

	const running = useRef(new Map<string, FoldFlight>());
	const previousOpen = useRef(folds.open);
	const previousSegments = useRef(folds.segments);
	// Decide what moves. A fold the reader cannot see is not worth animating,
	// and one above the viewport would drag the rows they are reading with it,
	// so its height is handed straight to the scroll offset instead.
	useLayoutEffect(() => {
		const before = previousOpen.current;
		const beforeSegments = previousSegments.current;
		previousOpen.current = folds.open;
		previousSegments.current = folds.segments;
		const scroller = scrollRef.current;
		if (!scroller || before === folds.open) return;
		if (beforeSegments !== folds.segments || !canAnimate()) return;
		const tops = foldTops(folds.segments, before, rowHeight);
		const top = scroller.scrollTop;
		const bottom = top + scroller.clientHeight;
		const flying: { key: string; direction: "open" | "close" }[] = [];
		let shift = 0;
		for (const segment of folds.segments) {
			if (segment.type !== "fold") continue;
			const opening = folds.open.has(segment.key);
			if (before.has(segment.key) === opening) continue;
			const total = segment.rows.reduce((sum, row) => sum + rowHeight(row), 0);
			const region = (tops.get(segment.key) ?? 0) + BAND_HEIGHT;
			if (region < top - BAND_HEIGHT) shift += opening ? total : -total;
			else if (region < bottom)
				flying.push({
					key: segment.key,
					direction: opening ? "open" : "close",
				});
		}
		if (shift) scroller.scrollTop = top + shift;
		if (!flying.length) return;
		setFlight((current) => {
			const next = new Map(current);
			for (const entry of flying) next.set(entry.key, entry.direction);
			return next;
		});
	}, [folds.open, folds.segments, rowHeight]);

	// Run them. This lands in the same commit as the render that mounted the
	// rows, so the grid is never painted at its settled height first.
	useLayoutEffect(() => {
		const scroller = scrollRef.current;
		if (!scroller) return;
		for (const [key, direction] of flight) {
			const started = running.current.get(key);
			if (started && started.direction === direction) continue;
			const flightRun = startFoldReveal(scroller, key, direction, started);
			if (!flightRun) {
				setFlight((current) => withoutKey(current, key));
				continue;
			}
			running.current.set(key, flightRun);
			Promise.all(flightRun.animations.map((animation) => animation.finished))
				.then(() => {
					if (running.current.get(key) !== flightRun) return;
					running.current.delete(key);
					setFlight((current) => withoutKey(current, key));
				})
				.catch(() => undefined);
		}
		for (const [key, entry] of running.current)
			if (!flight.has(key)) {
				running.current.delete(key);
				for (const animation of entry.animations) animation.cancel();
			}
	}, [flight, items]);

	return (
		<div
			ref={scrollRef}
			className="csv-review-scroll"
			onScroll={(event) => {
				setScrollTop(event.currentTarget.scrollTop);
				setViewportHeight(event.currentTarget.clientHeight);
			}}
		>
			<table
				className="csv-review-table"
				aria-label="CSV changes"
				aria-rowcount={folds.rows.length + 1}
				style={{ width: 44 + widths.reduce((a, b) => a + b, 0) }}
			>
				<colgroup>
					<col style={{ width: 44 }} />
					{model.columns.map((column, index) => (
						<col key={column.key} style={{ width: widths[index] }} />
					))}
				</colgroup>
				<thead>
					<tr aria-rowindex={1}>
						<th className="csv-review-gutter" scope="col">
							<span className="sr-only">Row change</span>
						</th>
						{model.columns.map((column) => {
							const Icon =
								CSV_TYPES.find(
									(type) =>
										type.type === (column.afterInfo ?? column.beforeInfo)?.type,
								)?.icon ?? CSV_TYPES[0]!.icon;
							const content = (
								<>
									<Icon
										className="csv-review-type-icon"
										size={18}
										aria-hidden="true"
									/>
									<span className="csv-review-header-name">{column.title}</span>
									<ChangeMark status={column.status} />
								</>
							);
							return (
								<th
									key={column.key}
									scope="col"
									data-diff-status={column.status}
								>
									{column.status !== "unchanged" ? (
										<CsvReviewTrigger
											label={`${column.title}: column ${column.status}`}
											title={column.title}
											className="csv-review-header-content"
											details={column.details}
										>
											{content}
										</CsvReviewTrigger>
									) : (
										<span className="csv-review-header-content">{content}</span>
									)}
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody>
					{start > 0 && (
						<tr aria-hidden="true">
							<td
								aria-label="Offscreen rows"
								colSpan={model.columns.length + 1}
								style={{ height: offsets[start], padding: 0, border: 0 }}
							/>
						</tr>
					)}
					{items.slice(start, end).map((item) =>
						item.kind === "band" ? (
							<CsvReviewBand
								key={item.key}
								segment={item.segment}
								columns={model.columns.length}
								open={folds.open.has(item.segment.key)}
								onToggle={folds.toggle}
							/>
						) : (
							<tr
								key={item.key}
								data-diff-status={item.row.status}
								data-fold={item.fold}
								data-fold-part={item.fold ? "row" : undefined}
								aria-rowindex={item.index + 2}
								style={
									{
										"--csv-review-cell-height": `${item.height}px`,
									} as CSSProperties
								}
							>
								<th className="csv-review-gutter" scope="row">
									<span className="csv-review-cell-box">
										{item.row.details.length ? (
											<CsvReviewTrigger
												label={`Row ${csvReviewRowNumber(item.row, item.index)}: moved`}
												title={item.row.cells[0]?.value || "Row moved"}
												details={item.row.details}
												className="csv-review-row-moved"
											>
												<ChangeMark status="modified" />
											</CsvReviewTrigger>
										) : (
											<span className="csv-review-row-number">
												{item.row.status === "added" ||
												item.row.status === "removed" ? (
													<ChangeMark status={item.row.status} />
												) : (
													csvReviewRowNumber(item.row, item.index)
												)}
											</span>
										)}
									</span>
								</th>
								{item.row.cells.map((cell, index) => {
									const column = model.columns[index]!;
									const info =
										item.row.status === "removed" || column.status === "removed"
											? column.beforeInfo
											: column.afterInfo;
									const height = item.height;
									const content = (
										<>
											<CsvReviewValue
												value={cell.value}
												info={info}
												search={search}
											/>
											<ChangeMark
												status={
													cell.status === "modified" ? "modified" : "unchanged"
												}
											/>
										</>
									);
									const value = (
										<span
											className="csv-review-clipped-value"
											style={{
												maxHeight:
													info?.type === "select" ? height - 8 : height - 20,
												whiteSpace: wrapped[index] ? "pre-wrap" : "nowrap",
											}}
										>
											{content}
										</span>
									);
									return (
										<td key={column.key} data-diff-status={cell.status}>
											<span className="csv-review-cell-box">
												{cell.status === "modified" ? (
													// Only a changed value has two sides worth a popover.
													// An added or removed cell's before is "not present"
													// by definition; its row colour already says so.
													<CsvReviewTrigger
														label={`${column.title}, row ${csvReviewRowNumber(item.row, item.index)}: changed`}
														title={`${column.title} · ${item.row.cells[0]?.value || `Row ${item.index + 1}`}`}
														details={[
															{
																label: "Value",
																before: cell.before,
																after: cell.after,
															},
														]}
														className="csv-review-cell-content"
													>
														{value}
													</CsvReviewTrigger>
												) : (
													<span className="csv-review-cell-content">
														{value}
													</span>
												)}
											</span>
										</td>
									);
								})}
							</tr>
						),
					)}
					{end < items.length && (
						<tr aria-hidden="true">
							<td
								aria-label="Offscreen rows"
								colSpan={model.columns.length + 1}
								style={{
									height: offsets[items.length]! - offsets[end]!,
									padding: 0,
									border: 0,
								}}
							/>
						</tr>
					)}
				</tbody>
			</table>
			{!items.length && (
				<div className="csv-review-empty">
					{model.rows.length
						? "No rows match your filters."
						: "This table has no rows."}
				</div>
			)}
		</div>
	);
}

function CsvReviewBand({
	segment,
	columns,
	open,
	onToggle,
}: {
	segment: Extract<CsvReviewSegment, { type: "fold" }>;
	columns: number;
	open: boolean;
	onToggle: (key: string) => void;
}) {
	const count = csvReviewFoldCountLabel(segment.rows.length);
	const range = segment.contiguous
		? csvReviewFoldRangeLabel(segment.first, segment.last)
		: null;
	const Chevron = open ? ChevronsDownUp : ChevronsUpDown;
	return (
		<tr
			className="csv-review-band"
			data-open={open ? "true" : undefined}
			// A closed band stands in for the rows it hides, so it answers to the
			// first of them. An open one stands in for nothing: its rows are there
			// and carry their own numbers.
			aria-rowindex={open ? undefined : segment.index + 2}
			style={
				{ "--csv-review-cell-height": `${BAND_HEIGHT}px` } as CSSProperties
			}
		>
			{/* No clipping box here, unlike a data row: a band is always exactly a
			    row tall and never animates, and a box that clips would become the
			    scrollport its label sticks to, stranding the label off the side of
			    a table scrolled sideways. */}
			<td
				className="csv-review-band-cell"
				colSpan={columns + 1}
				style={{ height: BAND_HEIGHT }}
			>
				<button
					type="button"
					className="csv-review-band-button"
					aria-expanded={open}
					aria-label={
						!segment.contiguous
							? count
							: segment.first === segment.last
								? `${count}, row ${segment.first}`
								: `${count}, rows ${segment.first} to ${segment.last}`
					}
					onClick={() => onToggle(segment.key)}
				>
					<span className="csv-review-band-label">
						<span className="csv-review-band-chevron">
							<Chevron size={13} aria-hidden="true" />
						</span>
						<span className="csv-review-band-count">{count}</span>
						<span className="csv-review-band-range">{range}</span>
					</span>
					<span className="csv-review-band-action" aria-hidden="true">
						{open ? "Hide" : "Show"}
					</span>
				</button>
			</td>
		</tr>
	);
}

function withoutKey<T>(
	map: ReadonlyMap<string, T>,
	key: string,
): ReadonlyMap<string, T> {
	if (!map.has(key)) return map;
	const next = new Map(map);
	next.delete(key);
	return next;
}

/** Where each band sits in a settled grid, measured from the first row. */
function foldTops(
	segments: readonly CsvReviewSegment[],
	open: ReadonlySet<string>,
	rowHeight: (row: CsvReviewRow) => number,
): Map<string, number> {
	const tops = new Map<string, number>();
	let offset = 0;
	for (const segment of segments) {
		if (segment.type === "row") {
			offset += rowHeight(segment.row);
			continue;
		}
		tops.set(segment.key, offset);
		offset += BAND_HEIGHT;
		if (open.has(segment.key))
			for (const row of segment.rows) offset += rowHeight(row);
	}
	return tops;
}

function canAnimate(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof Element.prototype.animate === "function" &&
		typeof window.matchMedia === "function" &&
		!window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * Reveal a run of rows the way a shade is drawn: the rows keep their own
 * height and the region they sit in grows, uncovering them from the top, so
 * nothing is ever squashed and the rows below move by exactly the height the
 * fold gains, in one linear motion.
 *
 * A table row cannot be animated directly — its height is the height of its
 * content, so shrinking the row means shrinking a box inside every cell. Each
 * cell already carries one, and it is the only thing that moves.
 */
function startFoldReveal(
	scroller: HTMLElement,
	key: string,
	direction: "open" | "close",
	previous: FoldFlight | undefined,
): FoldFlight | null {
	const rows = [
		...scroller.querySelectorAll<HTMLTableRowElement>(
			`tr[data-fold="${key}"][data-fold-part="row"]`,
		),
	];
	if (!rows.length) return null;
	// Only the rows the reader could watch are animated. Past the bottom of the
	// viewport there is nothing to see, and a fold big enough to run off the
	// screen would otherwise put hundreds of animations on the compositor.
	const reach = Math.max(
		BAND_HEIGHT,
		scroller.clientHeight +
			BAND_HEIGHT * 2 -
			Math.max(0, rows[0]!.offsetTop - scroller.scrollTop),
	);
	const heights: number[] = [];
	const offsets: number[] = [];
	let total = 0;
	for (const row of rows) {
		if (total >= reach) break;
		const height = Number.parseFloat(
			getComputedStyle(row).getPropertyValue("--csv-review-cell-height"),
		);
		if (!Number.isFinite(height) || height <= 0) break;
		offsets.push(total);
		heights.push(height);
		total += height;
	}
	if (!total) return null;
	const animated = rows.slice(0, heights.length);
	const from = previous
		? clamp(previous.progress(), 0, 1)
		: direction === "open"
			? 0
			: 1;
	const to = direction === "open" ? 1 : 0;
	if (previous) for (const animation of previous.animations) animation.cancel();
	if (from === to) return null;
	const duration = revealDuration(scroller) * Math.abs(to - from);
	const boxes: HTMLElement[][] = animated.map((row) => [
		...row.querySelectorAll<HTMLElement>(".csv-review-cell-box"),
	]);
	const height = (index: number, progress: number) =>
		clamp(progress * total - offsets[index]!, 0, heights[index]!);
	const animations: Animation[] = [];
	animated.forEach((_, index) => {
		// The row is revealed over its own slice of the reveal, so the region's
		// height stays exactly proportional to the eased progress every frame.
		const stops = [
			from,
			...[
				offsets[index]! / total,
				(offsets[index]! + heights[index]!) / total,
			].filter(
				(stop) => stop > Math.min(from, to) && stop < Math.max(from, to),
			),
			to,
		].sort((a, b) => (to > from ? a - b : b - a));
		const keyframes = stops.map((stop) => ({
			offset: Math.abs((stop - from) / (to - from)),
			height: `${height(index, stop)}px`,
		}));
		for (const box of boxes[index]!)
			animations.push(
				box.animate(keyframes, {
					duration,
					easing: "ease-out",
					fill: "forwards",
				}),
			);
	});
	if (!animations.length) return null;
	return {
		direction,
		animations,
		progress: () =>
			animated.reduce(
				(sum, row) => sum + row.getBoundingClientRect().height,
				0,
			) / total,
	};
}

function revealDuration(element: Element): number {
	const token = getComputedStyle(element)
		.getPropertyValue("--duration-slow")
		.trim();
	const parsed = Number.parseFloat(token);
	if (!Number.isFinite(parsed)) return 160;
	return token.endsWith("s") && !token.endsWith("ms") ? parsed * 1000 : parsed;
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value));
}

function ChangeMark({ status }: { status: Status }) {
	if (status === "unchanged") return null;
	const Icon =
		status === "added" ? Plus : status === "removed" ? Minus : Circle;
	return (
		<span
			className={`csv-review-mark is-${status}`}
			role="img"
			aria-label={status}
		>
			<Icon
				size={status === "modified" ? 6 : 13}
				fill={status === "modified" ? "currentColor" : "none"}
				aria-hidden="true"
			/>
		</span>
	);
}

function CsvReviewValue({
	value,
	info,
	search,
}: {
	value: string;
	info?: CsvColumnInfo;
	search: string;
}) {
	const highlighted = <HighlightedValue value={value} search={search} />;
	if (info?.type === "select" && value) {
		const color =
			info.options?.find((option) => option.value === value)?.color ?? "gray";
		return (
			<span
				className="csv-review-pill"
				style={
					{
						background: `var(--color-bg-tag-${color})`,
						color: `var(--color-text-tag-${color})`,
					} as CSSProperties
				}
			>
				{highlighted}
			</span>
		);
	}
	if (info?.type === "checkbox" && /^(yes|no|true|false|1|0)$/i.test(value)) {
		const checked = /^(yes|true|1)$/i.test(value);
		return (
			<span
				className={`csv-review-checkbox ${checked ? "is-checked" : ""}`}
				role="img"
				aria-label={value}
			>
				{checked ? (
					<Check size={12} aria-hidden="true" />
				) : (
					<Square size={14} aria-hidden="true" />
				)}
			</span>
		);
	}
	return highlighted;
}

function HighlightedValue({
	value,
	search,
}: {
	value: string;
	search: string;
}) {
	const matches = csvSearchMatches(value, search);
	if (!matches.length) return <>{value}</>;
	let end = 0;
	const result = matches.map((match) => {
		const before = value.slice(end, match.start);
		end = match.end;
		return (
			<span key={match.start}>
				{before}
				<mark>{value.slice(match.start, match.end)}</mark>
			</span>
		);
	});
	return (
		<>
			{result}
			{value.slice(end)}
		</>
	);
}
