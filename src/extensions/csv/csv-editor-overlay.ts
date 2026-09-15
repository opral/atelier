import { useEffect, useRef } from "react";

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

/** Puts the portal in place before the first cell editor asks for it. */
export function useGlideOverlayPortal(): void {
	useEffect(() => {
		ensureGlideOverlayPortal();
	}, []);
}

/**
 * An overlay anchored to a cell or a header: Glide's own editor, our cell
 * pickers, and the row and column menus. Each is positioned once, against the
 * table as it stood when it opened.
 */
const EDITOR =
	".csv-property-popover, .gdg-style, .csv-column-menu, .csv-grid-menu";
/**
 * The parts of one of those that scroll on their own — including a menu that
 * is taller than the window, which scrolls its own items. A wheel there was
 * closing the menu instead, so the items below the fold could not be reached
 * with the wheel at all.
 */
const EDITOR_LIST =
	".csv-option-list, .gdg-clip-region, .csv-column-menu, .csv-grid-menu";
/** Glide's scroller: the element that carries the table under the editor. */
const GRID_SCROLLER = ".dvn-scroller";

function closest(target: EventTarget | null, selector: string): Element | null {
	return target instanceof Element ? target.closest(selector) : null;
}

/**
 * Whether a scroll leaves an open editor stranded: a list inside the editor
 * that can still move is scrolling itself, everything else is the grid moving
 * out from under the editor.
 *
 * A wheel is not a scroll. It was treated as one — an editor swallows the
 * wheel, so the grid never moves and no scroll event follows — but that closed
 * an editor on any flick over it, discarding the edit even when the table had
 * nowhere to go. The wheel is handed to the grid instead, and the scroll it
 * causes does the closing; a table that cannot move keeps its editor.
 */
export function scrollLeavesEditorBehind(
	event: Pick<Event, "type" | "target">,
): boolean {
	if (event.type === "wheel") return false;
	const list = closest(event.target, EDITOR_LIST);
	if (list && list.scrollHeight > list.clientHeight) return false;
	// The page moving counts; a sidebar or some other panel scrolling on its
	// own leaves the cell exactly where the editor left it.
	if (!(event.target instanceof Element)) return true;
	return event.target.closest(GRID_SCROLLER) !== null;
}

/**
 * The grid under an open overlay: the scroller whose box the overlay sits over,
 * or the only one on the page. The overlay is portalled to the body, so it
 * cannot be found by walking up from it.
 */
function gridScrollerUnder(node: Element): HTMLElement | null {
	const scrollers = [
		...node.ownerDocument.querySelectorAll<HTMLElement>(GRID_SCROLLER),
	];
	if (scrollers.length <= 1) return scrollers[0] ?? null;
	const box = node.getBoundingClientRect();
	return (
		scrollers.find((scroller) => {
			const rect = scroller.getBoundingClientRect();
			return (
				box.left < rect.right &&
				box.right > rect.left &&
				box.top < rect.bottom &&
				box.bottom > rect.top
			);
		}) ?? null
	);
}

/**
 * A wheel over an open overlay moves the table beneath it, as it would were
 * the overlay a cell inside the scroller. The scroll that follows is what
 * closes the overlay, so a table with nowhere to go keeps it.
 */
function wheelReachesTheGrid(event: WheelEvent): void {
	const over = closest(event.target, EDITOR);
	if (!over) return;
	const list = closest(event.target, EDITOR_LIST);
	// A list with room left consumes its own wheel.
	if (list && list.scrollHeight > list.clientHeight) return;
	const scroller = gridScrollerUnder(over);
	if (!scroller) return;
	scroller.scrollBy(event.deltaX, event.deltaY);
	event.preventDefault();
}

/**
 * An open cell editor or menu belongs to the cell or header underneath it.
 * Once the grid scrolls, that anchor has moved, and an overlay that slides
 * along with it — or stays behind, naming a column now three columns over —
 * reads as a bug. Scrolling closes it instead, keeping whatever was typed,
 * the way a scroll dismisses an open cell in Notion.
 */
export function useEditorClosesOnGridScroll(close: () => void): void {
	const dismiss = useRef(close);
	dismiss.current = close;
	useEffect(() => {
		if (typeof document === "undefined") return;
		// Opening an editor can scroll its own cell into view; arm only once
		// that settles, so the editor does not close on the way there.
		let armed = false;
		let closed = false;
		const outer = requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				armed = true;
			});
		});
		const onScroll = (event: Event) => {
			if (!armed || closed || !scrollLeavesEditorBehind(event)) return;
			closed = true;
			dismiss.current();
		};
		document.addEventListener("scroll", onScroll, true);
		document.addEventListener("wheel", wheelReachesTheGrid, {
			capture: true,
			passive: false,
		});
		return () => {
			cancelAnimationFrame(outer);
			document.removeEventListener("scroll", onScroll, true);
			document.removeEventListener("wheel", wheelReachesTheGrid, true);
		};
	}, []);
}
