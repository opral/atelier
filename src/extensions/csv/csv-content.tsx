import { parseCsv } from "./csv-data";

export function CsvContent({ content }: { readonly content: string }) {
	const table = parseCsv(content);
	return (
		<div className="atw:overflow-auto atw:p-4">
			<table
				className="atw:w-full atw:border-collapse atw:text-left atw:text-sm"
				data-atelier-csv-content=""
			>
				<thead>
					<tr>
						{table.columns.map((column, index) => (
							<th
								key={index}
								scope="col"
								className="atw:border atw:border-border atw:px-3 atw:py-2 atw:font-medium"
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
									className="atw:border atw:border-border atw:px-3 atw:py-2"
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
