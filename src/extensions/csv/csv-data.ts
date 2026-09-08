import { csvDocumentView, parseCsvDocument } from "./csv-document";
export { detectCsvFormat, normalizeCsvHeaders } from "./csv-format";

export type CsvRow = {
	readonly rowNumber: number;
	readonly cells: readonly string[];
};

export type CsvParseResult = {
	readonly columns: readonly string[];
	readonly rows: readonly CsvRow[];
	readonly warnings: readonly string[];
};

export function parseCsv(rawCsv: string): CsvParseResult {
	return csvDocumentView(parseCsvDocument(rawCsv));
}
