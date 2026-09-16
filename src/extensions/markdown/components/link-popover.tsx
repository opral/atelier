import {
	useCallback,
	useEffect,
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
import { getClipRect, isAnchorClipped } from "./clip-rect";
import { ToolbarIconButton } from "./toolbar-icon-button";

type SelectionAnchor = {
	getBoundingClientRect: () => DOMRect;
	contextElement: Element;
};

/**
 * A Floating UI virtual element tracking the editor selection, so popups
 * open next to the text they act on rather than next to a toolbar button.
 * The rect spans the first to the last line of the selection, clamped to the
 * editor's scroll viewport: the selection can scroll past the top of that
 * viewport, but the popup that edits it must not follow it out over the
 * formatting toolbar and the tab strip.
 */
export function createSelectionAnchor(editor: Editor): SelectionAnchor {
	return {
		contextElement: editor.view.dom,
		getBoundingClientRect: () => {
			const { view, state } = editor;
			const { from, to } = state.selection;
			const start = view.coordsAtPos(from);
			const end = to === from ? start : view.coordsAtPos(to);
			const clip = getClipRect(view.dom);
			const left = clamp(Math.min(start.left, end.left), clip.left, clip.right);
			const top = clamp(Math.min(start.top, end.top), clip.top, clip.bottom);
			const right = clamp(
				Math.max(start.right, end.right, left),
				left,
				clip.right,
			);
			const bottom = clamp(
				Math.max(start.bottom, end.bottom, top),
				top,
				clip.bottom,
			);
			return new DOMRect(left, top, right - left, bottom - top);
		},
	};
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), Math.max(low, high));
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
		// caret and selection go back where they were. Only those — focusing
		// the editor scrolls the caret into view by default, and this is the
		// close a wheel gesture triggers, so the reader's own scroll was being
		// rewound to the text they had just scrolled away from.
		if (editor && !editor.isDestroyed) {
			editor.chain().focus(null, { scrollIntoView: false }).run();
		}
		onOpenChange(false);
	}, [editor, onOpenChange]);

	// Scrolling the text being linked out of the editor's viewport ends the
	// edit. The URL field holds keyboard focus while it is open, so a popover
	// that merely went out of sight left the user typing into a field they
	// could not see and applying a link to text they could not see either.
	useEffect(() => {
		if (!open || !editor || editor.isDestroyed) return;
		const closeWhenAnchorLeaves = () => {
			if (editor.isDestroyed) return;
			const { view, state } = editor;
			let coords: { top: number; bottom: number };
			try {
				coords = view.coordsAtPos(state.selection.from);
			} catch {
				return;
			}
			if (isAnchorClipped(coords, getClipRect(view.dom))) close();
		};
		window.addEventListener("scroll", closeWhenAnchorLeaves, true);
		window.addEventListener("resize", closeWhenAnchorLeaves);
		return () => {
			window.removeEventListener("scroll", closeWhenAnchorLeaves, true);
			window.removeEventListener("resize", closeWhenAnchorLeaves);
		};
	}, [close, editor, open]);

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
						className="w-[19rem] origin-[var(--transform-origin)] rounded-[8px] border border-border bg-panel p-1.5 shadow-lg transition-[transform,opacity] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0"
						data-attr="markdown-link-popover"
					>
						<div className="flex h-8 items-center gap-1.5 rounded-[7px] border border-border-subtle bg-bg-subtle px-2 text-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] transition-[background-color,border-color,box-shadow] duration-100 focus-within:border-accent-border focus-within:bg-panel focus-within:shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_0_0_2px_var(--at-accent-subtle)]">
							<LinkIcon
								className="size-3.5 shrink-0 text-fg-subtle"
								aria-hidden
							/>
							<input
								ref={inputRef}
								value={value}
								onChange={(event) => setValue(event.target.value)}
								onKeyDown={handleKeyDown}
								aria-label="Link URL"
								placeholder="https://… or ./document.md"
								className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 text-[12.5px] font-medium text-fg outline-none placeholder:font-normal placeholder:text-fg-subtle"
								data-attr="markdown-link-input"
							/>
						</div>
						<div className="mt-1.5 flex items-center gap-1">
							{editing && (
								<button
									type="button"
									onClick={handleRemove}
									className="inline-flex h-7 items-center gap-1 rounded-[7px] px-2 text-[12.5px] font-medium text-fg-subtle transition-colors hover:bg-bg-hover hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									data-attr="markdown-link-remove"
								>
									<Unlink className="size-3.5" aria-hidden />
									Remove
								</button>
							)}
							<Popover.Close className="ml-auto inline-flex h-7 items-center gap-1 rounded-[7px] px-2.5 text-[12.5px] font-medium text-fg-muted transition-colors hover:bg-bg-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
								<X className="size-3.5" aria-hidden />
								Cancel
							</Popover.Close>
							<button
								type="button"
								onClick={handleApply}
								className="inline-flex h-7 items-center gap-1 rounded-[7px] bg-bg-hover px-3 text-[12.5px] font-semibold text-accent-on shadow-[0_1px_2px_rgba(194,65,12,0.18)] transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-panel"
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
