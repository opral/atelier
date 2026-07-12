import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
	AlignLeft,
	Braces,
	CalendarDays,
	Hash,
	Plus,
	SquareCheckBig,
	Tag,
	Type,
	UserRound,
	X,
} from "lucide-react";
import {
	parseFrontmatterSource,
	stringifyFrontmatterValue,
	type FrontmatterRecord,
} from "../editor/frontmatter-value";

type FrontmatterMode = "fields" | "yaml";

function replaceRecordEntry(
	record: FrontmatterRecord,
	index: number,
	entry: readonly [string, unknown] | null,
): FrontmatterRecord {
	const entries = Object.entries(record);
	if (entry === null) entries.splice(index, 1);
	else entries[index] = [entry[0], entry[1]];
	return Object.fromEntries(entries);
}

function availableFieldName(
	record: FrontmatterRecord,
	requested: string,
): string {
	if (!(requested in record)) return requested;
	let suffix = 2;
	while (`${requested}${suffix}` in record) suffix += 1;
	return `${requested}${suffix}`;
}

function availableRenamedFieldName(
	record: FrontmatterRecord,
	index: number,
	requested: string,
): string {
	const otherEntries = Object.entries(record).filter(
		(_, entryIndex) => entryIndex !== index,
	);
	return availableFieldName(Object.fromEntries(otherEntries), requested);
}

function isScalar(value: unknown): boolean {
	if (typeof value === "number") {
		return (
			Number.isFinite(value) &&
			(!Number.isInteger(value) || Number.isSafeInteger(value))
		);
	}
	return value === null || ["string", "boolean"].includes(typeof value);
}

function supportsFieldsMode(record: FrontmatterRecord | null): boolean {
	if (!record) return false;
	return Object.values(record).every((value) => {
		if (isScalar(value)) return true;
		if (Array.isArray(value)) return value.every(isScalar);
		if (value && typeof value === "object") {
			return Object.values(value as FrontmatterRecord).every(isScalar);
		}
		return false;
	});
}

function supportsLosslessFieldsSource(
	source: string,
	record: FrontmatterRecord | null,
): boolean {
	if (!supportsFieldsMode(record)) return false;
	const numericTokens = source.match(/[+-]?\d[\d_]{15,}/g) ?? [];
	if (
		numericTokens.some((token) => {
			try {
				const integer = BigInt(token.replaceAll("_", ""));
				return (
					integer > BigInt(Number.MAX_SAFE_INTEGER) ||
					integer < BigInt(Number.MIN_SAFE_INTEGER)
				);
			} catch {
				return true;
			}
		})
	) {
		return false;
	}
	// Structured editing intentionally handles the common, plain YAML subset.
	// Keep comments, anchors, tags, merge keys, and block scalars in raw mode so
	// normalizing a field cannot discard source-level YAML information.
	return !/(^|\s)#|(^|\s)[&*!][^\s]+|(^|\s)<<\s*:|:\s*[>|][+-]?\s*$/m.test(
		source,
	);
}

function FieldKeyInput({
	value,
	ariaLabel,
	onCommit,
}: {
	readonly value: string;
	readonly ariaLabel: string;
	readonly onCommit: (value: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const commit = () => {
		const requested = draft.trim();
		if (!requested) {
			setDraft(value);
			return;
		}
		onCommit(requested);
	};
	return (
		<input
			className="markdown-frontmatter-input markdown-frontmatter-key"
			value={draft}
			aria-label={ariaLabel}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					event.currentTarget.blur();
				}
				if (event.key === "Escape") {
					event.preventDefault();
					setDraft(value);
					event.currentTarget.blur();
				}
			}}
		/>
	);
}

function FieldTypeIcon({
	fieldKey,
	value,
}: {
	readonly fieldKey: string;
	readonly value: unknown;
}) {
	const normalizedKey = fieldKey.toLowerCase();
	if (typeof value === "boolean") return <SquareCheckBig aria-hidden />;
	if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return <CalendarDays aria-hidden />;
	}
	if (Array.isArray(value)) return <Tag aria-hidden />;
	if (typeof value === "number") return <Hash aria-hidden />;
	if (value && typeof value === "object") {
		return /author|owner|person|user/.test(normalizedKey) ? (
			<UserRound aria-hidden />
		) : (
			<Braces aria-hidden />
		);
	}
	if (/title|name|slug/.test(normalizedKey)) return <Type aria-hidden />;
	return <AlignLeft aria-hidden />;
}

function parseEditableNumber(value: string): number | null {
	const normalized = value.trim();
	if (!normalized) return null;
	const number = Number(normalized);
	if (!Number.isFinite(number)) return null;
	if (Number.isInteger(number)) {
		return Number.isSafeInteger(number) ? number : null;
	}
	const significantDigits = (normalized.split(/[eE]/, 1)[0] ?? "")
		.replace(/\D/g, "")
		.replace(/^0+/, "");
	return significantDigits.length <= 15 ? number : null;
}

function NumberField({
	label,
	value,
	onChange,
}: {
	readonly label: string;
	readonly value: number;
	readonly onChange: (value: unknown) => void;
}) {
	const [draft, setDraft] = useState(String(value));
	useEffect(() => setDraft(String(value)), [value]);
	const parsedDraft = parseEditableNumber(draft);
	const invalidDraft = draft.trim() !== "" && parsedDraft === null;
	return (
		<input
			className="markdown-frontmatter-input markdown-frontmatter-value"
			type="number"
			value={draft}
			placeholder="Empty"
			aria-label={`${label} value`}
			aria-invalid={invalidDraft ? "true" : undefined}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onBlur={() => {
				if (parsedDraft === null) {
					setDraft(String(value));
					return;
				}
				onChange(parsedDraft);
				setDraft(String(parsedDraft));
			}}
		/>
	);
}

function ScalarField({
	label,
	value,
	onChange,
}: {
	readonly label: string;
	readonly value: unknown;
	readonly onChange: (value: unknown) => void;
}) {
	if (typeof value === "number") {
		return <NumberField label={label} value={value} onChange={onChange} />;
	}
	if (typeof value === "boolean") {
		return (
			<label className="markdown-frontmatter-boolean">
				<input
					type="checkbox"
					aria-label={`${label} value`}
					checked={value}
					onChange={(event) => onChange(event.currentTarget.checked)}
				/>
			</label>
		);
	}

	const text = value === null || value === undefined ? "" : String(value);
	const isDate = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
	return (
		<input
			className="markdown-frontmatter-input markdown-frontmatter-value"
			type={isDate ? "date" : "text"}
			value={text}
			placeholder="Empty"
			aria-label={`${label} value`}
			onChange={(event) => onChange(event.currentTarget.value)}
		/>
	);
}

function ArrayField({
	label,
	value,
	onChange,
}: {
	readonly label: string;
	readonly value: unknown[];
	readonly onChange: (value: unknown[]) => void;
}) {
	const [draft, setDraft] = useState("");
	const [adding, setAdding] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		setDraft("");
		setAdding(false);
	}, [label]);
	useEffect(() => {
		if (adding) inputRef.current?.focus();
	}, [adding]);
	const addItem = () => {
		const next = draft.trim();
		if (next) onChange([...value, next]);
		setDraft("");
		setAdding(false);
	};

	return (
		<div className="markdown-frontmatter-tags">
			{value.map((item, index) => (
				<button
					key={`${String(item)}-${index}`}
					type="button"
					className="markdown-frontmatter-tag"
					title="Remove value"
					aria-label={`Remove ${String(item)} from ${label}`}
					onClick={() =>
						onChange(value.filter((_, itemIndex) => itemIndex !== index))
					}
				>
					{String(item)}
					<X aria-hidden />
				</button>
			))}
			{adding ? (
				<input
					ref={inputRef}
					className="markdown-frontmatter-tag-input"
					value={draft}
					placeholder="Type and press Enter"
					aria-label={`New ${label} value`}
					onChange={(event) => setDraft(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							addItem();
						}
						if (event.key === "Escape") {
							event.preventDefault();
							setDraft("");
							setAdding(false);
						}
					}}
					onBlur={addItem}
				/>
			) : (
				<button
					type="button"
					className="markdown-frontmatter-tag-add"
					aria-label={`Add ${label} value`}
					onClick={() => setAdding(true)}
				>
					<Plus aria-hidden />
					Add
				</button>
			)}
		</div>
	);
}

function ObjectField({
	label,
	value,
	onChange,
}: {
	readonly label: string;
	readonly value: FrontmatterRecord;
	readonly onChange: (value: FrontmatterRecord) => void;
}) {
	return (
		<div className="markdown-frontmatter-nested">
			{Object.entries(value).map(([key, child], index) => (
				<div className="markdown-frontmatter-nested-row" key={index}>
					<FieldKeyInput
						value={key}
						ariaLabel={`${label} nested field name: ${key}`}
						onCommit={(requested) =>
							onChange(
								replaceRecordEntry(value, index, [
									availableRenamedFieldName(value, index, requested),
									child,
								]),
							)
						}
					/>
					<ScalarField
						label={`${label}.${key}`}
						value={child}
						onChange={(next) =>
							onChange(replaceRecordEntry(value, index, [key, next]))
						}
					/>
				</div>
			))}
		</div>
	);
}

function FieldValue({
	label,
	value,
	onChange,
}: {
	readonly label: string;
	readonly value: unknown;
	readonly onChange: (value: unknown) => void;
}) {
	if (Array.isArray(value)) {
		return <ArrayField label={label} value={value} onChange={onChange} />;
	}
	if (value && typeof value === "object") {
		return (
			<ObjectField
				label={label}
				value={value as FrontmatterRecord}
				onChange={onChange}
			/>
		);
	}
	return <ScalarField label={label} value={value} onChange={onChange} />;
}

export function FrontmatterEditorNodeView({
	editor,
	node,
	deleteNode,
	updateAttributes,
	selected,
}: NodeViewProps) {
	const source = String(node.attrs.value ?? "");
	const parsed = useMemo(() => parseFrontmatterSource(source), [source]);
	const entries = parsed.value ? Object.entries(parsed.value) : [];
	const fieldsSupported = supportsLosslessFieldsSource(source, parsed.value);
	const [mode, setMode] = useState<FrontmatterMode>(
		parsed.error || !fieldsSupported ? "yaml" : "fields",
	);
	const [rawDraft, setRawDraft] = useState(source);
	const [addingField, setAddingField] = useState(
		Boolean(node.attrs.autofocus && entries.length === 0),
	);
	const [fieldNameDraft, setFieldNameDraft] = useState("");
	const wrapperRef = useRef<HTMLDivElement | null>(null);
	const fieldNameRef = useRef<HTMLInputElement | null>(null);
	const committingFieldRef = useRef(false);
	const createdEmptyRef = useRef(
		Boolean(node.attrs.autofocus && entries.length === 0),
	);
	const rawErrorId = useId();

	const focusFirstDocumentBlock = useCallback(() => {
		window.requestAnimationFrame(() => editor.commands.focus("start"));
	}, [editor]);

	const removeFrontmatter = useCallback(() => {
		deleteNode();
		focusFirstDocumentBlock();
	}, [deleteNode, focusFirstDocumentBlock]);

	useEffect(() => setRawDraft(source), [source]);
	useEffect(() => {
		if (entries.length > 0) createdEmptyRef.current = false;
	}, [entries.length]);
	useEffect(() => {
		if ((!fieldsSupported || parsed.error) && mode !== "yaml") {
			setMode("yaml");
			setAddingField(false);
		}
	}, [fieldsSupported, mode, parsed.error]);
	useEffect(() => {
		if (!node.attrs.autofocus) return;
		const frame = window.requestAnimationFrame(() => {
			if (parsed.error || !fieldsSupported) {
				wrapperRef.current
					?.querySelector<HTMLElement>(".markdown-frontmatter-yaml")
					?.focus();
			} else {
				setMode("fields");
				setAddingField(true);
			}
			updateAttributes({ autofocus: false });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [fieldsSupported, node.attrs.autofocus, parsed.error, updateAttributes]);
	useEffect(() => {
		if (!addingField) return;
		const frame = window.requestAnimationFrame(() =>
			fieldNameRef.current?.focus(),
		);
		return () => window.cancelAnimationFrame(frame);
	}, [addingField]);
	const commitRecord = (value: FrontmatterRecord) => {
		updateAttributes({ value: stringifyFrontmatterValue(value) });
	};
	const cancelAddingField = () => {
		setFieldNameDraft("");
		setAddingField(false);
		if (createdEmptyRef.current && entries.length === 0) removeFrontmatter();
	};
	const commitFieldName = () => {
		if (committingFieldRef.current || !parsed.value) return;
		const requested = fieldNameDraft.trim();
		if (!requested) {
			cancelAddingField();
			return;
		}
		committingFieldRef.current = true;
		const key = availableFieldName(parsed.value, requested);
		commitRecord({ ...parsed.value, [key]: "" });
		setFieldNameDraft("");
		setAddingField(false);
		window.requestAnimationFrame(() => {
			const values = wrapperRef.current?.querySelectorAll<HTMLElement>(
				".markdown-frontmatter-row .markdown-frontmatter-value",
			);
			values?.item(values.length - 1)?.focus();
			committingFieldRef.current = false;
		});
	};
	const removeField = (index: number) => {
		if (!parsed.value) return;
		const next = replaceRecordEntry(parsed.value, index, null);
		if (Object.keys(next).length === 0) {
			removeFrontmatter();
			return;
		}
		commitRecord(next);
	};

	return (
		<NodeViewWrapper
			ref={wrapperRef}
			className="markdown-frontmatter"
			data-markdown-frontmatter="true"
			data-selected={selected ? "true" : "false"}
			contentEditable={false}
		>
			<div className="markdown-frontmatter-header">
				<div className="markdown-frontmatter-title">
					<strong>Frontmatter</strong>
				</div>
				<button
					type="button"
					className="markdown-frontmatter-mode"
					disabled={
						mode === "yaml" && (Boolean(parsed.error) || !fieldsSupported)
					}
					onClick={() => {
						if (
							mode === "yaml" &&
							createdEmptyRef.current &&
							entries.length === 0 &&
							!parsed.error
						) {
							removeFrontmatter();
							return;
						}
						setMode(mode === "fields" ? "yaml" : "fields");
					}}
				>
					{mode === "fields" ? "YAML" : "Fields"}
				</button>
			</div>

			{mode === "fields" && parsed.value ? (
				<div className="markdown-frontmatter-fields">
					{entries.map(([key, value], index) => (
						<div className="markdown-frontmatter-row" key={index}>
							<div className="markdown-frontmatter-key-cell">
								<FieldTypeIcon fieldKey={key} value={value} />
								<FieldKeyInput
									value={key}
									ariaLabel={`Frontmatter field name: ${key}`}
									onCommit={(requested) =>
										commitRecord(
											replaceRecordEntry(parsed.value!, index, [
												availableRenamedFieldName(
													parsed.value!,
													index,
													requested,
												),
												value,
											]),
										)
									}
								/>
							</div>
							<FieldValue
								label={key}
								value={value}
								onChange={(next) =>
									commitRecord(
										replaceRecordEntry(parsed.value!, index, [key, next]),
									)
								}
							/>
							<button
								type="button"
								className="markdown-frontmatter-remove"
								aria-label={`Remove ${key || "field"}`}
								onClick={() => removeField(index)}
							>
								<X aria-hidden />
							</button>
						</div>
					))}
					{addingField ? (
						<div className="markdown-frontmatter-row markdown-frontmatter-row-adding">
							<div className="markdown-frontmatter-key-cell">
								<AlignLeft aria-hidden />
								<input
									ref={fieldNameRef}
									className="markdown-frontmatter-input markdown-frontmatter-key"
									value={fieldNameDraft}
									aria-label="New frontmatter property name"
									placeholder="Property name"
									onChange={(event) =>
										setFieldNameDraft(event.currentTarget.value)
									}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											commitFieldName();
										}
										if (event.key === "Escape") {
											event.preventDefault();
											cancelAddingField();
										}
									}}
									onBlur={commitFieldName}
								/>
							</div>
							<div className="markdown-frontmatter-empty-value">Empty</div>
						</div>
					) : (
						<button
							type="button"
							className="markdown-frontmatter-add"
							onClick={() => setAddingField(true)}
						>
							<Plus aria-hidden />
							Add property
						</button>
					)}
				</div>
			) : (
				<div className="markdown-frontmatter-raw">
					<textarea
						className="markdown-frontmatter-yaml"
						value={rawDraft}
						aria-label="Raw YAML frontmatter"
						aria-invalid={parsed.error ? "true" : undefined}
						aria-describedby={parsed.error ? rawErrorId : undefined}
						spellCheck={false}
						onChange={(event) => {
							const value = event.currentTarget.value;
							setRawDraft(value);
							updateAttributes({ value });
						}}
						onBlur={() => {
							if (rawDraft.trim().length === 0) removeFrontmatter();
						}}
					/>
					{parsed.error ? (
						<p id={rawErrorId} className="markdown-frontmatter-error">
							{parsed.error}
						</p>
					) : null}
				</div>
			)}
		</NodeViewWrapper>
	);
}
