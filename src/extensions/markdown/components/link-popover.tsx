import {
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
} from "react";
import { Popover } from "@base-ui/react/popover";
import { Check, Link as LinkIcon, Unlink, X } from "lucide-react";
import type { Editor } from "@tiptap/core";
import { normalizeUrl } from "../editor/normalize-url";
import { setLinkTargetRange } from "../editor/extensions/link-target-decoration";
import { ToolbarIconButton } from "./toolbar-icon-button";

type SelectionAnchor = {
	getBoundingClientRect: () => DOMRect;
	contextElement: Element;
};

/**
 * A Floating UI virtual element tracking the editor selection, so popups
 * open next to the text they act on rather than next to a toolbar button.
 * The rect spans the first to the last line of the selection.
 */
export function createSelectionAnchor(editor: Editor): SelectionAnchor {
	return {
		contextElement: editor.view.dom,
		getBoundingClientRect: () => {
			const { view, state } = editor;
			const { from, to } = state.selection;
			const start = view.coordsAtPos(from);
			const end = to === from ? start : view.coordsAtPos(to);
			const left = Math.min(start.left, end.left);
			const top = Math.min(start.top, end.top);
			const right = Math.max(start.right, end.right, left);
			const bottom = Math.max(start.bottom, end.bottom, top);
			return new DOMRect(left, top, right - left, bottom - top);
		},
	};
}

type LinkPopoverProps = {
	editor: Editor | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Whether the caret already sits in a link; drives the trigger's pressed look. */
	linkActive: boolean;
	portalContainer?: HTMLElement;
	triggerDataAttr: string;
};

/**
 * Link editor popover anchored to the editor selection. While it is open the
 * target text stays highlighted through a ProseMirror decoration, since the
 * native selection paint disappears once the URL field takes focus.
 *
 * @example
 * <LinkPopover editor={editor} open={open} onOpenChange={setOpen} linkActive={isLink} triggerDataAttr="markdown-format-link" />
 */
export function LinkPopover({
	editor,
	open,
	onOpenChange,
	linkActive,
	portalContainer,
	triggerDataAttr,
}: LinkPopoverProps) {
	const [value, setValue] = useState("");
	const [editing, setEditing] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const anchor = useMemo(
		() => (editor ? createSelectionAnchor(editor) : null),
		[editor],
	);

	// Opening reads the link under the caret and lights up the target range;
	// closing (or unmounting) clears the highlight again.
	useLayoutEffect(() => {
		if (!editor || !open || editor.isDestroyed) return;
		const active = editor.isActive("link");
		setEditing(active);
		setValue(active ? String(editor.getAttributes("link")?.href ?? "") : "");
		const { from, to } = editor.state.selection;
		setLinkTargetRange(editor, from < to ? { from, to } : null);
		return () => {
			setLinkTargetRange(editor, null);
		};
	}, [editor, open]);

	const close = useCallback(() => {
		// Closing without applying must not strand focus on the popover: the
		// caret and selection go back where they were.
		if (editor && !editor.isDestroyed) editor.chain().focus().run();
		onOpenChange(false);
	}, [editor, onOpenChange]);

	const handleOpenChange = useCallback(
		(next: boolean) => {
			if (next) {
				onOpenChange(true);
				return;
			}
			close();
		},
		[close, onOpenChange],
	);

	const handleApply = useCallback(() => {
		if (!editor) return;
		const href = normalizeUrl(value);
		if (!href) {
			close();
			return;
		}
		const chain = editor.chain().focus();
		if (editor.isActive("link")) {
			// Caret inside an existing link — update the whole mark range.
			chain.extendMarkRange("link").setMark("link", { href }).run();
		} else if (!editor.state.selection.empty) {
			// Apply to the current selection.
			chain.setMark("link", { href }).run();
		} else {
			// No selection — insert the URL itself as the linked text.
			chain
				.insertContent({
					type: "text",
					text: value.trim() || href,
					marks: [{ type: "link", attrs: { href } }],
				})
				.run();
		}
		onOpenChange(false);
	}, [close, editor, onOpenChange, value]);

	const handleRemove = useCallback(() => {
		if (!editor) return;
		editor.chain().focus().extendMarkRange("link").unsetMark("link").run();
		onOpenChange(false);
	}, [editor, onOpenChange]);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			if (event.key === "Enter") {
				event.preventDefault();
				handleApply();
			}
		},
		[handleApply],
	);

	return (
		<Popover.Root open={open} onOpenChange={handleOpenChange}>
			<ToolbarIconButton
				render={<Popover.Trigger />}
				label="Link"
				shortcut="link"
				active={open || linkActive}
				pressable={false}
				portalContainer={portalContainer}
				data-attr={triggerDataAttr}
			>
				<LinkIcon className="size-3.5" aria-hidden />
			</ToolbarIconButton>
			<Popover.Portal container={portalContainer}>
				<Popover.Positioner
					className="z-50 outline-none"
					anchor={anchor ?? undefined}
					side="bottom"
					align="start"
					sideOffset={6}
				>
					<Popover.Popup
						initialFocus={inputRef}
						className="w-[19rem] origin-[var(--transform-origin)] rounded-[8px] border border-[var(--color-border-panel)] bg-[var(--color-bg-panel)] p-1.5 shadow-lg transition-[transform,opacity] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
						data-attr="markdown-link-popover"
					>
						<div className="flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--color-border-subtle)] bg-[var(--color-bg-panel-muted)] px-2 text-[var(--color-text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition-[background-color,border-color,box-shadow] duration-100 focus-within:border-[var(--color-border-brand-soft)] focus-within:bg-[var(--color-bg-panel)] focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_0_0_2px_var(--color-bg-brand-soft)]">
							<LinkIcon
								className="size-3.5 shrink-0 text-[var(--color-icon-tertiary)]"
								aria-hidden
							/>
							<input
								ref={inputRef}
								value={value}
								onChange={(event) => setValue(event.target.value)}
								onKeyDown={handleKeyDown}
								aria-label="Link URL"
								placeholder="https://… or ./document.md"
								className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[12.5px] font-medium text-[var(--color-text-primary)] outline-none placeholder:font-normal placeholder:text-[var(--color-text-tertiary)]"
								data-attr="markdown-link-input"
							/>
						</div>
						<div className="mt-1.5 flex items-center gap-1">
							{editing && (
								<button
									type="button"
									onClick={handleRemove}
									className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[12.5px] font-medium text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-status-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]"
									data-attr="markdown-link-remove"
								>
									<Unlink className="size-3.5" aria-hidden />
									Remove
								</button>
							)}
							<Popover.Close className="ml-auto inline-flex h-7 items-center gap-1 rounded-[7px] px-2.5 text-[12.5px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)]">
								<X className="size-3.5" aria-hidden />
								Cancel
							</Popover.Close>
							<button
								type="button"
								onClick={handleApply}
								className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-[var(--color-bg-action-primary)] px-3 text-[12.5px] font-semibold text-[var(--color-text-on-action-primary)] shadow-[0_1px_2px_rgba(194,65,12,0.18)] transition-colors hover:bg-[var(--color-bg-action-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg-panel)]"
								data-attr="markdown-link-apply"
							>
								<Check className="size-3.5" aria-hidden />
								{editing ? "Update" : "Add link"}
							</button>
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}
