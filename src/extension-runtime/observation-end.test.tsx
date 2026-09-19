import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useSyncedTextFile } from "./use-synced-text-file";
import { useSyncedCsvFile } from "../extensions/csv/use-synced-csv-file";

const lix = vi.hoisted(() => ({ observe: vi.fn() }));
vi.mock("@/lib/lix-react", () => ({ useLix: () => lix }));

test.each([
	["text", useSyncedTextFile],
	["CSV", useSyncedCsvFile],
] as const)(
	"%s stops consuming an observation closed before unmount",
	async (_, useFile) => {
		let end!: () => void;
		const ended = new Promise<IteratorResult<never>>((resolve) => {
			end = () => resolve({ done: true, value: undefined });
		});
		// Keep an erroneous second read pending so the regression fails without
		// starving the test runner with an incorrectly repeated read.
		const next = vi
			.fn()
			.mockReturnValueOnce(ended)
			.mockReturnValue(new Promise(() => {}));
		const close = vi.fn(async () => ({
			done: true as const,
			value: undefined,
		}));
		lix.observe.mockReturnValue({
			[Symbol.asyncIterator]() {
				return this;
			},
			next,
			return: close,
		});
		const hook = renderHook(() =>
			useFile({
				fileId: "file",
				initialText: "initial",
				initialMetadata: null,
				reviewText: null,
				reviewing: false,
				readOnly: false,
				originKey: "test",
			}),
		);
		try {
			await act(async () => end());
			expect(next).toHaveBeenCalledTimes(1);
			expect(hook.result.current.text).toBe("initial");
			expect(hook.result.current.saveError).toBeNull();
		} finally {
			hook.unmount();
		}
		expect(close).toHaveBeenCalledTimes(1);
	},
);
