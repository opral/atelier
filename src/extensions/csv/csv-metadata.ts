import { readCsvViews, type CsvSavedView } from "./csv-views";
export type CsvColumnInfo = {
	id: string;
	header: string;
	index: number;
	type: "text" | "select" | "checkbox" | "date" | "number" | "email" | "url";
	options?: { value: string; color: string }[];
	wrap?: boolean;
};

export type CsvMetadata = {
	version: 1;
	columns: CsvColumnInfo[];
	views?: CsvSavedView[];
};

const columnTypes = new Set([
	"text",
	"select",
	"checkbox",
	"date",
	"number",
	"email",
	"url",
]);

export function isMetadataObject(
	value: unknown,
): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Unknown metadata versions remain intact on disk and render as ordinary CSV. */
export function readCsvMetadata(root: unknown): CsvMetadata | undefined {
	if (!isMetadataObject(root)) return undefined;
	const candidate = root.atelier_csv;
	if (
		!isMetadataObject(candidate) ||
		candidate.version !== 1 ||
		!Array.isArray(candidate.columns)
	)
		return undefined;
	const ids = new Set<string>();
	const indexes = new Set<number>();
	const columns: CsvColumnInfo[] = [];
	for (const column of candidate.columns) {
		if (
			!isMetadataObject(column) ||
			typeof column.id !== "string" ||
			!column.id ||
			ids.has(column.id) ||
			typeof column.header !== "string" ||
			!Number.isInteger(column.index) ||
			(column.index as number) < 0 ||
			indexes.has(column.index as number) ||
			typeof column.type !== "string" ||
			!columnTypes.has(column.type)
		)
			return undefined;
		let options: CsvColumnInfo["options"];
		if (column.options !== undefined) {
			if (!Array.isArray(column.options)) return undefined;
			options = [];
			const values = new Set<string>();
			for (const option of column.options) {
				if (
					!isMetadataObject(option) ||
					typeof option.value !== "string" ||
					typeof option.color !== "string" ||
					values.has(option.value)
				)
					return undefined;
				values.add(option.value);
				options.push({ value: option.value, color: option.color });
			}
		}
		ids.add(column.id);
		indexes.add(column.index as number);
		columns.push({
			id: column.id,
			header: column.header,
			index: column.index as number,
			type: column.type as CsvColumnInfo["type"],
			...(options ? { options } : {}),
			...(typeof column.wrap === "boolean" ? { wrap: column.wrap } : {}),
		});
	}
	return {
		version: 1,
		columns,
		...(candidate.views !== undefined
			? { views: readCsvViews(candidate.views) }
			: {}),
	};
}

/** Match exact raw headers; ambiguous external structural edits fall back to text. */
export function resolveColumnInfo(
	metadata: CsvMetadata | undefined,
	rawHeaders: readonly string[],
): (CsvColumnInfo | undefined)[] {
	return rawHeaders.map((header, index) => {
		const candidates =
			metadata?.columns.filter((column) => column.header === header) ?? [];
		const occurrences = rawHeaders.flatMap((value, position) =>
			value === header ? [position] : [],
		);
		if (candidates.length === 1 && occurrences.length === 1 && header !== "")
			return candidates[0];
		if (
			candidates.length !== occurrences.length ||
			!candidates.every((column) => occurrences.includes(column.index))
		)
			return undefined;
		return candidates.find((column) => column.index === index);
	});
}
