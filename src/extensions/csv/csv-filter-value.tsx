import { Square, SquareCheck } from "lucide-react";
import type { CsvColumnInfo } from "./csv-metadata";
import { CsvPill } from "./csv-properties";
import { selectOptions } from "./csv-select-options";
import { CsvToolbarSelect } from "./csv-toolbar-select";

export function CsvFilterValue({
	info,
	label = "Filter value",
	values,
	value,
	onChange,
}: {
	info?: CsvColumnInfo;
	label?: string;
	values: readonly string[];
	value: string | readonly string[];
	onChange: (value: string | readonly string[]) => void;
}) {
	if (info?.type === "select") {
		// Declared options plus every value the column holds, coloured alike.
		const options = selectOptions(info, values);
		return (
			<CsvToolbarSelect
				label={label}
				multiple
				value={typeof value === "string" ? (value ? [value] : []) : value}
				placeholder="Choose options"
				searchable
				options={options.map((option) => ({
					value: option.value,
					label: option.value,
					content: <CsvPill {...option} />,
				}))}
				onChange={onChange}
			/>
		);
	}
	if (info?.type === "checkbox")
		return (
			<CsvToolbarSelect
				label={label}
				multiple
				value={typeof value === "string" ? (value ? [value] : []) : value}
				placeholder="Choose values"
				options={[
					{ value: "true", label: "Checked", icon: <SquareCheck size={14} /> },
					{ value: "false", label: "Unchecked", icon: <Square size={14} /> },
					{ value: "empty", label: "Empty" },
				]}
				onChange={onChange}
			/>
		);
	return (
		<input
			aria-label={label}
			type={
				info?.type === "date"
					? "date"
					: info?.type === "number"
						? "number"
						: "text"
			}
			step={info?.type === "number" ? "any" : undefined}
			placeholder={info?.type === "number" ? "Equals…" : "Contains…"}
			value={typeof value === "string" ? value : ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	);
}
