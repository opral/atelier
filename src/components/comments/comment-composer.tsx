import {
	useEffect,
	useRef,
	useState,
	type ClipboardEvent as ReactClipboardEvent,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
	$createZettelSpanNode,
	$createZettelTextBlockNode,
	createZettelEditor,
	exportDocument,
	loadDocument,
	registerZettelLexicalPlugin,
	toPlainText,
	ZettelHtmlNode,
	ZettelImageNode,
	ZettelInlineHtmlNode,
	ZettelSpanNode,
	type Document,
} from "@opral/zettel-lexical";
import { $getRoot, type LexicalEditor, type LexicalNode } from "lexical";
import { isMacPlatform } from "@/lib/platform";
import {
	asCommentText,
	htmlBlockLines,
	htmlInlineText,
	isBlankComment,
} from "./comment-document";
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
	/**
	 * The draft the field starts with. It is read when the field mounts and
	 * not again: from then on the text lives in the field, and every change
	 * is reported through `onChange`. To show another draft (another
	 * block's), give the field a `key` for it.
	 */
	readonly value: Document;
	readonly onChange: (document: Document) => void;
	/**
	 * Writes the comment. The field has already emptied itself (and said so
	 * through `onChange`) when this is called, so text typed while the write
	 * is in flight is the next comment. Do not clear the draft again when it
	 * resolves: the field ignores it, and a caller that shows the draft
	 * elsewhere would show nothing while the field has text. If it rejects,
	 * the field puts the comment back unless something new was typed.
	 */
	readonly onSubmit: (document: Document) => Promise<void>;
	/** The verb in the ⌘↵ hint: "send" in History, "comment" in a document. */
	readonly submitHint?: string;
	/** Increment to focus the field (a Comment button was pressed). */
	readonly focusRequest?: number;
	readonly onFocusHandled?: () => void;
	/**
	 * While true, focus taken out of the field by something the reader did
	 * not do is put back, so what they type keeps landing in it: History's
	 * Comment chip opens a review, and the review hands the keyboard to its
	 * float as it opens. A click elsewhere, Tab or Esc lets go.
	 */
	readonly holdFocus?: boolean;
	/**
	 * Esc, after the field has let go of focus (to its wrapper, which the
	 * review's shortcuts ignore). The caller may move focus on from there.
	 */
	readonly onCancel?: (document: Document) => void;
	/**
	 * The surface it sits on: "accent" on the orange of a selected
	 * checkpoint, "neutral" on white (a document margin, a host's own app).
	 */
	readonly tone?: ComposerTone;
	readonly size?: ComposerSize;
	/** The send button's label where it has one (`size="view"`). */
	readonly submitLabel?: string;
	/** The icon send button's accessible name: "Send comment", "Send reply". */
	readonly sendLabel?: string;
	readonly className?: string;
};

/**
 * A comment field that is a resting 30px pill until it is focused (opening a
 * thread is for reading; focus comes from a click or a Comment button), then
 * the writing field: white, the accent ring, the send button in its corner
 * and the key hints under it. Text is a Zettel document edited with Lexical,
 * so bold, italic, code, links and lists survive the round trip. Images and
 * raw HTML do not: a comment is text (see `asCommentText`).
 *
 * The draft lives with the caller too, so the field can unmount (a
 * checkpoint closing) and come back with what was typed.
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
	holdFocus = false,
	onCancel,
	tone = "accent",
	size = "compact",
	submitLabel = "Comment",
	sendLabel = "Send comment",
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
	const [initialValue] = useState(() => asCommentText(value));
	const [current, setCurrent] = useState(initialValue);
	const serializedRef = useRef(JSON.stringify(initialValue));
	// The last text that exported as a valid document. Lexical can leave a
	// structure Zettel rejects (seen after deleting across pasted nested
	// lists); the field then keeps reporting, and sends, this one.
	const lastValidRef = useRef(initialValue);
	const exportFailedRef = useRef(false);
	const [focused, setFocused] = useState(false);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const hasText = hasCommentText(current);
	const blank = isBlankComment(current);
	const writing = focused;
	const inDocument = size === "document";
	const expanded = inDocument || focused || !blank;
	// Design 4a: the pill's 12px line sits in the middle of its 30px (a
	// 15px line, 7.5px either side); writing is 12.5px on 18px.
	const textSize = inDocument
		? "atw:text-[13px] atw:leading-[19px]"
		: expanded
			? "atw:text-[12.5px] atw:leading-[18px]"
			: "atw:text-[12px] atw:leading-[15px]";

	function readDocument(): Document {
		try {
			const document = exportDocument(editor);
			exportFailedRef.current = false;
			lastValidRef.current = document;
			return document;
		} catch (cause) {
			// Once per broken stretch, not once per keystroke.
			if (!exportFailedRef.current)
				console.warn(
					"The comment field holds a structure that is not a valid Zettel document; keeping the last valid text.",
					cause,
				);
			exportFailedRef.current = true;
			return lastValidRef.current;
		}
	}

	useEffect(() => {
		const field = fieldRef.current;
		editor.setRootElement(field);
		if (field) fieldEditors.set(field, editor);
		// Comments are written the way people write in chat: **bold**, `code`,
		// "- " for a list, and bare URLs become links.
		const unregisterPlugin = registerZettelLexicalPlugin(editor, {
			markdownShortcuts: true,
		});
		// Every way in (paste, drop, a stored draft) meets the same rule.
		const unregisterImages = editor.registerNodeTransform(
			ZettelImageNode,
			(image) => {
				if (!image.alt.trim()) {
					image.remove();
					return;
				}
				// Its marks carry a link it sat in into the posted comment.
				image.replace(
					new ZettelSpanNode({ text: image.alt, marks: image.marks }),
				);
			},
		);
		// Raw HTML (Word pastes `<o:p></o:p>` after every paragraph) is a
		// read-only node: it would post as a code chip, and ⌘A ⌫ could not
		// remove it. It becomes the text it holds.
		const unregisterInlineHtml = editor.registerNodeTransform(
			ZettelInlineHtmlNode,
			(html) => {
				const text = htmlInlineText(html.value);
				if (!text) html.remove();
				else html.replace(new ZettelSpanNode({ text, marks: html.marks }));
			},
		);
		const unregisterHtml = editor.registerNodeTransform(
			ZettelHtmlNode,
			(html) => {
				const paragraphs = htmlBlockLines(html.value).map((line) =>
					$createZettelTextBlockNode().append(
						$createZettelSpanNode({ text: line }),
					),
				);
				// A container keeps a block to type in.
				if (
					paragraphs.length === 0 &&
					html.getParent()?.getChildrenSize() === 1
				)
					paragraphs.push($createZettelTextBlockNode());
				let previous: LexicalNode = html;
				for (const paragraph of paragraphs)
					previous = previous.insertAfter(paragraph);
				html.remove();
			},
		);
		loadDocument(editor, initialValue);
		const unregisterChanges = editor.registerUpdateListener(
			({ dirtyElements, dirtyLeaves }) => {
				if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
				const document = readDocument();
				const serialized = JSON.stringify(document);
				if (serialized === serializedRef.current) return;
				serializedRef.current = serialized;
				setError(null);
				setCurrent(document);
				onChangeRef.current(document);
			},
		);
		return () => {
			unregisterChanges();
			unregisterHtml();
			unregisterInlineHtml();
			unregisterImages();
			unregisterPlugin();
			if (field) fieldEditors.delete(field);
			editor.setRootElement(null);
		};
		// oxlint-disable-next-line react-hooks/exhaustive-deps -- mount only: `value` seeds the field once (see ComposerProps).
	}, [editor]);

	useEffect(() => {
		if (focusRequest === 0) return;
		focusEnd(editor, fieldRef.current);
		onFocusHandled?.();
	}, [editor, focusRequest, onFocusHandled]);

	useEffect(() => {
		const field = fieldRef.current;
		if (!holdFocus || !field) return;
		let held = field.contains(document.activeElement);
		const onFocusIn = (event: FocusEvent) => {
			if (field.contains(event.target as Node)) held = true;
			else if (held) {
				// Focus first, in this task, so no key lands in between; then
				// the caret goes back to where it was.
				field.focus({ preventScroll: true });
				editor.focus();
			}
		};
		const letGo = () => {
			held = false;
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Tab" || event.key === "Escape") held = false;
		};
		document.addEventListener("focusin", onFocusIn, true);
		document.addEventListener("pointerdown", letGo, true);
		document.addEventListener("keydown", onKey, true);
		return () => {
			document.removeEventListener("focusin", onFocusIn, true);
			document.removeEventListener("pointerdown", letGo, true);
			document.removeEventListener("keydown", onKey, true);
		};
	}, [editor, holdFocus]);

	function replaceDocument(next: Document) {
		const hadFocus =
			fieldRef.current?.contains(globalThis.document.activeElement) ?? false;
		serializedRef.current = JSON.stringify(next);
		lastValidRef.current = next;
		loadDocument(editor, next);
		// Zettel's loadDocument clears the root with the caret inside it, and
		// the selection falls back to the root: the next key would start a
		// bare Lexical paragraph outside the document's blocks (Shift+Enter
		// then splits it instead of breaking the line). Put the caret back in
		// the last block while the field is being typed in.
		if (hadFocus)
			editor.update(() => $getRoot().selectEnd(), { discrete: true });
		setCurrent(next);
		onChangeRef.current(next);
	}

	async function send() {
		const document = readDocument();
		if (!hasCommentText(document) || sending) return;
		setSending(true);
		setError(null);
		// The field empties before the write, so text typed while it is in
		// flight is the next comment. Callers must not clear it afterwards
		// (see ComposerProps.onSubmit).
		replaceDocument(emptyCommentDocument());
		try {
			await onSubmit(trimEmptyBlocks(asCommentText(document)));
			// The reading view keeps the field for a follow-up.
			if (size === "view") focusEnd(editor, fieldRef.current);
		} catch (cause) {
			if (!hasCommentText(readDocument())) replaceDocument(document);
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
		if (event.key === "Escape" && inField && !isComposing(event)) {
			event.preventDefault();
			event.stopPropagation();
			// Focus stays on the field's wrapper, which ignores the review's
			// shortcuts, so a reflexive ⌘↵ after Esc can't restore a file.
			rootRef.current?.focus({ preventScroll: true });
			onCancel?.(readDocument());
		}
	}

	// An input method uses Esc to cancel what it is composing. That Esc is
	// the IME's: it reaches the text (Lexical ends the composition) and
	// stops there, before the review's Esc closes the checkpoint.
	function onKeyDownBubble(event: ReactKeyboardEvent<HTMLDivElement>) {
		if (event.key === "Escape" && isComposing(event)) event.stopPropagation();
	}

	function onPaste(event: ReactClipboardEvent<HTMLDivElement>) {
		const data = event.clipboardData;
		const hasClipboardText =
			data.types.includes("text/plain") || data.types.includes("text/html");
		const image = [...data.files].some((file) =>
			file.type.startsWith("image/"),
		);
		if (image && !hasClipboardText) {
			event.preventDefault();
			setError("Comments are text: an image can't be added.");
		}
	}

	const modifier = isMacPlatform() ? "⌘" : "Ctrl";
	if (size === "view") {
		const open = focused || !blank;
		return (
			<div
				ref={rootRef}
				tabIndex={-1}
				data-review-shortcut-ignore=""
				data-attr="comment-composer"
				data-tone={tone}
				data-size={size}
				className={`comment-surface atw:flex atw:flex-col atw:outline-none atw:gap-1.5 ${className}`}
				onKeyDownCapture={onKeyDown}
			>
				<div
					role="presentation"
					data-state={writing ? "writing" : hasText ? "draft" : "resting"}
					// The design's 1px border plus its padding; the edge here is a shadow.
					className={`comment-field atw:flex atw:cursor-text atw:flex-col atw:rounded-panel ${
						open
							? "atw:gap-2 atw:pt-[11px] atw:pr-[11px] atw:pb-[9px] atw:pl-[13px]"
							: "atw:px-[13px] atw:py-[9px]"
					}`}
					onMouseDown={(event) => {
						if (event.target === event.currentTarget) {
							event.preventDefault();
							focusEnd(editor, fieldRef.current);
						}
					}}
				>
					<div
						className={`atw:relative atw:min-w-0 ${open ? "atw:min-h-[38px]" : ""}`}
					>
						{blank ? (
							<span
								aria-hidden="true"
								className="comment-field-placeholder atw:pointer-events-none atw:absolute atw:inset-x-0 atw:top-0 atw:truncate atw:text-[14px] atw:leading-[21px]"
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
							// Editable is tabbable already; said here for the linter.
							tabIndex={0}
							spellCheck
							onFocus={() => setFocused(true)}
							onBlur={() => setFocused(false)}
							onKeyDown={onKeyDownBubble}
							onPaste={onPaste}
							className="zettel comment-editor atw:max-h-[40vh] atw:min-w-0 atw:overflow-y-auto atw:text-[14px] atw:leading-[21px]"
						/>
					</div>
					{open ? (
						<div className="atw:flex atw:items-center atw:gap-2">
							<span
								aria-hidden="true"
								className="comment-secondary atw:text-[11.5px] atw:leading-4"
							>
								{`${modifier}↵ to ${submitHint}${writing ? " · Esc to cancel" : ""}`}
							</span>
							<span className="atw:flex-1" />
							<button
								type="button"
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => void send()}
								disabled={!hasText || sending}
								title={`${submitLabel} (${modifier}↵)`}
								className="atw:flex atw:h-7 atw:shrink-0 atw:cursor-pointer atw:items-center atw:rounded-control atw:bg-accent atw:px-3 atw:py-0 atw:text-[12.5px] atw:font-semibold atw:text-accent-on atw:hover:bg-accent-hover atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:ring-offset-1 atw:disabled:cursor-default atw:disabled:hover:bg-accent"
							>
								{submitLabel}
							</button>
						</div>
					) : null}
				</div>
				{error ? (
					<p
						role="alert"
						className="atw:text-[11.5px] atw:leading-4 atw:text-danger"
					>
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
			className={`comment-surface atw:flex atw:flex-col atw:outline-none ${
				inDocument ? "atw:gap-3" : "atw:gap-[5px]"
			} ${className}`}
			onKeyDownCapture={onKeyDown}
		>
			<div
				role="presentation"
				data-state={writing ? "writing" : hasText ? "draft" : "resting"}
				className={`comment-field atw:flex atw:cursor-text atw:items-end atw:rounded-control ${
					!expanded
						? "atw:min-h-[30px] atw:gap-2 atw:px-[9px] atw:py-[7.5px]"
						: inDocument
							? // Handoff N2/N4: a 1px border and 9px of padding put the text
								// 10px in; 6px to the send button.
								"atw:min-h-8 atw:gap-1.5 atw:py-1 atw:pr-1 atw:pl-[10px]"
							: // The design's 1px border plus 4px padding; the edge here is a shadow.
								"atw:min-h-[34px] atw:gap-2 atw:py-[5px] atw:pr-[5px] atw:pl-[10px]"
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
					className={`atw:relative atw:min-w-0 atw:flex-1 ${expanded ? "atw:py-[3px]" : ""}`}
				>
					{blank ? (
						<span
							aria-hidden="true"
							className={`comment-field-placeholder atw:pointer-events-none atw:absolute atw:inset-x-0 atw:truncate ${
								expanded ? "atw:top-[3px]" : "atw:top-0"
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
						// Editable is tabbable already; said here for the linter.
						tabIndex={0}
						spellCheck
						onFocus={() => setFocused(true)}
						onBlur={() => setFocused(false)}
						onKeyDown={onKeyDownBubble}
						onPaste={onPaste}
						// The plugin adds "zettel" to its root; React owns className, so say it here too.
						className={`zettel comment-editor atw:max-h-[40vh] atw:min-w-0 atw:overflow-y-auto ${textSize}`}
					/>
				</div>
				{expanded ? (
					<button
						type="button"
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => void send()}
						disabled={!hasText || sending}
						aria-label={sending ? "Sending…" : sendLabel}
						title={`Send (${modifier}↵)`}
						className={`atw:flex atw:shrink-0 atw:cursor-pointer atw:items-center atw:justify-center atw:bg-accent atw:text-accent-on atw:transition-opacity atw:hover:bg-accent-hover atw:focus-visible:outline-none atw:focus-visible:ring-2 atw:focus-visible:ring-ring atw:focus-visible:ring-offset-1 atw:disabled:cursor-default ${
							inDocument
								? "atw:size-6.5 atw:rounded-control atw:disabled:bg-bg-hover atw:disabled:text-history-flag"
								: "atw:size-6 atw:rounded-[6px] atw:disabled:opacity-40 atw:disabled:hover:bg-accent"
						}`}
					>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							className={inDocument ? "atw:size-[13px]" : "atw:size-[11px]"}
							fill="none"
							stroke="currentColor"
							strokeWidth={inDocument ? 2.4 : 2.5}
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M12 19V5M5 12l7-7 7 7" />
						</svg>
					</button>
				) : null}
			</div>
			{error ? (
				<p
					role="alert"
					className="atw:pl-0.5 atw:text-[11px] atw:leading-4 atw:text-danger"
				>
					{error}
				</p>
			) : writing ? (
				<p
					aria-hidden="true"
					className={`comment-secondary atw:flex atw:gap-2.5 ${
						inDocument
							? "atw:text-[11.5px] atw:leading-[normal]"
							: "atw:pl-0.5 atw:text-[10.5px] atw:leading-3"
					}`}
				>
					<span>{`${modifier}↵ ${submitHint}`}</span>
					<span>Esc cancel</span>
				</p>
			) : null}
		</div>
	);
}

function isComposing(event: ReactKeyboardEvent): boolean {
	// Safari reports the key that ends a composition with keyCode 229 and
	// isComposing already false.
	return event.nativeEvent.isComposing || event.keyCode === 229;
}

/** Each mounted field's editor, for `focusCommentField`. */
const fieldEditors = new WeakMap<HTMLElement, LexicalEditor>();

/**
 * Puts the caret at the end of the comment field inside `scope` (a thread's
 * surface), as its own focus request would. False when there is none.
 */
export function focusCommentField(scope: Element): boolean {
	for (const field of scope.querySelectorAll<HTMLElement>(
		"[data-attr=comment-composer] [role=textbox]",
	)) {
		const editor = fieldEditors.get(field);
		if (!editor) continue;
		// Focus first, in this task, so no key lands elsewhere; then the
		// caret goes to the end of what is there.
		field.focus({ preventScroll: true });
		focusEnd(editor, field);
		return true;
	}
	return false;
}

function focusEnd(editor: LexicalEditor, root: HTMLElement | null) {
	if (!root) return;
	editor.focus(undefined, { defaultSelection: "rootEnd" });
	root.scrollIntoView({ block: "nearest" });
}
