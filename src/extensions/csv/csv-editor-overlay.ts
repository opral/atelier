import { useEffect, type RefObject } from "react";

/**
 * Glide opens its cell editor in a body-level portal at the cell's screen
 * position and never moves it again, so the grid scrolled away underneath
 * while the editor stayed put. This follows the scroller: the editor moves
 * with its cell and is clipped to the grid's viewport, under the header and
 * row markers, as an editor inside the scroller would be.
 */

export type EditorOverlayFollow = {
	readonly transform: string;
	readonly clipPath: string;
};

/**
 * The editor's offset for how far the scroller moved since it opened, and
 * the viewport rectangle it stays clipped to, in the overlay's own
 * (translated) coordinates.
 */
export function editorOverlayFollow(input: {
	readonly origin: { readonly x: number; readonly y: number };
	readonly scroll: { readonly x: number; readonly y: number };
	readonly viewport: {
		readonly left: number;
		readonly top: number;
		readonly right: number;
		readonly bottom: number;
	};
}): EditorOverlayFollow {
	const dx = input.origin.x - input.scroll.x;
	const dy = input.origin.y - input.scroll.y;
	const { left, top, right, bottom } = input.viewport;
	const point = (x: number, y: number) => `${x - dx}px ${y - dy}px`;
	return {
		transform: dx === 0 && dy === 0 ? "" : `translate(${dx}px, ${dy}px)`,
		clipPath: `polygon(${point(left, top)}, ${point(right, top)}, ${point(right, bottom)}, ${point(left, bottom)})`,
	};
}

/**
 * Glide's overlay editor mounts into a hardcoded `document.getElementById("portal")`
 * and silently fails to open without it. Atelier is a library, so hosts cannot
 * be expected to provide the div — create it on demand. The class scopes the
 * editor's styling, which lives outside the shell's stylesheet scope.
 */
export function ensureGlideOverlayPortal(): HTMLElement | null {
	if (typeof document === "undefined") return null;
	let portal = document.getElementById("portal");
	if (!portal) {
		portal = document.createElement("div");
		portal.id = "portal";
		portal.style.position = "fixed";
		portal.style.left = "0";
		portal.style.top = "0";
		portal.style.zIndex = "9999";
		document.body.appendChild(portal);
	}
	portal.classList.add("atelier-csv-portal");
	return portal;
}

type Tracked = {
	readonly node: HTMLElement;
	readonly scroller: HTMLElement;
	readonly origin: { readonly x: number; readonly y: number };
};

/**
 * Keeps an open cell editor on its cell while the grid inside `containerRef`
 * scrolls. `inset` is the header height and row-marker width the editor is
 * clipped beneath.
 */
export function useEditorOverlayFollowsScroll(
	containerRef: RefObject<HTMLElement | null>,
	inset: { readonly top: number; readonly left: number },
	enabled: boolean,
): void {
	const { top: insetTop, left: insetLeft } = inset;
	useEffect(() => {
		const container = containerRef.current;
		if (!enabled || !container) return;
		const portal = ensureGlideOverlayPortal();
		if (!portal || typeof MutationObserver === "undefined") return;
		let tracked: Tracked | null = null;
		const apply = () => {
			if (!tracked) return;
			const { node, scroller, origin } = tracked;
			const rect = scroller.getBoundingClientRect();
			const follow = editorOverlayFollow({
				origin,
				scroll: { x: scroller.scrollLeft, y: scroller.scrollTop },
				viewport: {
					left: rect.left + insetLeft,
					top: rect.top + insetTop,
					right: rect.right,
					bottom: rect.bottom,
				},
			});
			node.style.transform = follow.transform;
			node.style.clipPath = follow.clipPath;
		};
		const track = (node: HTMLElement) => {
			const scroller = container.querySelector<HTMLElement>(".dvn-scroller");
			const editor = node.firstElementChild;
			if (!scroller || !(editor instanceof HTMLElement)) return;
			// Only an editor opened over this grid; the portal is shared.
			const box = editor.getBoundingClientRect();
			const grid = scroller.getBoundingClientRect();
			if (
				box.right < grid.left ||
				box.left > grid.right ||
				box.bottom < grid.top ||
				box.top > grid.bottom
			)
				return;
			tracked = {
				node,
				scroller,
				origin: { x: scroller.scrollLeft, y: scroller.scrollTop },
			};
			apply();
		};
		for (const child of portal.children)
			if (child instanceof HTMLElement) track(child);
		const observer = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.removedNodes)
					if (tracked?.node === node) tracked = null;
				for (const node of record.addedNodes)
					if (node instanceof HTMLElement) track(node);
			}
		});
		observer.observe(portal, { childList: true });
		const onScroll = (event: Event) => {
			if (tracked && event.target === tracked.scroller) apply();
		};
		container.addEventListener("scroll", onScroll, true);
		// A wheel over the editor scrolls the grid it sits on, as it would
		// were the editor inside the scroller.
		const onWheel = (event: WheelEvent) => {
			if (!tracked || !(event.target instanceof Node)) return;
			if (!tracked.node.contains(event.target)) return;
			const region = tracked.node.querySelector(".gdg-clip-region");
			if (region && region.scrollHeight > region.clientHeight) return;
			tracked.scroller.scrollBy(event.deltaX, event.deltaY);
			event.preventDefault();
		};
		portal.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			observer.disconnect();
			container.removeEventListener("scroll", onScroll, true);
			portal.removeEventListener("wheel", onWheel);
		};
	}, [containerRef, enabled, insetLeft, insetTop]);
}
