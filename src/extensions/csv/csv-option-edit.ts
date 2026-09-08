import {
	csvDocumentView,
	setDocumentCells,
	type CsvDocument,
} from "./csv-document";
import type { CsvColumnInfo } from "./csv-metadata";

export type CsvOptionEdit =
	| { kind: "rename"; value: string; name: string }
	| { kind: "delete"; value: string }
	| { kind: "move"; value: string; before: string | null };

/** Option values are CSV strings: update data and descriptor as one file edit. */
export function editCsvOption(
	document: CsvDocument,
	columns: readonly CsvColumnInfo[],
	column: number,
	edit: CsvOptionEdit,
) {
	const info = columns[column];
	const options = [...(info?.options ?? [])];
	const index = options.findIndex((option) => option.value === edit.value);
	if (!info || info.type !== "select" || index < 0) return;
	const rows = csvDocumentView(document).rows;
	let next = document;
	if (edit.kind === "move") {
		if (
			edit.before === edit.value ||
			(edit.before !== null &&
				!options.some((option) => option.value === edit.before))
		)
			return;
		const [movedOption] = options.splice(index, 1);
		options.splice(
			edit.before === null
				? options.length
				: options.findIndex((option) => option.value === edit.before),
			0,
			movedOption!,
		);
	} else {
		const replacement = edit.kind === "rename" ? edit.name.trim() : "";
		if (edit.kind === "rename") {
			if (
				!replacement ||
				replacement === edit.value ||
				options.some((option) => option.value === replacement) ||
				rows.some((row) => row.cells[column] === replacement)
			)
				return;
			options[index] = { ...options[index]!, value: replacement };
		} else options.splice(index, 1);
		next = setDocumentCells(
			document,
			rows.flatMap((row, rowIndex) =>
				row.cells[column] === edit.value
					? [{ row: rowIndex, column, value: replacement }]
					: [],
			),
		);
	}
	const updated = [...columns];
	updated[column] = { ...info, options };
	return { document: next, columns: updated };
}
