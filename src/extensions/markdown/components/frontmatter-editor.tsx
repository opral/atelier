import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
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
import {
	useMarkdownFrontmatterDisabled,
	useMarkdownFrontmatterEditing,
} from "../editor/frontmatter-editing-context";

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

/**
 * How a field hands focus back to the document when Escape leaves it. The node
 * view is the one that knows the editor; the fields are several components
 * below it.
 */
const LeaveFrontmatterContext = createContext<() => void>(() => {});

/**
 * Escape leaves the field, and the document it interrupted is where it leaves
 * to. Blurring alone drops focus on `<body>`, where the next key means nothing
 * at all and the caret the reader had is nowhere to be seen — and handing the
 * browser the editor's element is not enough either, because the selection it
 * would restore is the frontmatter block itself, which the next letter would
 * replace. The caret goes to the first block of the document instead.
 */
function useLeaveForTheDocument(): (field: HTMLElement) => void {
	const leave = useContext(LeaveFrontmatterContext);
	return (field) => {
		field.blur();
		leave();
	};
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
	const disabled = useMarkdownFrontmatterDisabled();
	const leaveForTheDocument = useLeaveForTheDocument();
	const [draft, setDraft] = useState(value);
	// Escape leaves without committing, so the blur it causes must not commit
	// the draft it has just thrown away. Putting the draft back is not enough:
	// the blur runs before React has re-rendered with it, so what `commit`
	// reads is still the name the reader was abandoning.
	const reverting = useRef(false);
	const commit = () => {
		if (reverting.current) {
			reverting.current = false;
			setDraft(value);
			return;
		}
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
			disabled={disabled}
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
					reverting.current = true;
					setDraft(value);
					leaveForTheDocument(event.currentTarget);
				}
			}}
		/>
	);
}

/**
 * Escape in a frontmatter field puts back the value the field held when it was
 * entered and hands focus back to the document. Both halves of a row answer it
 * that way; a value that answered nothing, or a name that kept what Escape
 * threw away, was one field behaving two ways.
 */
function useEscapeRevert<T>(
	current: T,
	revert: (entryValue: T) => void,
): {
	onFocus: () => void;
	onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
} {
	const entryValue = useRef(current);
	const leaveForTheDocument = useLeaveForTheDocument();
	return {
		onFocus: () => {
			entryValue.current = current;
		},
		onKeyDown: (event) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			revert(entryValue.current);
			leaveForTheDocument(event.currentTarget);
		},
	};
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
	const disabled = useMarkdownFrontmatterDisabled();
	const leaveForTheDocument = useLeaveForTheDocument();
	const [draft, setDraft] = useState(String(value));
	useEffect(() => setDraft(String(value)), [value]);
	const parsedDraft = parseEditableNumber(draft);
	const invalidDraft = draft.trim() !== "" && parsedDraft === null;
	// Escape leaves without committing, so the blur it causes must not commit
	// the draft it just threw away.
	const reverting = useRef(false);
	return (
		<input
			className="markdown-frontmatter-input markdown-frontmatter-value"
			type="number"
			value={draft}
			disabled={disabled}
			placeholder="Empty"
			aria-label={`${label} value`}
			aria-invalid={invalidDraft ? "true" : undefined}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				reverting.current = true;
				setDraft(String(value));
				leaveForTheDocument(event.currentTarget);
			}}
			onBlur={() => {
				if (reverting.current) {
					reverting.current = false;
					setDraft(String(value));
					return;
				}
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
		return <BooleanField label={label} value={value} onChange={onChange} />;
	}
	return <TextField label={label} value={value} onChange={onChange} />;
}

function BooleanField({
	label,
	value,
	onChange,
}: {
	readonly label: string;
	readonly value: boolean;
	readonly onChange: (value: unknown) => void;
}) {
	const disabled = useMarkdownFrontmatterDisabled();
	const escape = useEscapeRevert(value, onChange);
	return (
		<label className="markdown-frontmatter-boolean">
			<input
				type="checkbox"
				aria-label={`${label} value`}
				checked={value}
				disabled={disabled}
				onFocus={escape.onFocus}
				onKeyDown={escape.onKeyDown}
				onChange={(event) => onChange(event.currentTarget.checked)}
			/>
		</label>
	);
}

function TextField({
	label,
	value,
	onChange,
}: {
	readonly label: string;
	readonly value: unknown;
	readonly onChange: (value: unknown) => void;
}) {
	const disabled = useMarkdownFrontmatterDisabled();
	const text = value === null || value === undefined ? "" : String(value);
	const isDate = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
	// This field writes as you type, so what Escape puts back is the value it
	// held when you got here, not a draft it never kept.
	const escape = useEscapeRevert(text, onChange);
	return (
		<input
			className="markdown-frontmatter-input markdown-frontmatter-value"
			type={isDate ? "date" : "text"}
			value={text}
			disabled={disabled}
			placeholder="Empty"
			aria-label={`${label} value`}
			onFocus={escape.onFocus}
			onKeyDown={escape.onKeyDown}
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
	const disabled = useMarkdownFrontmatterDisabled();
	const [draft, setDraft] = useState("");
	const [adding, setAdding] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
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
					disabled={disabled}
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
			) : disabled ? null : (
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
				<div className="markdown-frontmatter-nested-row" key={key}>
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
	getPos,
	deleteNode,
	updateAttributes,
	selected,
}: NodeViewProps) {
	const editing = useMarkdownFrontmatterEditing();
	const disabled = editing.kind === "readOnly";
	const [writeError, setWriteError] = useState<string | null>(null);
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

	// Where Escape in a field puts the caret. Not the document's very start:
	// that is this block, which ProseMirror selects whole and the next letter
	// would replace. The first text position after it, so the key that follows
	// types where the reader can see it.
	const focusPastFrontmatter = useCallback(() => {
		window.requestAnimationFrame(() => {
			if (editor.isDestroyed) return;
			const { doc } = editor.state;
			const pos = typeof getPos === "function" ? getPos() : undefined;
			const after =
				typeof pos === "number" ? pos + node.nodeSize : doc.content.size;
			const caret = TextSelection.near(
				doc.resolve(Math.min(after, doc.content.size)),
				1,
			);
			editor.view.dispatch(editor.state.tr.setSelection(caret));
			editor.view.focus();
		});
	}, [editor, getPos, node.nodeSize]);

	// A projection of a diff cannot be serialized back into the file it shows,
	// so the panel writes the property itself — the edit lands where the same
	// edit lands outside a review, and nothing on screen is a value the file
	// does not have.
	const writeThrough = useCallback(
		(value: string) => {
			if (editing.kind !== "file") return;
			editing.write(value).then(
				() => setWriteError(null),
				(cause: unknown) =>
					setWriteError(
						cause instanceof Error
							? cause.message
							: "Could not save this property.",
					),
			);
		},
		[editing],
	);

	// A revision keeps nothing, so it is not offered the document either: a
	// disabled field that still moved the projection would be the same lie in
	// a quieter place.
	const commitSource = useCallback(
		(value: string) => {
			if (editing.kind === "readOnly") return;
			updateAttributes({ value });
			writeThrough(value);
		},
		[editing.kind, updateAttributes, writeThrough],
	);

	const removeFrontmatter = useCallback(() => {
		if (editing.kind === "readOnly") return;
		deleteNode();
		writeThrough("");
		focusFirstDocumentBlock();
	}, [deleteNode, editing.kind, focusFirstDocumentBlock, writeThrough]);

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
		commitSource(stringifyFrontmatterValue(value));
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
		<LeaveFrontmatterContext.Provider value={focusPastFrontmatter}>
			<NodeViewWrapper
				ref={wrapperRef}
				className="markdown-frontmatter"
				data-markdown-frontmatter="true"
				data-selected={selected ? "true" : "false"}
				data-disabled={disabled ? "true" : "false"}
				contentEditable={false}
			>
				<div className="markdown-frontmatter-header">
					<div className="markdown-frontmatter-title">
						<strong>Frontmatter</strong>
						{disabled ? (
							<span className="markdown-frontmatter-note">
								{editing.reason}
							</span>
						) : null}
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
							<div className="markdown-frontmatter-row" key={key}>
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
									disabled={disabled}
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
						) : disabled ? null : (
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
							readOnly={disabled}
							onChange={(event) => {
								const value = event.currentTarget.value;
								setRawDraft(value);
								commitSource(value);
							}}
							onBlur={() => {
								if (!disabled && rawDraft.trim().length === 0) {
									removeFrontmatter();
								}
							}}
						/>
						{parsed.error ? (
							<p id={rawErrorId} className="markdown-frontmatter-error">
								{parsed.error}
							</p>
						) : null}
					</div>
				)}
				{writeError ? (
					<p className="markdown-frontmatter-error" role="alert">
						{writeError}
					</p>
				) : null}
			</NodeViewWrapper>
		</LeaveFrontmatterContext.Provider>
	);
}
