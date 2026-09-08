import { decodeFileDataToText } from "@/lib/decode-file-data";
import { csvDocumentView, parseCsvDocument } from "./csv-document";
import {
	readCsvMetadata,
	resolveColumnInfo,
	type CsvColumnInfo,
} from "./csv-metadata";
import type { CsvSavedView } from "./csv-views";

export type CsvReviewStatus = "unchanged" | "added" | "removed" | "modified";
export type CsvReviewDetail = {
	label: string;
	before?: string;
	after?: string;
	beforeColor?: string;
	afterColor?: string;
};
export type CsvReviewColumn = {
	key: string;
	title: string;
	beforeTitle?: string;
	beforeIndex: number | null;
	afterIndex: number | null;
	status: CsvReviewStatus;
	details: CsvReviewDetail[];
	beforeInfo?: CsvColumnInfo;
	afterInfo?: CsvColumnInfo;
};
export type CsvReviewCell = {
	before?: string;
	after?: string;
	value: string;
	status: CsvReviewStatus;
};
export type CsvReviewRow = {
	key: string;
	beforeIndex: number | null;
	afterIndex: number | null;
	status: CsvReviewStatus;
	cells: CsvReviewCell[];
	details: CsvReviewDetail[];
};
export type CsvReviewModel = {
	columns: CsvReviewColumn[];
	rows: CsvReviewRow[];
	settingsDetails: CsvReviewDetail[];
};
type Pair = { beforeIndex: number | null; afterIndex: number | null };

/** A union grid: removed records keep an inline slot, and details never add rows. */
export function buildCsvReviewModel(input: {
	beforeData: Uint8Array;
	afterData: Uint8Array;
	beforeMetadata?: unknown;
	afterMetadata?: unknown;
}): CsvReviewModel {
	const beforeDocument = parseCsvDocument(
		decodeFileDataToText(input.beforeData),
	);
	const afterDocument = parseCsvDocument(decodeFileDataToText(input.afterData));
	const before = csvDocumentView(beforeDocument);
	const after = csvDocumentView(afterDocument);
	const beforeHeaders = before.columns.map(
		(_, i) => beforeDocument.records[0]?.cells[i] ?? "",
	);
	const afterHeaders = after.columns.map(
		(_, i) => afterDocument.records[0]?.cells[i] ?? "",
	);
	const beforeMetadata = readCsvMetadata(input.beforeMetadata);
	const afterMetadata = readCsvMetadata(input.afterMetadata);
	const beforeInfo = resolveColumnInfo(beforeMetadata, beforeHeaders);
	const afterInfo = resolveColumnInfo(afterMetadata, afterHeaders);
	const matchedColumns = new Map<number, number>();
	const usedColumns = new Set<number>();
	const matchColumn = (
		afterIndex: number,
		predicate: (beforeIndex: number) => boolean,
	) => {
		const beforeIndex = beforeHeaders.findIndex(
			(_, i) => !usedColumns.has(i) && predicate(i),
		);
		if (beforeIndex < 0) return;
		matchedColumns.set(afterIndex, beforeIndex);
		usedColumns.add(beforeIndex);
	};
	afterHeaders.forEach((_, i) => {
		const id = afterInfo[i]?.id;
		if (id) matchColumn(i, (j) => beforeInfo[j]?.id === id);
	});
	// Once both sides declare identity, matching names or values cannot
	// override a delete/recreate with a different stable column ID.
	const compatibleIdentity = (a: number, b: number) =>
		!afterInfo[a]?.id ||
		!beforeInfo[b]?.id ||
		afterInfo[a]!.id === beforeInfo[b]!.id;
	afterHeaders.forEach((header, i) => {
		if (!matchedColumns.has(i))
			matchColumn(
				i,
				(j) => compatibleIdentity(i, j) && beforeHeaders[j] === header,
			);
	});
	// Without stable metadata IDs, recognize a renamed column only when its data
	// uniquely agrees. Never pair unrelated deleted/inserted columns by position.
	if (before.rows.length > 0 && before.rows.length === after.rows.length) {
		afterHeaders.forEach((_, i) => {
			if (matchedColumns.has(i)) return;
			const candidates = beforeHeaders.flatMap((_header, j) =>
				!usedColumns.has(j) &&
				compatibleIdentity(i, j) &&
				before.rows.some((row) => (row.cells[j] ?? "").trim() !== "") &&
				before.rows.every((row, r) => row.cells[j] === after.rows[r]?.cells[i])
					? [j]
					: [],
			);
			if (candidates.length === 1) matchColumn(i, (j) => j === candidates[0]);
		});
	}
	const columnPairs = unionPairs(
		beforeHeaders.length,
		afterHeaders.length,
		matchedColumns,
	);
	const commonColumns = [...matchedColumns].sort((a, b) => a[0] - b[0]);
	const beforeOrder = [...commonColumns].sort((a, b) => a[1] - b[1]);
	const columns = columnPairs.map((pair): CsvReviewColumn => {
		const { beforeIndex: b, afterIndex: a } = pair;
		const details: CsvReviewDetail[] = [];
		const oldInfo = b === null ? undefined : beforeInfo[b];
		const newInfo = a === null ? undefined : afterInfo[a];
		if (b === null)
			details.push({ label: "Column added", after: after.columns[a!] });
		if (a === null)
			details.push({ label: "Column removed", before: before.columns[b!] });
		if (b !== null && a !== null) {
			detail(details, "Column name", beforeHeaders[b]!, afterHeaders[a]!);
			detail(
				details,
				"Property type",
				oldInfo?.type ?? "text",
				newInfo?.type ?? "text",
			);
			detail(
				details,
				"Wrap content",
				oldInfo?.wrap ? "On" : "Off",
				newInfo?.wrap ? "On" : "Off",
			);
			details.push(
				...optionDetails(oldInfo?.options ?? [], newInfo?.options ?? []),
			);
			const priorRank = beforeOrder.findIndex((entry) => entry[1] === b);
			const nextRank = commonColumns.findIndex((entry) => entry[0] === a);
			if (priorRank !== nextRank)
				detail(details, "Column position", String(b + 1), String(a + 1));
		}
		return {
			key: b !== null ? `column-before-${b}` : `column-after-${a}`,
			title: a !== null ? after.columns[a]! : before.columns[b!]!,
			...(b !== null ? { beforeTitle: before.columns[b]! } : {}),
			...pair,
			status:
				b === null
					? "added"
					: a === null
						? "removed"
						: details.length
							? "modified"
							: "unchanged",
			details,
			beforeInfo: oldInfo,
			afterInfo: newInfo,
		};
	});
	const rowMatches = new Map<number, number>();
	const usedRows = new Set<number>();
	const matchSignatures = (
		oldSignatures: string[],
		newSignatures: string[],
		unique: boolean,
	) => {
		const available = new Map<string, number[]>();
		oldSignatures.forEach((signature, i) => {
			if (!usedRows.has(i) && signature) {
				const bucket = available.get(signature) ?? [];
				bucket.push(i);
				available.set(signature, bucket);
			}
		});
		const counts = new Map<string, number>();
		newSignatures.forEach((signature, i) => {
			if (!rowMatches.has(i))
				counts.set(signature, (counts.get(signature) ?? 0) + 1);
		});
		newSignatures.forEach((signature, i) => {
			if (rowMatches.has(i)) return;
			const candidates = available.get(signature);
			if (
				!candidates?.length ||
				(unique && (candidates.length !== 1 || counts.get(signature) !== 1))
			)
				return;
			const b = candidates.shift()!;
			rowMatches.set(i, b);
			usedRows.add(b);
		});
	};
	if (commonColumns.length) {
		matchSignatures(
			before.rows.map((row) =>
				JSON.stringify(commonColumns.map(([, b]) => row.cells[b] ?? "")),
			),
			after.rows.map((row) =>
				JSON.stringify(commonColumns.map(([a]) => row.cells[a] ?? "")),
			),
			false,
		);
		// A unique value in the first shared column is the conventional CSV row key.
		const [identityAfter, identityBefore] = beforeOrder[0]!;
		const supportingColumns = commonColumns.filter(
			([, b]) => b !== identityBefore,
		);
		matchSignatures(
			before.rows.map((row) => row.cells[identityBefore] ?? ""),
			after.rows.map((row) => row.cells[identityAfter] ?? ""),
			true,
		);
		// A changed key needs corroboration: one coincidentally shared role or
		// stage must not turn an unrelated removal/addition into a cell edit.
		const candidates = new Map<number, Set<number>>();
		for (const [a, b] of supportingColumns) {
			const oldValues = new Map<string, number[]>();
			before.rows.forEach((row, i) => {
				const value = row.cells[b] ?? "";
				if (usedRows.has(i) || !value.trim()) return;
				const bucket = oldValues.get(value) ?? [];
				bucket.push(i);
				oldValues.set(value, bucket);
			});
			after.rows.forEach((row, i) => {
				if (rowMatches.has(i)) return;
				const bucket = oldValues.get(row.cells[a] ?? "");
				if (bucket?.length !== 1) return;
				const set = candidates.get(i) ?? new Set<number>();
				set.add(bucket[0]!);
				candidates.set(i, set);
			});
		}
		const supported = new Map<number, number[]>();
		const beforeCandidateCounts = new Map<number, number>();
		for (const [a, candidatesBefore] of candidates) {
			const qualifying = [...candidatesBefore].filter(
				(b) =>
					supportingColumns.filter(([ac, bc]) => {
						const oldValue = before.rows[b]?.cells[bc] ?? "";
						return (
							oldValue.trim() !== "" && oldValue === after.rows[a]?.cells[ac]
						);
					}).length >= 2,
			);
			supported.set(a, qualifying);
			for (const b of qualifying)
				beforeCandidateCounts.set(b, (beforeCandidateCounts.get(b) ?? 0) + 1);
		}
		for (const [a, qualifying] of supported) {
			if (
				qualifying.length !== 1 ||
				beforeCandidateCounts.get(qualifying[0]!) !== 1
			)
				continue;
			rowMatches.set(a, qualifying[0]!);
			usedRows.add(qualifying[0]!);
		}
	}
	const rowsInAfterOrder = [...rowMatches].sort((a, b) => a[0] - b[0]);
	const rowsInBeforeOrder = [...rowMatches].sort((a, b) => a[1] - b[1]);
	const beforeRanks = new Map(
		rowsInBeforeOrder.map(([, beforeIndex], rank) => [beforeIndex, rank]),
	);
	const afterRanks = new Map(
		rowsInAfterOrder.map(([afterIndex], rank) => [afterIndex, rank]),
	);
	const rows = unionPairs(
		before.rows.length,
		after.rows.length,
		rowMatches,
	).map((pair): CsvReviewRow => {
		const { beforeIndex: b, afterIndex: a } = pair;
		const details: CsvReviewDetail[] = [];
		if (b !== null && a !== null && beforeRanks.get(b) !== afterRanks.get(a)) {
			details.push({
				label: "Row position",
				before: String(b + 1),
				after: String(a + 1),
			});
		}
		const cells = columns.map((column): CsvReviewCell => {
			const previous =
				b !== null && column.beforeIndex !== null
					? (before.rows[b]?.cells[column.beforeIndex] ?? "")
					: undefined;
			const next =
				a !== null && column.afterIndex !== null
					? (after.rows[a]?.cells[column.afterIndex] ?? "")
					: undefined;
			return {
				before: previous,
				after: next,
				value: next ?? previous ?? "",
				status:
					previous === next
						? "unchanged"
						: previous === undefined
							? "added"
							: next === undefined
								? "removed"
								: "modified",
			};
		});
		return {
			key: b !== null ? `row-before-${b}` : `row-after-${a}`,
			...pair,
			cells,
			details,
			status:
				b === null
					? "added"
					: a === null
						? "removed"
						: details.length || cells.some((cell) => cell.status === "modified")
							? "modified"
							: "unchanged",
		};
	});
	return {
		columns,
		rows,
		settingsDetails: viewDetails(
			beforeMetadata?.views ?? [],
			afterMetadata?.views ?? [],
			beforeInfo,
			afterInfo,
		),
	};
}

/** Use the current order, anchoring a removal before its next surviving neighbor. */
function unionPairs(
	beforeCount: number,
	afterCount: number,
	matches: Map<number, number>,
): Pair[] {
	const matchedBefore = new Set(matches.values());
	const removedBeforeAnchor = new Map<number | null, number[]>();
	let anchor: number | null = null;
	for (let i = beforeCount - 1; i >= 0; i--) {
		if (matchedBefore.has(i)) anchor = i;
		else
			removedBeforeAnchor.set(anchor, [
				i,
				...(removedBeforeAnchor.get(anchor) ?? []),
			]);
	}
	const nextAnchor: (number | null)[] = [];
	let next: number | null = null;
	for (let a = afterCount - 1; a >= 0; a--) {
		if (matches.has(a)) next = matches.get(a)!;
		nextAnchor[a] = next;
	}
	const result: Pair[] = [];
	const emitRemoved = (beforeAnchor: number | null) => {
		for (const removed of removedBeforeAnchor.get(beforeAnchor) ?? [])
			result.push({ beforeIndex: removed, afterIndex: null });
		removedBeforeAnchor.delete(beforeAnchor);
	};
	for (let a = 0; a < afterCount; a++) {
		// A replacement reads old → new within a gap, rather than moving the
		// deleted record below its newly inserted replacement.
		emitRemoved(nextAnchor[a] ?? null);
		result.push({ beforeIndex: matches.get(a) ?? null, afterIndex: a });
	}
	emitRemoved(null);
	return result;
}
function detail(
	details: CsvReviewDetail[],
	label: string,
	before: string,
	after: string,
) {
	if (before !== after) details.push({ label, before, after });
}
function optionDetails(
	before: NonNullable<CsvColumnInfo["options"]>,
	after: NonNullable<CsvColumnInfo["options"]>,
): CsvReviewDetail[] {
	const details: CsvReviewDetail[] = [];
	// Options currently have no stable IDs: a rename is honestly represented as
	// the old choice removed and the new choice added, never guessed from color.
	for (const option of before) {
		const next = after.find((candidate) => candidate.value === option.value);
		if (!next)
			details.push({
				label: "Option removed",
				before: option.value,
				beforeColor: option.color,
			});
		else if (option.color !== next.color)
			details.push({
				label: `Color · ${option.value}`,
				before: option.value,
				after: option.value,
				beforeColor: option.color,
				afterColor: next.color,
			});
	}
	for (const option of after)
		if (!before.some((candidate) => candidate.value === option.value))
			details.push({
				label: "Option added",
				after: option.value,
				afterColor: option.color,
			});
	const previousOrder = before
		.filter((option) => after.some((next) => next.value === option.value))
		.map((option) => option.value);
	const nextOrder = after
		.filter((option) =>
			before.some((previous) => previous.value === option.value),
		)
		.map((option) => option.value);
	if (JSON.stringify(previousOrder) !== JSON.stringify(nextOrder))
		details.push({
			label: "Option order",
			before: before.map((option) => option.value).join(" → "),
			after: after.map((option) => option.value).join(" → "),
		});
	return details;
}
function viewDetails(
	before: CsvSavedView[],
	after: CsvSavedView[],
	beforeColumns: (CsvColumnInfo | undefined)[],
	afterColumns: (CsvColumnInfo | undefined)[],
): CsvReviewDetail[] {
	const details: CsvReviewDetail[] = [];
	const describeFilter = (
		view: CsvSavedView,
		columns: (CsvColumnInfo | undefined)[],
	) =>
		view.filter.rules
			.map(
				(rule) =>
					`${columns.find((column) => column?.id === rule.columnId)?.header ?? "Removed column"}: ${Array.isArray(rule.value) ? [...rule.value].sort().join(" or ") : rule.value}`,
			)
			.join(view.filter.mode === "all" ? " AND " : " OR ") || "No filter";
	const describeSort = (
		view: CsvSavedView,
		columns: (CsvColumnInfo | undefined)[],
	) =>
		view.sort
			? `${columns.find((column) => column?.id === view.sort!.columnId)?.header ?? "Removed column"} · ${view.sort.direction === 1 ? "Ascending" : "Descending"}`
			: "No sort";
	for (const previous of before) {
		const next = after.find((view) => view.id === previous.id);
		if (!next) {
			details.push({ label: "View removed", before: previous.name });
			continue;
		}
		detail(details, "View name", previous.name, next.name);
		detail(
			details,
			`${next.name} · Filter`,
			describeFilter(previous, beforeColumns),
			describeFilter(next, afterColumns),
		);
		detail(
			details,
			`${next.name} · Sort`,
			describeSort(previous, beforeColumns),
			describeSort(next, afterColumns),
		);
		detail(
			details,
			`${next.name} · Search`,
			previous.search || "None",
			next.search || "None",
		);
		const ids = new Set(
			[...previous.widths, ...next.widths].map((column) => column.columnId),
		);
		for (const id of ids) {
			const oldLayout = previous.widths.find(
				(column) => column.columnId === id,
			);
			const newLayout = next.widths.find((column) => column.columnId === id);
			const name =
				afterColumns.find((column) => column?.id === id)?.header ??
				beforeColumns.find((column) => column?.id === id)?.header ??
				"Removed column";
			detail(
				details,
				`${next.name} · ${name} width`,
				oldLayout ? `${oldLayout.width}px` : "Automatic",
				newLayout ? `${newLayout.width}px` : "Automatic",
			);
			detail(
				details,
				`${next.name} · ${name} wrap`,
				oldLayout?.wrap ? "On" : "Off",
				newLayout?.wrap ? "On" : "Off",
			);
		}
	}
	for (const view of after)
		if (!before.some((previous) => previous.id === view.id))
			details.push({ label: "View added", after: view.name });
	return details;
}
