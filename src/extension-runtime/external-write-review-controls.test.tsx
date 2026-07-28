import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ExternalWriteReviewControls } from "./external-write-review-controls";

const NAVIGATION = {
	fileName: "note.md",
	activeIndex: 0,
	fileCount: 2,
	onPrevious: vi.fn(),
	onNext: vi.fn(),
};

describe("ExternalWriteReviewControls", () => {
	test("agent turn: Keep all and Undo all act workspace-wide, ▾ keeps one file", async () => {
		const keepAll = vi.fn(async () => {});
		const undoAll = vi.fn();
		const keepFile = vi.fn(async () => {});
		render(
			<ExternalWriteReviewControls
				isActive
				mode="agent-turn"
				navigation={NAVIGATION}
				onUndoAll={undoAll}
				onPrimary={keepAll}
				onMenuAction={keepFile}
			/>,
		);

		expect(screen.getByText("1 of 2")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: /^Keep all/ }));
		await waitFor(() => expect(keepAll).toHaveBeenCalledOnce());
		fireEvent.click(screen.getByRole("button", { name: /^Undo all/ }));
		expect(undoAll).toHaveBeenCalledOnce();

		fireEvent.click(screen.getByRole("button", { name: "More options" }));
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Keep only note.md" }),
		);
		await waitFor(() => expect(keepFile).toHaveBeenCalledOnce());
	});

	test("working changes: the orange verb checkpoints and ▾ offers a name, never a smaller scope", async () => {
		const checkpoint = vi.fn(async () => {});
		const namedCheckpoint = vi.fn(async () => {});
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={NAVIGATION}
				onUndoAll={vi.fn()}
				onPrimary={checkpoint}
				onMenuAction={namedCheckpoint}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /^Checkpoint/ }));
		await waitFor(() => expect(checkpoint).toHaveBeenCalledOnce());
		fireEvent.click(screen.getByRole("button", { name: "More options" }));
		expect(
			screen.getByRole("menuitem", { name: "Checkpoint with a name…" }),
		).toBeVisible();
		expect(screen.queryByRole("menuitem", { name: /only/ })).toBeNull();
	});

	test("historical: read-only past hides Undo all; Restore and per-file restore remain", async () => {
		const restore = vi.fn(async () => {});
		render(
			<ExternalWriteReviewControls
				isActive
				mode="historical"
				navigation={NAVIGATION}
				onUndoAll={vi.fn()}
				onPrimary={restore}
				onMenuAction={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("button", { name: /^Undo all/ })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /^Restore/ }));
		await waitFor(() => expect(restore).toHaveBeenCalledOnce());
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "More options" }),
			).toBeEnabled(),
		);
		fireEvent.click(screen.getByRole("button", { name: "More options" }));
		expect(
			screen.getByRole("menuitem", { name: "Restore only note.md" }),
		).toBeVisible();
	});

	test("ESC exits (closing an open menu first) and ⌘⏎ fires the orange verb", async () => {
		const primary = vi.fn(async () => {});
		const exit = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				mode="agent-turn"
				navigation={NAVIGATION}
				onPrimary={primary}
				onMenuAction={vi.fn()}
				onExit={exit}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "More options" }));
		expect(screen.getByRole("menu")).toBeVisible();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).not.toHaveBeenCalled();
		expect(screen.queryByRole("menu")).toBeNull();

		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).toHaveBeenCalledOnce();

		fireEvent.keyDown(window, { key: "Enter", metaKey: true });
		await waitFor(() => expect(primary).toHaveBeenCalledOnce());
	});
});
