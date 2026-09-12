import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Thin overlay scrollbars for the grid, drawn over its edges instead of the
 * platform's, which take a gutter and dress like a document window. They
 * show while the grid scrolls or the pointer is over it, fade otherwise,
 * and drag. The scroller stays Glide's own element; this only reflects it.
 */

const THUMB_THICKNESS = 6;
const THUMB_MIN_LENGTH = 28;
const EDGE_INSET = 3;
const FADE_AFTER_MS = 900;

/** Where a thumb sits along its track for the scroller's current metrics. */
export function thumbGeometry(input: {
	readonly scrollSize: number;
	readonly clientSize: number;
	readonly scrollPosition: number;
	readonly trackLength: number;
}): { readonly length: number; readonly offset: number } | null {
	const { scrollSize, clientSize, scrollPosition, trackLength } = input;
	if (scrollSize <= clientSize + 1 || clientSize <= 0 || trackLength <= 0)
		return null;
	const length = Math.max(
		THUMB_MIN_LENGTH,
		Math.round((clientSize / scrollSize) * trackLength),
	);
	const travel = trackLength - length;
	const maxScroll = scrollSize - clientSize;
	const offset = Math.round((scrollPosition / maxScroll) * travel);
	return { length, offset: Math.min(Math.max(offset, 0), travel) };
}

type Thumbs = {
	readonly horizontal: { length: number; offset: number } | null;
	readonly vertical: { length: number; offset: number } | null;
};

export function CsvOverlayScrollbars({
	containerRef,
	scrollerSelector,
}: {
	readonly containerRef: RefObject<HTMLElement | null>;
	/** The scrolling element inside the container, re-found when it remounts. */
	readonly scrollerSelector: string;
}) {
	const [thumbs, setThumbs] = useState<Thumbs>({
		horizontal: null,
		vertical: null,
	});
	// The scroller's box inside the container: the container also holds the
	// footer row, and the thumbs belong on the scroller's own edges.
	const [box, setBox] = useState<{
		left: number;
		top: number;
		width: number;
		height: number;
	} | null>(null);
	const [active, setActive] = useState(false);
	const scrollerRef = useRef<HTMLElement | null>(null);
	const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		let disposed = false;
		let detach: (() => void) | null = null;
		const measure = () => {
			const scroller = scrollerRef.current;
			if (!scroller) return;
			const outer = container.getBoundingClientRect();
			const inner = scroller.getBoundingClientRect();
			setBox({
				left: inner.left - outer.left,
				top: inner.top - outer.top,
				width: inner.width,
				height: inner.height,
			});
			setThumbs({
				horizontal: thumbGeometry({
					scrollSize: scroller.scrollWidth,
					clientSize: scroller.clientWidth,
					scrollPosition: scroller.scrollLeft,
					trackLength: scroller.clientWidth - EDGE_INSET * 2 - THUMB_THICKNESS,
				}),
				vertical: thumbGeometry({
					scrollSize: scroller.scrollHeight,
					clientSize: scroller.clientHeight,
					scrollPosition: scroller.scrollTop,
					trackLength: scroller.clientHeight - EDGE_INSET * 2 - THUMB_THICKNESS,
				}),
			});
		};
		const wake = () => {
			setActive(true);
			if (fadeTimer.current) clearTimeout(fadeTimer.current);
			fadeTimer.current = setTimeout(() => setActive(false), FADE_AFTER_MS);
		};
		const attach = () => {
			const scroller = container.querySelector<HTMLElement>(scrollerSelector);
			if (scroller === scrollerRef.current) return;
			detach?.();
			detach = null;
			scrollerRef.current = scroller;
			if (!scroller) {
				setThumbs({ horizontal: null, vertical: null });
				setBox(null);
				return;
			}
			const onScroll = () => {
				measure();
				wake();
			};
			scroller.addEventListener("scroll", onScroll, { passive: true });
			const resize =
				typeof ResizeObserver === "undefined"
					? null
					: new ResizeObserver(() => measure());
			resize?.observe(scroller);
			for (const child of scroller.children) resize?.observe(child);
			detach = () => {
				scroller.removeEventListener("scroll", onScroll);
				resize?.disconnect();
			};
			measure();
		};
		attach();
		// Glide remounts its scroller when the grid does; follow it.
		const observer =
			typeof MutationObserver === "undefined"
				? null
				: new MutationObserver(() => {
						if (!disposed) attach();
					});
		observer?.observe(container, { childList: true, subtree: true });
		return () => {
			disposed = true;
			observer?.disconnect();
			detach?.();
			if (fadeTimer.current) clearTimeout(fadeTimer.current);
		};
	}, [containerRef, scrollerSelector]);

	const dragThumb =
		(axis: "horizontal" | "vertical") =>
		(event: React.PointerEvent<HTMLDivElement>) => {
			const scroller = scrollerRef.current;
			const thumb = thumbs[axis];
			if (!scroller || !thumb || event.button !== 0) return;
			event.preventDefault();
			const startPointer =
				axis === "horizontal" ? event.clientX : event.clientY;
			const startScroll =
				axis === "horizontal" ? scroller.scrollLeft : scroller.scrollTop;
			const clientSize =
				axis === "horizontal" ? scroller.clientWidth : scroller.clientHeight;
			const scrollSize =
				axis === "horizontal" ? scroller.scrollWidth : scroller.scrollHeight;
			const trackLength = clientSize - EDGE_INSET * 2 - THUMB_THICKNESS;
			const travel = Math.max(1, trackLength - thumb.length);
			const ratio = (scrollSize - clientSize) / travel;
			const target = event.currentTarget;
			target.setPointerCapture(event.pointerId);
			const move = (moveEvent: PointerEvent) => {
				const pointer =
					axis === "horizontal" ? moveEvent.clientX : moveEvent.clientY;
				const next = startScroll + (pointer - startPointer) * ratio;
				if (axis === "horizontal") scroller.scrollLeft = next;
				else scroller.scrollTop = next;
			};
			const up = () => {
				target.removeEventListener("pointermove", move);
				target.removeEventListener("pointerup", up);
				target.removeEventListener("pointercancel", up);
			};
			target.addEventListener("pointermove", move);
			target.addEventListener("pointerup", up);
			target.addEventListener("pointercancel", up);
		};

	return (
		<div
			className="csv-overlay-scrollbars"
			data-active={active ? "true" : undefined}
			aria-hidden="true"
			style={box ?? undefined}
		>
			{thumbs.horizontal ? (
				<div
					className="csv-overlay-thumb csv-overlay-thumb-horizontal"
					style={{
						width: thumbs.horizontal.length,
						transform: `translateX(${thumbs.horizontal.offset}px)`,
					}}
					onPointerDown={dragThumb("horizontal")}
				/>
			) : null}
			{thumbs.vertical ? (
				<div
					className="csv-overlay-thumb csv-overlay-thumb-vertical"
					style={{
						height: thumbs.vertical.length,
						transform: `translateY(${thumbs.vertical.offset}px)`,
					}}
					onPointerDown={dragThumb("vertical")}
				/>
			) : null}
		</div>
	);
}
