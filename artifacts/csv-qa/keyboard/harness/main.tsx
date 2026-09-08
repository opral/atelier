import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import DataEditor, {
	GridCellKind,
	CompactSelection,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { providePropertyEditor } from "../../../../src/extensions/csv/csv-properties";
const types = ["text", "select", "checkbox", "date", "number", "email", "url"];
function App() {
	const [selection, setSelection] = useState({
		rows: CompactSelection.empty(),
		columns: CompactSelection.empty(),
	});
	const [rows, setRows] = useState([
		[
			"Hello world",
			"Existing",
			"yes",
			"2026-09-08",
			"12",
			"a@example.com",
			"https://example.com",
		],
		[
			"second",
			"漢字",
			"no",
			"2026-09-09",
			"34",
			"b@example.com",
			"https://openai.com",
		],
	]);
	window.qa = { rows };
	return (
		<div style={{ margin: 30 }}>
			<h2>CSV production property editors in real Glide grid</h2>
			<DataEditor
				width={1160}
				height={350}
				columns={types.map((title) => ({ title, width: 160 }))}
				rows={2}
				getCellContent={([c, r]) => ({
					kind: GridCellKind.Text,
					data: rows[r][c],
					displayData: rows[r][c],
					allowOverlay: true,
					activationBehaviorOverride: ["select", "checkbox", "date"].includes(
						types[c],
					)
						? undefined
						: "pointer-down",
					csvInfo: {
						id: String(c),
						header: types[c],
						index: c,
						type: types[c],
						options: [
							{ value: "Existing", color: "blue" },
							{ value: "漢字", color: "gray" },
						],
					},
				})}
				provideEditor={providePropertyEditor}
				onCellEdited={([c, r], v) =>
					setRows((old) =>
						old.map((row, i) =>
							i === r ? row.map((x, j) => (j === c ? v.data : x)) : row,
						),
					)
				}
				gridSelection={selection}
				onGridSelectionChange={(s) => {
					setSelection(s);
					window.selection = s.current?.cell;
					window.current = s.current;
				}}
				onCellClicked={(_cell, event) => {
					window.lastClick = {
						shift: event.shiftKey,
						ctrl: event.ctrlKey,
						meta: event.metaKey,
						alt: event.altKey,
					};
				}}
				cellActivationBehavior="single-click"
			/>
		</div>
	);
}
createRoot(document.getElementById("root")).render(<App />);
