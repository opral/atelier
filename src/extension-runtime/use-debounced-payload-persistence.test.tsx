import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useDebouncedPayloadPersistence } from "./use-debounced-payload-persistence";

afterEach(() => {
	vi.useRealTimers();
});

test("uses the first payload as a baseline without persisting on mount", () => {
	vi.useFakeTimers();
	const onPersist = vi.fn();
	const { result, unmount } = renderPersistence(onPersist);

	act(() => result.current.capture({ text: "normalized initial" }));
	unmount();

	expect(onPersist).not.toHaveBeenCalled();
});

test("flushes the latest captured payload without reading editor state on unmount", () => {
	vi.useFakeTimers();
	const onPersist = vi.fn();
	const { result, unmount } = renderPersistence(onPersist);

	act(() => {
		result.current.capture({ text: "normalized initial" });
		result.current.capture({ text: "first edit" });
		result.current.capture({ text: "latest edit" });
	});
	unmount();

	expect(onPersist).toHaveBeenCalledOnce();
	expect(onPersist).toHaveBeenCalledWith("latest edit");
});

test("an external reset cancels pending persistence and requires a new baseline", () => {
	vi.useFakeTimers();
	const onPersist = vi.fn();
	const { result, unmount } = renderPersistence(onPersist);

	act(() => {
		result.current.capture({ text: "normalized initial" });
		result.current.capture({ text: "pending local edit" });
		result.current.resetBaseline("external document");
		result.current.capture({ text: "normalized external document" });
		vi.runAllTimers();
	});
	unmount();

	expect(result.current.isCurrent("normalized external document")).toBe(true);
	expect(onPersist).not.toHaveBeenCalled();
});

function renderPersistence(onPersist: (serialized: string) => void) {
	return renderHook(() =>
		useDebouncedPayloadPersistence<{ readonly text: string }>({
			initialSerialized: "raw initial",
			serialize: (payload) => payload.text,
			onPersist,
			debounceMs: 400,
		}),
	);
}
