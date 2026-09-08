import { compareCsvValues } from "./csv-sort";
import {
	useLayoutEffect,
	useRef,
	useMemo,
	useState,
	type CSSProperties,
} from "react";
import { Plus, Minus, Circle, Check, Square } from "lucide-react";
import { CSV_TYPES } from "./csv-properties";
import { CsvReviewTrigger } from "./csv-review-popover";
import type { buildCsvReviewModel } from "./csv-review-model";
import type { CsvColumnInfo } from "./csv-metadata";
import type { CsvFilterGroup } from "./csv-filter";
import { matchesCsvFilterGroup } from "./csv-filter";
import { csvSearchMatches } from "./csv-search-highlight";
import "./csv-review-grid.css";

type Model = ReturnType<typeof buildCsvReviewModel>;
type Status = Model["columns"][number]["status"];

export function CsvReviewSummary({ model }: { model: Model }) {
	const addedRows = model.rows.filter((r) => r.status === "added").length;
	const removedRows = model.rows.filter((r) => r.status === "removed").length;
	const editedCells = model.rows
		.flatMap((r) => r.cells)
		.filter((c) => c.status === "modified").length;
	const movedRows = model.rows.filter((r) => r.details.length > 0);
	const columnChanges = model.columns.filter(
		(c) => c.status !== "unchanged",
	).length;
	const count =
		addedRows +
		movedRows.length +
		removedRows +
		editedCells +
		columnChanges +
		model.settingsDetails.length;
	const details = [
		...(addedRows ? [{ label: "Rows added", after: String(addedRows) }] : []),
		...(removedRows
			? [{ label: "Rows removed", before: String(removedRows) }]
			: []),
		...(editedCells
			? [
					{
						label: "Cells edited",
						before: "Previous values",
						after: `${editedCells} updated ${editedCells === 1 ? "cell" : "cells"}`,
					},
				]
			: []),
		...model.columns
			.filter((c) => c.status !== "unchanged")
			.flatMap((c) =>
				c.details.map((d) => ({ ...d, label: `${c.title} · ${d.label}` })),
			),
		...movedRows.flatMap((row) =>
			row.details.map((detail) => ({
				...detail,
				label: `${row.cells[0]?.value || "Row"} · ${detail.label}`,
			})),
		),
		...model.settingsDetails,
	];
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

export function CsvReviewGrid({
	model,
	initialScroll,
	widths,
	wrapped,
	rowHeight,
	search,
	filter,
	sort,
}: {
	model: Model;
	initialScroll?: { x: number; y: number };
	widths: readonly number[];
	wrapped: readonly boolean[];
	rowHeight: (row: Model["rows"][number]) => number;
	search: string;
	filter: CsvFilterGroup;
	sort: { column: number; direction: 1 | -1 } | null;
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const startingScroll = useRef(initialScroll);
	const [scrollTop, setScrollTop] = useState(initialScroll?.y ?? 0);
	useLayoutEffect(() => {
		if (!scrollRef.current || !startingScroll.current) return;
		scrollRef.current.scrollLeft = startingScroll.current.x;
		scrollRef.current.scrollTop = startingScroll.current.y;
	}, []);
	const [viewportHeight, setViewportHeight] = useState(900);
	const rows = useMemo(() => {
		// Toolbar rule indices refer to the current file. Removed columns remain
		// visible for review, but do not shift the meaning of existing filters.
		const info: (CsvColumnInfo | undefined)[] = [];
		for (const column of model.columns)
			if (column.afterIndex !== null)
				info[column.afterIndex] = column.afterInfo;
		const result = model.rows.filter((row) => {
			const values: string[] = [];
			model.columns.forEach((column, index) => {
				if (column.afterIndex !== null)
					values[column.afterIndex] = row.cells[index]?.value ?? "";
			});
			return (
				(!search ||
					row.cells.some((c) =>
						`${c.before ?? ""}\n${c.after ?? ""}`
							.toLowerCase()
							.includes(search.toLowerCase()),
					)) &&
				matchesCsvFilterGroup(values, filter, info)
			);
		});
		if (sort) {
			const column = model.columns.findIndex(
				(c) => c.afterIndex === sort.column,
			);
			if (column >= 0)
				result.sort((a, b) => {
					const av = a.cells[column]?.value ?? "",
						bv = b.cells[column]?.value ?? "";
					return (
						sort.direction * compareCsvValues(av, bv, info[sort.column]?.type)
					);
				});
		}
		return result;
	}, [model, search, filter, sort]);
	const offsets = useMemo(() => {
		const result = [0];
		for (const row of rows)
			result.push(result[result.length - 1]! + rowHeight(row));
		return result;
	}, [rows, rowHeight]);
	const virtual = rows.length > 200;
	const start = virtual
		? Math.max(
				0,
				offsets.findIndex((offset) => offset >= Math.max(0, scrollTop - 400)) -
					1,
			)
		: 0;
	const end = virtual
		? Math.min(
				rows.length,
				Math.max(
					start + 1,
					offsets.findIndex(
						(offset) => offset > scrollTop + viewportHeight + 400,
					) === -1
						? rows.length
						: offsets.findIndex(
								(offset) => offset > scrollTop + viewportHeight + 400,
							),
				),
			)
		: rows.length;
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
				aria-rowcount={rows.length + 1}
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
					{rows.slice(start, end).map((row, position) => (
						<tr
							key={row.key}
							data-diff-status={row.status}
							aria-rowindex={start + position + 2}
						>
							<th
								className="csv-review-gutter"
								scope="row"
								style={{ height: rowHeight(row) }}
							>
								{row.details.length ? (
									<CsvReviewTrigger
										label={`Row ${(row.afterIndex ?? position) + 1}: moved`}
										title={row.cells[0]?.value || "Row moved"}
										details={row.details}
										className="csv-review-row-moved"
									>
										<ChangeMark status="modified" />
									</CsvReviewTrigger>
								) : (
									<span className="csv-review-row-number">
										{row.status === "added" || row.status === "removed" ? (
											<ChangeMark status={row.status} />
										) : (
											(row.afterIndex ?? row.beforeIndex ?? position) + 1
										)}
									</span>
								)}
							</th>
							{row.cells.map((cell, index) => {
								const column = model.columns[index]!;
								const info =
									row.status === "removed" || column.status === "removed"
										? column.beforeInfo
										: column.afterInfo;
								const height = rowHeight(row);
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
								return (
									<td
										key={column.key}
										data-diff-status={cell.status}
										style={{ height }}
									>
										{cell.status !== "unchanged" ? (
											<CsvReviewTrigger
												label={`${column.title}, row ${(row.afterIndex ?? row.beforeIndex ?? position) + 1}: ${cell.status === "modified" ? "changed" : cell.status}`}
												title={`${column.title} · ${row.cells[0]?.value || `Row ${position + 1}`}`}
												details={[
													{
														label: "Value",
														before: cell.before,
														after: cell.after,
													},
												]}
												className="csv-review-cell-content"
											>
												<span
													className="csv-review-clipped-value"
													style={{
														maxHeight:
															info?.type === "select"
																? height - 8
																: height - 20,
														whiteSpace: wrapped[index] ? "pre-wrap" : "nowrap",
													}}
												>
													{content}
												</span>
											</CsvReviewTrigger>
										) : (
											<span className="csv-review-cell-content">
												<span
													className="csv-review-clipped-value"
													style={{
														maxHeight:
															info?.type === "select"
																? height - 8
																: height - 20,
														whiteSpace: wrapped[index] ? "pre-wrap" : "nowrap",
													}}
												>
													{content}
												</span>
											</span>
										)}
									</td>
								);
							})}
						</tr>
					))}
					{end < rows.length && (
						<tr aria-hidden="true">
							<td
								aria-label="Offscreen rows"
								colSpan={model.columns.length + 1}
								style={{
									height: offsets[rows.length]! - offsets[end]!,
									padding: 0,
									border: 0,
								}}
							/>
						</tr>
					)}
				</tbody>
			</table>
			{!rows.length && (
				<div className="csv-review-empty">
					{model.rows.length
						? "No rows match your filters."
						: "This table has no rows."}
				</div>
			)}
		</div>
	);
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
