import { test, expect, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { createEditor } from "./create-editor";

for (const editBeforeCreate of [true, false]) {
	test(`persists an edit ${editBeforeCreate ? "before" : "after"} TipTap's deferred create event`, async () => {
		const execute = vi.fn(async () => ({ rowsAffected: 1, rows: [] }));
		vi.useFakeTimers();
		const editor = createEditor({
			lix: { execute } as unknown as Lix,
			fileId: "00000000-0000-4000-8000-000000000001",
			initialMarkdown: "",
			defaultBlock: "heading1",
			persistDebounceMs: 500,
		});
		try {
			if (!editBeforeCreate) await vi.advanceTimersByTimeAsync(1);
			editor.commands.insertContent("after-reopen-marker");
			await vi.advanceTimersByTimeAsync(501);
			expect(execute).toHaveBeenCalledTimes(1);
			const params = (
				execute.mock.calls[0] as unknown as [string, Uint8Array[]]
			)[1];
			expect(new TextDecoder().decode(params[0])).toBe(
				"# after-reopen-marker\n",
			);
			expect(new TextDecoder().decode(params[2])).toBe("");
		} finally {
			editor.destroy();
			vi.useRealTimers();
		}
	});
}
