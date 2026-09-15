/**
 * Where a `position: fixed` panel anchored to the caret is allowed to be.
 *
 * The editor is not the window. It sits in a scrolling container, under a
 * formatting toolbar and a tab strip, and a panel that ignores that paints
 * over chrome it cannot be clicked through, or drifts off the top of the
 * screen while it still answers the keyboard. Every caret-anchored popup in
 * this extension measures itself against this rectangle.
 */
export type ClipRect = {
	readonly top: number;
	readonly left: number;
	readonly bottom: number;
	readonly right: number;
};

/**
 * The rectangle a fixed panel must stay inside: the viewport, narrowed by
 * every scrolling ancestor of the editor that reports a real size.
 */
export function getClipRect(element: HTMLElement): ClipRect {
	let top = 0;
	let left = 0;
	let bottom = window.innerHeight;
	let right = window.innerWidth;
	let node = element.parentElement;
	while (node) {
		const style = window.getComputedStyle(node);
		if (/(auto|scroll|hidden)/.test(`${style.overflowY} ${style.overflowX}`)) {
			const rect = node.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) {
				top = Math.max(top, rect.top);
				left = Math.max(left, rect.left);
				bottom = Math.min(bottom, rect.bottom);
				right = Math.min(right, rect.right);
			}
		}
		node = node.parentElement;
	}
	return { top, left, bottom, right };
}

/** The caret line has scrolled out of the editor's viewport entirely. */
export function isAnchorClipped(
	coords: { readonly top: number; readonly bottom: number },
	clip: ClipRect,
): boolean {
	return coords.bottom < clip.top || coords.top > clip.bottom;
}

/** Vertical room a panel placed above or below the caret line actually has. */
export type ClampedPlacement = {
	readonly top: number | null;
	readonly bottom: number | null;
	readonly maxHeight: number;
	readonly placement: "above" | "below";
};

/**
 * Place a panel of at most `preferredHeight` against the caret line, on the
 * side with more room, and keep both of its edges inside `clip`. The returned
 * `maxHeight` is what is left over there — the panel shrinks rather than
 * reaching past the editor's viewport into the chrome around it.
 */
export function clampToClipRect({
	coords,
	clip,
	preferredHeight,
	gap,
}: {
	readonly coords: { readonly top: number; readonly bottom: number };
	readonly clip: ClipRect;
	readonly preferredHeight: number;
	readonly gap: number;
}): ClampedPlacement {
	const roomBelow = clip.bottom - coords.bottom - gap;
	const roomAbove = coords.top - clip.top - gap;
	if (roomBelow >= preferredHeight || roomBelow >= roomAbove) {
		return {
			top: Math.max(clip.top, coords.bottom + gap),
			bottom: null,
			maxHeight: Math.max(0, Math.min(preferredHeight, roomBelow)),
			placement: "below",
		};
	}
	return {
		top: null,
		// Anchored by its bottom edge, so the panel hugs the caret line
		// whatever height the list ends up with.
		bottom: window.innerHeight - Math.min(coords.top - gap, clip.bottom),
		maxHeight: Math.max(0, Math.min(preferredHeight, roomAbove)),
		placement: "above",
	};
}

/** Keep a panel `width` wide inside the editor's horizontal bounds. */
export function clampLeft({
	left,
	width,
	clip,
	gap,
}: {
	readonly left: number;
	readonly width: number;
	readonly clip: ClipRect;
	readonly gap: number;
}): number {
	const rightmost = clip.right - width - gap;
	if (rightmost <= clip.left) return clip.left;
	return Math.max(clip.left, Math.min(left, rightmost));
}
