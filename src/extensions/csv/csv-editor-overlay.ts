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
 * Whether a scroll or wheel leaves an open editor stranded: a list inside the
 * editor that can still move is scrolling itself, everything else is the grid
 * moving out from under the editor.
 */
export function scrollLeavesEditorBehind(
	event: Pick<Event, "type" | "target">,
): boolean {
	const list = closest(event.target, EDITOR_LIST);
	if (list && list.scrollHeight > list.clientHeight) return false;
	// A wheel over the editor itself never reaches the grid, so nothing would
	// scroll and no scroll event would follow; close on the wheel instead.
	if (event.type === "wheel") return closest(event.target, EDITOR) !== null;
	// The page moving counts; a sidebar or some other panel scrolling on its
	// own leaves the cell exactly where the editor left it.
	if (!(event.target instanceof Element)) return true;
	return event.target.closest(GRID_SCROLLER) !== null;
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
		document.addEventListener("wheel", onScroll, true);
		return () => {
			cancelAnimationFrame(outer);
			document.removeEventListener("scroll", onScroll, true);
			document.removeEventListener("wheel", onScroll, true);
		};
	}, []);
}
