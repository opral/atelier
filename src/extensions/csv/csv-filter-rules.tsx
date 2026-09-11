import { useLayoutEffect, useRef } from "react";
import { Plus, X } from "lucide-react";
import { CsvToolbarSelect } from "./csv-toolbar-select";
import { CsvFilterValue } from "./csv-filter-value";
import { CSV_TYPES } from "./csv-properties";
import type { CsvColumnInfo } from "./csv-metadata";
import {
	csvFilterOperatorNeedsValue,
	csvFilterOperators,
	csvFilterRuleOperator,
	type CsvFilterGroup,
	type CsvFilterOperator,
	type CsvFilterRule,
} from "./csv-filter";

export function CsvFilterRules({
	group,
	columns,
	columnInfo,
	rows,
	onChange,
}: {
	group: CsvFilterGroup;
	columns: readonly string[];
	columnInfo: readonly (CsvColumnInfo | undefined)[];
	rows: readonly { cells: readonly string[] }[];
	onChange: (group: CsvFilterGroup) => void;
}) {
	const rulesRef = useRef<HTMLDivElement>(null);
	const focusNewRule = useRef<string | null>(null);
	useLayoutEffect(() => {
		if (!focusNewRule.current) return;
		const rule = Array.from(
			rulesRef.current?.querySelectorAll<HTMLElement>("[data-rule-id]") ?? [],
		).find((node) => node.dataset.ruleId === focusNewRule.current);
		rule?.querySelector<HTMLElement>('[aria-label^="Filter column"]')?.focus();
		focusNewRule.current = null;
	}, [group.rules]);
	const rules = group.rules.length
		? group.rules
		: [{ id: "initial", column: null, value: "" }];
	const update = (id: string, patch: Partial<CsvFilterRule>) =>
		onChange({
			...group,
			rules: rules.map((rule) =>
				rule.id === id ? { ...rule, ...patch } : rule,
			),
		});
	return (
		<>
			<div className="csv-filter-mode">
				<span>Match</span>
				<CsvToolbarSelect
					label="Match rules"
					value={group.mode}
					options={[
						{ value: "all", label: "All" },
						{ value: "any", label: "Any" },
					]}
					onChange={(mode) =>
						onChange({ ...group, mode: mode as CsvFilterGroup["mode"] })
					}
				/>
				<span>of the following</span>
			</div>
			<div ref={rulesRef} className="csv-filter-rules">
				{rules.map((rule, index) => (
					<div
						key={rule.id}
						data-rule-id={rule.id}
						role="group"
						aria-label={`Filter rule ${index + 1}`}
						className="csv-filter-rule"
					>
						<div className="csv-filter-rule-heading">
							<span>
								{index === 0 ? "Where" : group.mode === "all" ? "And" : "Or"}
							</span>
							<button
								type="button"
								aria-label={`Remove rule ${index + 1}`}
								onClick={() => {
									const remaining = rules.filter((item) => item.id !== rule.id);
									focusNewRule.current =
										remaining[index]?.id ??
										remaining[index - 1]?.id ??
										"initial";
									onChange({ ...group, rules: remaining });
								}}
							>
								<X size={13} aria-hidden="true" />
							</button>
						</div>
						<CsvToolbarSelect
							label={
								index === 0 ? "Filter column" : `Filter column ${index + 1}`
							}
							value={rule.column === null ? "" : String(rule.column)}
							options={columns.map((label, columnIndex) => {
								const Icon = CSV_TYPES.find(
									(type) =>
										type.type === (columnInfo[columnIndex]?.type ?? "text"),
								)!.icon;
								return {
									value: String(columnIndex),
									label,
									icon: <Icon size={13} aria-hidden="true" />,
								};
							})}
							onChange={(value) => {
								const column = Number(value);
								if (rule.column === column) return;
								// A condition the new column also offers carries over;
								// otherwise the column's default applies.
								const operator =
									rule.operator &&
									csvFilterOperators(columnInfo[column]?.type).some(
										(option) => option.value === rule.operator,
									)
										? rule.operator
										: undefined;
								update(rule.id, { column, operator, value: "" });
							}}
						/>
						{rule.column !== null && (
							<CsvFilterCondition
								rule={rule}
								index={index}
								info={columnInfo[rule.column]}
								values={rows.map((row) => row.cells[rule.column!] ?? "")}
								onChange={(patch) => update(rule.id, patch)}
							/>
						)}
					</div>
				))}
			</div>
			<button
				type="button"
				className="csv-add-filter-rule"
				onClick={() => {
					const id = crypto.randomUUID();
					focusNewRule.current = id;
					onChange({
						...group,
						rules: [...rules, { id, column: null, value: "" }],
					});
				}}
			>
				<Plus size={13} aria-hidden="true" />
				Add rule
			</button>
		</>
	);
}

/** The rule's condition and, when the condition takes one, its value. */
function CsvFilterCondition({
	rule,
	index,
	info,
	values,
	onChange,
}: {
	rule: CsvFilterRule;
	index: number;
	info: CsvColumnInfo | undefined;
	values: readonly string[];
	onChange: (patch: Partial<CsvFilterRule>) => void;
}) {
	const type = info?.type;
	const operator = csvFilterRuleOperator(rule, type);
	const suffix = index === 0 ? "" : ` ${index + 1}`;
	return (
		<div className="csv-filter-rule-condition">
			<CsvToolbarSelect
				label={`Filter condition${suffix}`}
				fitOptions
				value={operator}
				options={csvFilterOperators(type).map((option) => ({
					value: option.value,
					label: option.label,
				}))}
				onChange={(value) =>
					onChange({ operator: value as CsvFilterOperator })
				}
			/>
			{csvFilterOperatorNeedsValue(operator) && (
				<CsvFilterValue
					key={`${rule.column}:${type ?? "text"}`}
					label={`Filter value${suffix}`}
					info={info}
					operator={operator}
					values={values}
					value={rule.value}
					onChange={(value) => onChange({ value })}
				/>
			)}
		</div>
	);
}
