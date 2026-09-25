import { act, render } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import type { Lix } from "@lix-js/sdk";
import { afterEach, expect, test, vi } from "vitest";
import { useTitleDrivenFileRename } from "./use-title-driven-rename";
import { renameWorkspaceEntry } from "@/lib/workspace-file-ops";

vi.mock("@/lib/workspace-file-ops", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/workspace-file-ops")>()),
	renameWorkspaceEntry: vi.fn(async () => {}),
}));

afterEach(() => {
	vi.useRealTimers();
	vi.mocked(renameWorkspaceEntry).mockClear();
});

test("names an untitled document once and preserves the name on later title edits", async () => {
	vi.useFakeTimers();
	const listeners = new Map<string, () => void>();
	const heading = { type: { name: "heading" }, textContent: "First title" };
	const editor = {
		isDestroyed: false,
		state: { doc: { firstChild: heading } },
		on: (event: string, listener: () => void) => listeners.set(event, listener),
		off: (event: string) => listeners.delete(event),
	} as unknown as Editor;
	const lix = {} as Lix;
	const fileId = "file-1";
	function Hook({ filePath }: { filePath: string }) {
		useTitleDrivenFileRename({ lix, fileId, filePath, editor, enabled: true });
		return null;
	}
	const view = render(<Hook filePath="/untitled.md" />);
	await act(async () => {
		listeners.get("update")?.();
		await vi.advanceTimersByTimeAsync(800);
	});
	expect(renameWorkspaceEntry).toHaveBeenCalledExactlyOnceWith(
		lix,
		{ kind: "file", id: fileId },
		"/First title.md",
	);

	heading.textContent = "Revised title";
	// The file subscription can still report the old path after the rename.
	await act(async () => {
		listeners.get("update")?.();
		await vi.advanceTimersByTimeAsync(800);
	});
	view.rerender(<Hook filePath="/First title.md" />);
	await act(async () => {
		listeners.get("update")?.();
		await vi.advanceTimersByTimeAsync(800);
	});
	expect(renameWorkspaceEntry).toHaveBeenCalledTimes(1);
	view.unmount();
});
