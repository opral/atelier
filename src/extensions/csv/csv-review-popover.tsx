import {
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { CSV_COLORS } from "./csv-palette";
import { CSV_TYPES } from "./csv-properties";
import "./csv-review-popover.css";

export type CsvReviewDetail = {
	label: string;
	before?: string;
	after?: string;
	beforeColor?: string;
	afterColor?: string;
};

/** An anchored, non-modal explanation that never participates in table layout. */
export function CsvReviewTrigger({
	label,
	children,
	details,
	className,
	title,
}: {
	label: string;
	children: ReactNode;
	details: readonly CsvReviewDetail[];
	className?: string;
	title?: string;
}) {
	const id = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const pinned = useRef(false);
	const [open, setOpen] = useState(false);
	const [position, setPosition] = useState({ left: 8, top: 8 });
	const [portal, setPortal] = useState<Element | DocumentFragment | null>(null);
	const clearTimer = () => {
		clearTimeout(closeTimer.current);
	};
	const close = (restore = false) => {
		clearTimer();
		const returnFocus = restore && pinned.current;
		pinned.current = false;
		setOpen(false);
		if (returnFocus) trigger.current?.focus({ preventScroll: true });
	};
	const show = (explicit = false) => {
		clearTimer();
		pinned.current = explicit || pinned.current;
		const button = trigger.current;
		if (!button) return;
		const root = button.getRootNode();
		setPortal(
			button.closest(".atelier-root") ??
				(root instanceof ShadowRoot ? root : button.ownerDocument.body),
		);
		setOpen(true);
	};
	const scheduleClose = () => {
		clearTimer();
		if (!pinned.current) closeTimer.current = setTimeout(() => close(), 180);
	};
	useEffect(() => () => clearTimeout(closeTimer.current), []);
	useLayoutEffect(() => {
		if (!open || !content.current || !trigger.current) return;
		const node = content.current;
		const button = trigger.current;
		const doc = button.ownerDocument;
		const win = doc.defaultView!;
		const update = () => {
			const anchor = button.getBoundingClientRect();
			const box = node.getBoundingClientRect();
			const left = Math.max(
				8,
				Math.min(anchor.left, win.innerWidth - box.width - 8),
			);
			const below = anchor.bottom + 6;
			const top = Math.max(
				8,
				Math.min(
					below + box.height <= win.innerHeight - 8
						? below
						: anchor.top - box.height - 6,
					win.innerHeight - box.height - 8,
				),
			);
			setPosition({ left, top });
		};
		update();
		const observer =
			typeof ResizeObserver === "undefined"
				? undefined
				: new ResizeObserver(update);
		observer?.observe(node);
		win.addEventListener("resize", update);
		// Dismiss when its scrolling surface moves; scrolling inside long details is safe.
		const onScroll = (event: Event) => {
			if (!event.composedPath().includes(node)) close();
		};
		doc.addEventListener("scroll", onScroll, true);
		const inside = (event: Event) =>
			event
				.composedPath()
				.some(
					(target) =>
						target instanceof Node &&
						(node.contains(target) || button.contains(target)),
				);
		const onOutside = (event: Event) => {
			if (!inside(event)) close();
		};
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			event.preventDefault();
			close(true);
		};
		doc.addEventListener("pointerdown", onOutside, true);
		doc.addEventListener("focusin", onOutside);
		doc.addEventListener("keydown", onEscape);
		if (pinned.current) node.focus({ preventScroll: true });
		return () => {
			observer?.disconnect();
			win.removeEventListener("resize", update);
			doc.removeEventListener("scroll", onScroll, true);
			doc.removeEventListener("pointerdown", onOutside, true);
			doc.removeEventListener("focusin", onOutside);
			doc.removeEventListener("keydown", onEscape);
		};
	}, [open, portal]);
	return (
		<>
			<button
				ref={trigger}
				type="button"
				className={`csv-review-trigger ${className ?? ""}`}
				aria-label={label}
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-controls={open ? id : undefined}
				onPointerEnter={(event) => {
					if (event.pointerType !== "touch") show();
				}}
				onPointerLeave={scheduleClose}
				onClick={() => {
					if (open && pinned.current) close();
					else {
						show(true);
						content.current?.focus({ preventScroll: true });
					}
				}}
			>
				{children}
			</button>
			{open &&
				portal &&
				createPortal(
					<div
						ref={content}
						id={id}
						role="dialog"
						aria-label={title ?? label}
						tabIndex={-1}
						className="csv-review-popover"
						style={position}
						onPointerEnter={clearTimer}
						onPointerLeave={scheduleClose}
					>
						<div className="csv-review-popover-heading">
							<strong>{title ?? label}</strong>
							<button
								type="button"
								aria-label="Close change details"
								onClick={() => close(true)}
							>
								<X size={14} />
							</button>
						</div>
						{details.map((detail, index) => (
							<section
								className="csv-review-detail"
								key={`${detail.label}-${index}`}
							>
								<h4>{detail.label}</h4>
								<dl>
									<div data-side="before">
										<dt>Before</dt>
										<dd>
											{displayValue(
												detail.before,
												detail.beforeColor,
												detail.label,
											)}
										</dd>
									</div>
									<div data-side="after">
										<dt>After</dt>
										<dd>
											{displayValue(
												detail.after,
												detail.afterColor,
												detail.label,
											)}
										</dd>
									</div>
								</dl>
							</section>
						))}
					</div>,
					portal,
				)}
		</>
	);
}

function displayValue(
	value: string | undefined,
	color?: string,
	label?: string,
) {
	if (value === undefined)
		return <span className="csv-review-absent">Not present</span>;
	if (value === "") return <span className="csv-review-absent">Empty</span>;
	if (color && Object.hasOwn(CSV_COLORS, color)) {
		const [background, foreground] =
			CSV_COLORS[color as keyof typeof CSV_COLORS];
		return (
			<span
				className="csv-review-detail-pill"
				data-color={color}
				style={{ background, color: foreground }}
				role="img"
				aria-label={`${value}, ${color}`}
				title={`${value}, ${color}`}
			>
				{value}
			</span>
		);
	}
	if (label?.endsWith("Property type")) {
		const type = CSV_TYPES.find((candidate) => candidate.type === value);
		if (type) {
			const Icon = type.icon;
			return (
				<span className="csv-review-detail-type">
					<Icon size={14} aria-hidden="true" />
					{type.label}
				</span>
			);
		}
	}
	return value;
}
