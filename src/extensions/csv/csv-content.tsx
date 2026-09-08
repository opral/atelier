import { parseCsv } from "./csv-data";

export function CsvContent({ content }: { readonly content: string }) {
	const table = parseCsv(content);
	return (
		<div className="overflow-auto p-4">
			<table
				className="w-full border-collapse text-left text-sm"
				data-atelier-csv-content=""
			>
				<thead>
					<tr>
						{table.columns.map((column, index) => (
							<th
								key={index}
								scope="col"
								className="border border-[var(--color-border-panel)] px-3 py-2 font-medium"
							>
								{column}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{table.rows.map((row) => (
						<tr key={row.rowNumber}>
							{row.cells.map((cell, index) => (
								<td
									key={index}
									className="border border-[var(--color-border-panel)] px-3 py-2"
								>
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
