import { useCallback, useEffect, useRef } from "react";

export type DebouncedPayloadPersistenceOptions<TPayload> = {
	/** Serialized document that the editor is initially displaying. */
	readonly initialSerialized: string;
	/** Serializes an editor-owned change payload captured before teardown. */
	readonly serialize: (payload: TPayload) => string;
	/** Persists a changed serialized document. */
	readonly onPersist?: (serialized: string) => void;
	readonly debounceMs: number;
	readonly disabled?: boolean;
};

/**
 * Persists editor event payloads without reading an imperative editor API
 * during unmount. The first payload establishes the editor's normalized
 * baseline; later payloads debounce, and only an armed edit flushes on
 * unmount.
 */
export function useDebouncedPayloadPersistence<TPayload>({
	initialSerialized,
	serialize,
	onPersist,
	debounceMs,
	disabled = false,
}: DebouncedPayloadPersistenceOptions<TPayload>): {
	readonly capture: (payload: TPayload) => void;
	readonly resetBaseline: (serialized: string) => void;
	readonly isCurrent: (serialized: string) => boolean;
} {
	const currentSerializedRef = useRef(initialSerialized);
	const baselineReadyRef = useRef(false);
	const latestPayloadRef = useRef<TPayload | null>(null);
	const timerRef = useRef<number | null>(null);
	const serializeRef = useRef(serialize);
	const onPersistRef = useRef(onPersist);
	const disabledRef = useRef(disabled);

	useEffect(() => {
		serializeRef.current = serialize;
	}, [serialize]);
	useEffect(() => {
		onPersistRef.current = onPersist;
	}, [onPersist]);
	useEffect(() => {
		disabledRef.current = disabled;
	}, [disabled]);

	const flushPending = useCallback(() => {
		if (timerRef.current === null) return;
		window.clearTimeout(timerRef.current);
		timerRef.current = null;
		if (disabledRef.current) return;
		const payload = latestPayloadRef.current;
		if (payload === null) return;
		const serialized = serializeRef.current(payload);
		if (serialized === currentSerializedRef.current) return;
		currentSerializedRef.current = serialized;
		onPersistRef.current?.(serialized);
	}, []);

	const capture = useCallback(
		(payload: TPayload) => {
			if (disabledRef.current) return;
			latestPayloadRef.current = payload;
			if (!baselineReadyRef.current) {
				baselineReadyRef.current = true;
				currentSerializedRef.current = serializeRef.current(payload);
				return;
			}
			if (timerRef.current !== null) {
				window.clearTimeout(timerRef.current);
			}
			timerRef.current = window.setTimeout(flushPending, debounceMs);
		},
		[debounceMs, flushPending],
	);

	const resetBaseline = useCallback((serialized: string) => {
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
		currentSerializedRef.current = serialized;
		latestPayloadRef.current = null;
		baselineReadyRef.current = false;
	}, []);

	const isCurrent = useCallback(
		(serialized: string) => serialized === currentSerializedRef.current,
		[],
	);

	useEffect(
		() => () => {
			flushPending();
		},
		[flushPending],
	);

	return { capture, resetBaseline, isCurrent };
}
