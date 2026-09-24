import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type {
	AtelierExtensionPreferences,
	AtelierJsonValue,
} from "@/extension-api";

/**
 * Where the canvas is looking: Excalidraw's scroll offset and zoom.
 *
 * The viewport is the reader's, not the document's — Excalidraw drops it from
 * the saved scene (`serializeAsJSON(…, "local")`), and so do we. It is kept
 * per file instead: in memory for this page, and in the extension's private
 * preferences so a reload or a reopened tab comes back to the same place.
 */
export type ExcalidrawViewport = {
	readonly scrollX: number;
	readonly scrollY: number;
	readonly zoom: number;
};

/** The preference key holding `{ [fileId]: { scrollX, scrollY, zoom, at } }`. */
export const VIEWPORTS_PREFERENCE_KEY = "viewports";
/** Oldest viewports are forgotten beyond this many files. */
export const MAX_REMEMBERED_VIEWPORTS = 50;
/**
 * A preference write re-renders the shell, so a pan or a pinch is saved
 * once it has settled, not on every frame. Unmounting flushes it.
 */
export const VIEWPORT_PERSIST_DEBOUNCE_MS = 750;

type RememberedViewport = ExcalidrawViewport & { readonly at: number };

/** Every viewport seen on this page, newest last written. */
const sessionViewports = new Map<string, RememberedViewport>();

/** Test hook: forget what this page remembers, as a reload would. */
export function forgetSessionViewports(): void {
	sessionViewports.clear();
}

export function viewportsEqual(
	a: ExcalidrawViewport | undefined,
	b: ExcalidrawViewport | undefined,
): boolean {
	return (
		a === b ||
		(a !== undefined &&
			b !== undefined &&
			a.scrollX === b.scrollX &&
			a.scrollY === b.scrollY &&
			a.zoom === b.zoom)
	);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function readRemembered(value: unknown): RememberedViewport | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	if (
		!isFiniteNumber(record.scrollX) ||
		!isFiniteNumber(record.scrollY) ||
		!isFiniteNumber(record.zoom) ||
		record.zoom <= 0
	) {
		return undefined;
	}
	return {
		scrollX: record.scrollX,
		scrollY: record.scrollY,
		zoom: record.zoom,
		at: isFiniteNumber(record.at) ? record.at : 0,
	};
}

function storedViewports(
	preferences: AtelierExtensionPreferences | undefined,
): Map<string, RememberedViewport> {
	const stored = preferences?.get(VIEWPORTS_PREFERENCE_KEY);
	const result = new Map<string, RememberedViewport>();
	if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
		return result;
	}
	for (const [fileId, value] of Object.entries(stored)) {
		const viewport = readRemembered(value);
		if (viewport) result.set(fileId, viewport);
	}
	return result;
}

/** The viewport last seen for a file: this page's first, then the saved one. */
export function rememberedViewport(
	fileId: string,
	preferences: AtelierExtensionPreferences | undefined,
): ExcalidrawViewport | undefined {
	const viewport =
		sessionViewports.get(fileId) ?? storedViewports(preferences).get(fileId);
	return viewport
		? {
				scrollX: viewport.scrollX,
				scrollY: viewport.scrollY,
				zoom: viewport.zoom,
			}
		: undefined;
}

/**
 * Save this page's viewports into the preferences, merged with what is
 * stored there (another tab of this workspace may have written its own),
 * keeping the newest `MAX_REMEMBERED_VIEWPORTS`.
 */
function persistViewports(preferences: AtelierExtensionPreferences): void {
	const merged = storedViewports(preferences);
	const before = JSON.stringify(Object.fromEntries(merged));
	for (const [fileId, viewport] of sessionViewports) {
		const stored = merged.get(fileId);
		if (!stored || stored.at <= viewport.at) merged.set(fileId, viewport);
	}
	const kept = [...merged]
		.sort(([, a], [, b]) => b.at - a.at)
		.slice(0, MAX_REMEMBERED_VIEWPORTS);
	const next: Record<string, AtelierJsonValue> = {};
	for (const [fileId, { scrollX, scrollY, zoom, at }] of kept) {
		next[fileId] = { scrollX, scrollY, zoom, at };
	}
	// Only a changed map is written: a write re-renders the shell.
	if (JSON.stringify(next) === before) return;
	preferences.set(VIEWPORTS_PREFERENCE_KEY, next);
}

/**
 * The viewport to open a file's canvas at, and the callback that remembers
 * where the reader moved it. `record` is cheap and never renders: it writes
 * this page's memory at once and the preferences once the movement settles
 * (or the canvas unmounts, or the page is hidden).
 */
export function useRememberedViewport(
	fileId: string,
	preferences: AtelierExtensionPreferences | undefined,
): {
	readonly viewport: ExcalidrawViewport | undefined;
	readonly record: (viewport: ExcalidrawViewport) => void;
} {
	const preferencesRef = useRef(preferences);
	useLayoutEffect(() => {
		preferencesRef.current = preferences;
	}, [preferences]);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dirtyRef = useRef(false);

	const flush = useCallback(() => {
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		if (!dirtyRef.current) return;
		dirtyRef.current = false;
		const current = preferencesRef.current;
		if (current) persistViewports(current);
	}, []);

	const record = useCallback(
		(viewport: ExcalidrawViewport) => {
			sessionViewports.set(fileId, { ...viewport, at: Date.now() });
			dirtyRef.current = true;
			if (timerRef.current !== null) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(flush, VIEWPORT_PERSIST_DEBOUNCE_MS);
		},
		[fileId, flush],
	);

	useEffect(() => {
		window.addEventListener("pagehide", flush);
		return () => {
			window.removeEventListener("pagehide", flush);
			flush();
		};
	}, [flush]);

	return { viewport: rememberedViewport(fileId, preferences), record };
}
