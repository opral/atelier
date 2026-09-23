import {
	useEffect,
	useId,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import "./comments.css";

/**
 * A comment's "…": on the reader's own comments, a small icon at the end of
 * its header, shown while the comment is pointed at or has focus (like
 * "Open conversation"), so a thread at rest looks as designed. It opens a
 * menu whose "Delete comment" deletes at once: no question in between.
 *
 * Only a fresh press acts: a click, or an Enter or Space pressed on the
 * item. The Enter that opened the menu, still held and repeating, lands on
 * the item it focused and must not delete. Arrow keys move through the
 * menu, Esc closes it and gives the keyboard back to the "…" (and goes no
 * further: the card, the checkpoint stay open).
 */
export function CommentActions({
	onDelete,
}: {
	/** Resolves once the comment is gone; a rejection is said in the menu. */
	readonly onDelete: () => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);
	const menuId = useId();
	// Set by a press that began on an item since the menu opened.
	const armedRef = useRef(false);

	// The first item takes the keyboard as the menu opens.
	useEffect(() => {
		if (!open) return;
		armedRef.current = false;
		menuRef.current
			?.querySelector<HTMLElement>("[role=menuitem]")
			?.focus({ preventScroll: true });
	}, [open]);

	// A press anywhere else closes it, as a click away closes any menu.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				rootRef.current?.contains(event.target)
			)
				return;
			close(false);
		};
		document.addEventListener("pointerdown", onPointerDown, true);
		return () =>
			document.removeEventListener("pointerdown", onPointerDown, true);
	}, [open]);

	function close(refocus: boolean) {
		setOpen(false);
		setError(null);
		if (refocus) triggerRef.current?.focus({ preventScroll: true });
	}

	async function remove() {
		if (!armedRef.current || pending) return;
		armedRef.current = false;
		setPending(true);
		setError(null);
		try {
			await onDelete();
			// The row goes with the comment; if it is still here (a slow read),
			// the menu at least is not.
			setOpen(false);
		} catch (cause) {
			console.error(cause);
			setError("Could not delete the comment. Try again.");
		} finally {
			setPending(false);
		}
	}

	function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
		if (event.key === "Escape") {
			// The menu's: not the card's, the checkpoint's or the review's.
			event.preventDefault();
			event.stopPropagation();
			close(true);
			return;
		}
		if (event.key === "Enter" || event.key === " ") {
			// A held key repeating is not a press: it neither acts nor arms.
			if (event.repeat) event.preventDefault();
			else armedRef.current = true;
			return;
		}
		if (event.key === "Tab") {
			close(false);
			return;
		}
		const items = [
			...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ??
				[]),
		];
		const current = items.indexOf(document.activeElement as HTMLElement);
		const step: Record<string, number> = {
			ArrowDown: current + 1,
			ArrowRight: current + 1,
			ArrowUp: current - 1,
			ArrowLeft: current - 1,
			Home: 0,
			End: items.length - 1,
		};
		const next = step[event.key];
		if (next === undefined || items.length === 0) return;
		event.preventDefault();
		event.stopPropagation();
		items[(next + items.length) % items.length]?.focus({
			preventScroll: true,
		});
	}

	return (
		<div
			ref={rootRef}
			className="comment-actions"
			data-open={open ? "" : undefined}
		>
			<button
				ref={triggerRef}
				type="button"
				aria-label="Comment actions"
				title="More"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				data-attr="comment-actions"
				className="comment-action"
				onClick={() => (open ? close(false) : setOpen(true))}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown" && !open) {
						event.preventDefault();
						setOpen(true);
					}
				}}
			>
				<svg
					aria-hidden="true"
					viewBox="0 0 24 24"
					className="size-3.5"
					fill="none"
					stroke="currentColor"
					strokeWidth={2}
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<circle cx="12" cy="12" r="1" />
					<circle cx="19" cy="12" r="1" />
					<circle cx="5" cy="12" r="1" />
				</svg>
			</button>
			{open ? (
				<div
					ref={menuRef}
					id={menuId}
					role="menu"
					aria-label="Comment actions"
					data-attr="comment-menu"
					tabIndex={-1}
					className="comment-menu"
					onKeyDown={onMenuKeyDown}
					onBlur={(event) => {
						const next = event.relatedTarget as Node | null;
						if (next && rootRef.current?.contains(next)) return;
						// Focus that went nowhere (a click on the menu's own
						// padding) is not leaving it.
						if (next === null) return;
						close(false);
					}}
				>
					<button
						type="button"
						role="menuitem"
						tabIndex={-1}
						data-attr="comment-delete"
						aria-disabled={pending || undefined}
						className="comment-menu-item"
						data-tone="danger"
						onPointerDown={() => {
							armedRef.current = true;
						}}
						onClick={() => void remove()}
					>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							className="size-3.5 shrink-0"
							fill="none"
							stroke="currentColor"
							strokeWidth={2}
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<path d="M3 6h18" />
							<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
							<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
						</svg>
						Delete comment
					</button>
					{error ? (
						<p role="alert" className="comment-menu-error">
							{error}
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
