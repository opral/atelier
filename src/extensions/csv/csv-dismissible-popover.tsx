import {
	createContext,
	useContext,
	useEffect,
	useId,
	useRef,
	type ReactNode,
	type RefObject,
} from "react";

const PopoverOwner = createContext<string | undefined>(undefined);

/** Include portalled controls in their parent popover's interaction boundary. */
export function useCsvPopoverOwner() {
	return useContext(PopoverOwner);
}

export function CsvDismissiblePopover({
	children,
	label,
	trigger,
	onDismiss,
	className,
}: {
	children: ReactNode;
	label: string;
	trigger: RefObject<HTMLButtonElement | null>;
	onDismiss: () => void;
	className?: string;
}) {
	const owner = useId();
	const content = useRef<HTMLDivElement>(null);
	const dismiss = useRef(onDismiss);
	dismiss.current = onDismiss;
	useEffect(() => {
		const node = content.current;
		if (!node) return;
		const doc = node.ownerDocument;
		let closed = false;
		const close = () => {
			if (closed) return;
			closed = true;
			dismiss.current();
		};
		const isInside = (event: Event) =>
			event
				.composedPath()
				.some(
					(target) =>
						(target instanceof Node &&
							(node.contains(target) || trigger.current?.contains(target))) ||
						(target instanceof Element &&
							target.getAttribute("data-csv-popover-owner") === owner),
				);
		const onOutside = (event: Event) => {
			if (!isInside(event)) close();
		};
		const onEscape = (event: KeyboardEvent) => {
			// Nested menus get first chance to consume Escape.
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			close();
			trigger.current?.focus();
		};
		doc.addEventListener("pointerdown", onOutside, true);
		doc.addEventListener("focusin", onOutside);
		doc.addEventListener("keydown", onEscape);
		if (trigger.current?.matches(":focus-visible")) {
			node.querySelector<HTMLElement>('[aria-haspopup="menu"], input')?.focus();
		}
		return () => {
			doc.removeEventListener("pointerdown", onOutside, true);
			doc.removeEventListener("focusin", onOutside);
			doc.removeEventListener("keydown", onEscape);
		};
	}, [owner, trigger]);
	return (
		<PopoverOwner.Provider value={owner}>
			<div
				ref={content}
				className={`csv-toolbar-popover csv-property-popover ${className ?? ""}`}
				role="dialog"
				aria-label={label}
			>
				{children}
			</div>
		</PopoverOwner.Provider>
	);
}
