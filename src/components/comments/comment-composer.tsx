import {
	useEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
	createZettelEditor,
	exportDocument,
	loadDocument,
	registerZettelLexicalPlugin,
	toPlainText,
	type Document,
} from "@opral/zettel-lexical";
import type { LexicalEditor } from "lexical";
import { isMacPlatform } from "@/lib/platform";
import "./comments.css";

export type ComposerTone = "accent" | "neutral";

/**
 * "compact": History's 30px pill that grows into the writing field.
 * "document": a document's comment field (Turn 7): always the full field
 * with its send button, 13px text, and the key hints set further off.
 * "view": the conversation view's reply box (design "1a"): a one-line
 * 14px box at rest that grows into the writing field, with the key hint
 * and a labelled Comment button inside it. ⌘↵ sends and keeps focus.
 */
export type ComposerSize = "compact" | "document" | "view";

export function emptyCommentDocument(): Document {
	return {
		_type: "zettel_doc",
		blocks: [
			{
				_type: "zettel_block",
				_key: crypto.randomUUID(),
				style: "normal",
				markDefs: [],
				children: [],
			},
		],
	};
}

/**
 * Blank paragraphs before and after the text are what Enter leaves behind,
 * not something the writer meant to post.
 */
export function trimEmptyBlocks(document: Document): Document {
	const isEmpty = (block: Document["blocks"][number]) =>
		block._type === "zettel_block" &&
		!toPlainText({ ...document, blocks: [block] }).trim();
	let start = 0;
	let end = document.blocks.length;
	while (start < end && isEmpty(document.blocks[start]!)) start++;
	while (end > start && isEmpty(document.blocks[end - 1]!)) end--;
	// Inside, a run of blank paragraphs is one paragraph break: that is what
	// the rendered comment can show.
	const blocks = document.blocks
		.slice(start, end)
		.filter(
			(block, index, kept) =>
				!(isEmpty(block) && index > 0 && isEmpty(kept[index - 1]!)),
		);
	if (blocks.length === document.blocks.length) return document;
	return { ...document, blocks };
}

export function hasCommentText(document: Document | null | undefined): boolean {
	return Boolean(document && toPlainText(document).trim());
}

export type ComposerProps = {
	readonly label: string;
	readonly placeholder: string;
	readonly value: Document;
	readonly onChange: (document: Document) => void;
	readonly onSubmit: (document: Document) => Promise<void>;
	/** The verb in the ⌘↵ hint: "send" in History, "comment" in a document. */
	readonly submitHint?: string;
	/** Increment to focus the field (a Comment button was pressed). */
	readonly focusRequest?: number;
	readonly onFocusHandled?: () => void;
	/** Esc, after the field has let go of focus. */
	readonly onCancel?: (document: Document) => void;
	/**
	 * The surface it sits on: "accent" on the orange of a selected
	 * checkpoint, "neutral" on white (a document margin, a host's own app).
	 */
	readonly tone?: ComposerTone;
	readonly size?: ComposerSize;
	/** The send button's label where it has one (`size="view"`). */
	readonly submitLabel?: string;
	readonly className?: string;
};

/**
 * A comment field that is a resting 30px pill until it is focused (opening a
 * thread is for reading; focus comes from a click or a Comment button), then
 * the writing field: white, the accent ring, the send button in its corner
 * and the key hints under it. Text is a Zettel document edited with Lexical,
 * so bold, italic, code, links and lists survive the round trip.
 *
 * The draft lives with the caller: the field can unmount (a checkpoint
 * closing) and come back with what was typed.
 */
export function Composer({
	label,
	placeholder,
	value,
	onChange,
	onSubmit,
	submitHint = "send",
	focusRequest = 0,
	onFocusHandled,
	onCancel,
	tone = "accent",
	size = "compact",
	submitLabel = "Comment",
	className = "",
}: ComposerProps) {
	const fieldRef = useRef<HTMLDivElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<LexicalEditor | null>(null);
	if (!editorRef.current) {
		editorRef.current = createZettelEditor({
			namespace: "atelier-comment",
			onError: (cause) => {
				console.error(cause);
			},
		});
	}
	const editor = editorRef.current;
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;
	const initialValueRef = useRef(value);
	const serializedRef = useRef(JSON.stringify(value));
	const [focused, setFocused] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const hasText = hasCommentText(value);
	const writing = focused;
	const inDocument = size === "document";
	const expanded = inDocument || focused || hasText;
	const textSize = inDocument
		? "text-[13px] leading-[19px]"
		: expanded
			? "text-[12.5px] leading-[18px]"
			: "text-[12px] leading-[18px]";

	useEffect(() => {
		editor.setRootElement(fieldRef.current);
		const unregisterPlugin = registerZettelLexicalPlugin(editor);
		loadDocument(editor, initialValueRef.current);
		const unregisterChanges = editor.registerUpdateListener(
			({ dirtyElements, dirtyLeaves }) => {
				if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
				const document = exportDocument(editor);
				const serialized = JSON.stringify(document);
				if (serialized === serializedRef.current) return;
				serializedRef.current = serialized;
				setError(null);
				onChangeRef.current(document);
			},
		);
		return () => {
			unregisterChanges();
			unregisterPlugin();
			editor.setRootElement(null);
		};
	}, [editor]);

	// A draft replaced from outside (cleared after sending elsewhere, restored).
	useEffect(() => {
		const serialized = JSON.stringify(value);
		if (serialized === serializedRef.current) return;
		serializedRef.current = serialized;
		loadDocument(editor, value);
	}, [editor, value]);

	useEffect(() => {
		if (focusRequest === 0) return;
		focusEnd(editor, fieldRef.current);
		onFocusHandled?.();
	}, [editor, focusRequest, onFocusHandled]);

	function replaceDocument(document: Document) {
		serializedRef.current = JSON.stringify(document);
		loadDocument(editor, document);
		onChangeRef.current(document);
	}

	async function send() {
		const document = exportDocument(editor);
		if (!hasCommentText(document) || sending) return;
		setSending(true);
		setError(null);
		// Cleared before the write, so text typed while it is in flight is
		// the next comment rather than lost when the field clears afterwards.
		replaceDocument(emptyCommentDocument());
		try {
			await onSubmit(trimEmptyBlocks(document));
			// The reading view keeps the field for a follow-up.
			if (size === "view") focusEnd(editor, fieldRef.current);
		} catch (cause) {
			if (!hasCommentText(exportDocument(editor))) replaceDocument(document);
			setError(
				cause instanceof Error && cause.message
					? `Couldn't send: ${cause.message}`
					: "Couldn't send. Try again.",
			);
		} finally {
			setSending(false);
		}
	}

	function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
		const inField = fieldRef.current?.contains(event.target as Node) ?? false;
		if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
			// Outside the text (the wrapper holds focus after Esc) ⌘↵ does
			// nothing: it must neither send nor reach the review's Restore.
			event.preventDefault();
			event.stopPropagation();
			if (inField) void send();
			return;
		}
		if (event.key === "Escape" && inField && !event.nativeEvent.isComposing) {
			event.preventDefault();
			event.stopPropagation();
			// Focus stays on the field's wrapper, which ignores the review's
			// shortcuts, so a reflexive ⌘↵ after Esc can't restore a file.
			rootRef.current?.focus({ preventScroll: true });
			onCancel?.(exportDocument(editor));
		}
	}

	const modifier = isMacPlatform() ? "⌘" : "Ctrl";
	if (size === "view") {
		const open = focused || hasText;
		return (
			<div
				ref={rootRef}
				tabIndex={-1}
				data-review-shortcut-ignore=""
				data-attr="comment-composer"
				data-tone={tone}
				data-size={size}
				className={`comment-surface flex flex-col outline-none gap-1.5 ${className}`}
				onKeyDownCapture={onKeyDown}
			>
				<div
					role="presentation"
					data-state={writing ? "writing" : hasText ? "draft" : "resting"}
					// The design's 1px border plus its padding; the edge here is a shadow.
					className={`comment-field flex cursor-text flex-col rounded-panel ${
						open
							? "gap-2 pt-[11px] pr-[11px] pb-[9px] pl-[13px]"
							: "px-[13px] py-[9px]"
					}`}
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) {
							event.preventDefault();
							focusEnd(editor, fieldRef.current);
						}
					}}
				>
					<div className={`relative min-w-0 ${open ? "min-h-[38px]" : ""}`}>
						{!hasText ? (
							<span
								aria-hidden="true"
								className="comment-field-placeholder pointer-events-none absolute inset-x-0 top-0 truncate text-[14px] leading-[21px]"
							>
								{placeholder}
							</span>
						) : null}
						<div
							ref={fieldRef}
							role="textbox"
							aria-label={label}
							aria-multiline="true"
							aria-placeholder={placeholder}
							aria-keyshortcuts="Meta+Enter Control+Enter"
							contentEditable
							suppressContentEditableWarning
							spellCheck
							onFocus={() => setFocused(true)}
							onBlur={() => setFocused(false)}
							className="zettel comment-editor max-h-[40vh] min-w-0 overflow-y-auto text-[14px] leading-[21px]"
						/>
					</div>
					{open ? (
						<div className="flex items-center gap-2">
							<span
								aria-hidden="true"
								className="comment-secondary text-[11.5px] leading-4"
							>
								{`${modifier}↵ to ${submitHint}${writing ? " · Esc to cancel" : ""}`}
							</span>
							<span className="flex-1" />
							<button
								type="button"
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => void send()}
								disabled={!hasText || sending}
								title={`${submitLabel} (${modifier}↵)`}
								className="flex h-7 shrink-0 cursor-pointer items-center rounded-control bg-accent px-3 py-0 text-[12.5px] font-semibold text-accent-on hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-default disabled:hover:bg-accent"
							>
								{submitLabel}
							</button>
						</div>
					) : null}
				</div>
				{error ? (
					<p role="alert" className="text-[11.5px] leading-4 text-danger">
						{error}
					</p>
				) : null}
			</div>
		);
	}
	return (
		<div
			ref={rootRef}
			tabIndex={-1}
			data-review-shortcut-ignore=""
			data-attr="comment-composer"
			data-tone={tone}
			data-size={size}
			className={`comment-surface flex flex-col outline-none ${
				inDocument ? "gap-3" : "gap-[5px]"
			} ${className}`}
			onKeyDownCapture={onKeyDown}
		>
			<div
				role="presentation"
				data-state={writing ? "writing" : hasText ? "draft" : "resting"}
				className={`comment-field flex cursor-text items-end gap-2 rounded-control ${
					!expanded
						? "min-h-[30px] px-[9px] py-1.5"
						: inDocument
							? "min-h-8 py-1 pr-1 pl-[9px]"
							: // The design's 1px border plus 4px padding; the edge here is a shadow.
								"min-h-[34px] py-[5px] pr-[5px] pl-[10px]"
				}`}
				onMouseDown={(event) => {
					// A press on the field's padding still lands in the text.
					if (event.target === event.currentTarget) {
						event.preventDefault();
						focusEnd(editor, fieldRef.current);
					}
				}}
			>
				<div
					className={`relative min-w-0 flex-1 ${expanded ? "py-[3px]" : ""}`}
				>
					{!hasText ? (
						<span
							aria-hidden="true"
							className={`comment-field-placeholder pointer-events-none absolute inset-x-0 truncate ${
								expanded ? "top-[3px]" : "top-0"
							} ${textSize}`}
						>
							{placeholder}
						</span>
					) : null}
					<div
						ref={fieldRef}
						role="textbox"
						aria-label={label}
						aria-multiline="true"
						aria-placeholder={placeholder}
						aria-keyshortcuts="Meta+Enter Control+Enter"
						contentEditable
						suppressContentEditableWarning
						spellCheck
						onFocus={() => setFocused(true)}
						onBlur={() => setFocused(false)}
						// The plugin adds "zettel" to its root; React owns className, so say it here too.
						className={`zettel comment-editor max-h-[40vh] min-w-0 overflow-y-auto ${textSize}`}
					/>
				</div>
				{expanded ? (
					<button
						type="button"
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => void send()}
						disabled={!hasText || sending}
						aria-label={sending ? "Sending comment" : "Send comment"}
						title={`Send (${modifier}↵)`}
						className={`flex shrink-0 cursor-pointer items-center justify-center bg-accent text-accent-on transition-opacity hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-default ${
							inDocument
								? "size-6.5 rounded-control disabled:bg-bg-hover disabled:text-history-flag"
								: "size-6 rounded-[6px] disabled:opacity-40 disabled:hover:bg-accent"
						}`}
					>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							className="size-[11px]"
							fill="none"
							stroke="currentColor"
							strokeWidth={2.5}
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M12 19V5M5 12l7-7 7 7" />
						</svg>
					</button>
				) : null}
			</div>
			{error ? (
				<p role="alert" className="pl-0.5 text-[11px] leading-4 text-danger">
					{error}
				</p>
			) : writing ? (
				<p
					aria-hidden="true"
					className={`comment-secondary flex gap-2.5 ${
						inDocument
							? "text-[11.5px] leading-4"
							: "pl-0.5 text-[10.5px] leading-3"
					}`}
				>
					<span>{`${modifier}↵ ${submitHint}`}</span>
					<span>Esc cancel</span>
				</p>
			) : null}
		</div>
	);
}

function focusEnd(editor: LexicalEditor, root: HTMLElement | null) {
	if (!root) return;
	editor.focus(undefined, { defaultSelection: "rootEnd" });
	root.scrollIntoView({ block: "nearest" });
}
