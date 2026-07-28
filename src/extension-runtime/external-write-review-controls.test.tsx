import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ExternalWriteReviewControls } from "./external-write-review-controls";

const NAVIGATION = {
	fileName: "TikTok.md",
	activeIndex: 0,
	fileCount: 2,
	onPrevious: vi.fn(),
	onNext: vi.fn(),
};

const FILES = [
	{ id: "file-tiktok", path: "/TikTok.md" },
	{ id: "file-launch", path: "/launch-post.md" },
] as const;

describe("ExternalWriteReviewControls", () => {
	test("the verb is workspace-first and commits every file in one press", async () => {
		const primary = vi.fn(async () => {});
		const undoAll = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				mode="agent-turn"
				navigation={NAVIGATION}
				files={FILES}
				activeFileId="file-tiktok"
				onUndoAll={undoAll}
				onPrimary={primary}
			/>,
		);

		expect(screen.getByText("1 of 2")).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "Keep" }));
		await waitFor(() =>
			expect(primary).toHaveBeenCalledWith(["file-tiktok", "file-launch"]),
		);
		fireEvent.click(screen.getByRole("button", { name: /^Undo all/ }));
		expect(undoAll).toHaveBeenCalledOnce();
	});

	test("the ▾ opens the file list all ticked; unticking re-scopes the verb", async () => {
		const primary = vi.fn(async () => {});
		render(
			<ExternalWriteReviewControls
				isActive
				mode="agent-turn"
				navigation={NAVIGATION}
				files={FILES}
				activeFileId="file-tiktok"
				onPrimary={primary}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
		const checkboxes = screen.getAllByRole("checkbox");
		// "All files" master row plus one row per file.
		expect(checkboxes).toHaveLength(3);
		for (const checkbox of checkboxes) {
			expect(checkbox).toBeChecked();
		}
		expect(checkboxes[0]).toHaveAccessibleName(/All files/);
		expect(checkboxes[0]).toHaveAccessibleName(/2 of 2/);
		// The stepped file is pinned first and tagged "viewing".
		expect(checkboxes[1]).toHaveAccessibleName(/TikTok\.md/);
		expect(checkboxes[1]).toHaveAccessibleName(/viewing/);

		fireEvent.click(screen.getByRole("checkbox", { name: /launch-post/ }));
		expect(screen.getByRole("button", { name: "Keep only" })).toBeVisible();
		// Partial selection reads as mixed on the master row.
		expect(screen.getByRole("checkbox", { name: /All files/ })).toHaveAttribute(
			"aria-checked",
			"mixed",
		);

		fireEvent.click(screen.getByRole("button", { name: "Keep only" }));
		await waitFor(() => expect(primary).toHaveBeenCalledWith(["file-tiktok"]));
		// Committing closes the list and resets the scope to everything.
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(screen.getByRole("button", { name: "Keep" })).toBeVisible();
	});

	test("the All files master row toggles the lot", () => {
		render(
			<ExternalWriteReviewControls
				isActive
				mode="agent-turn"
				navigation={NAVIGATION}
				files={FILES}
				activeFileId="file-tiktok"
				onPrimary={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
		const allFiles = () => screen.getByRole("checkbox", { name: /All files/ });
		fireEvent.click(allFiles());
		expect(allFiles()).toHaveAttribute("aria-checked", "false");
		expect(allFiles()).toHaveAccessibleName(/0 of 2/);
		expect(screen.getByRole("button", { name: "Keep" })).toBeDisabled();

		// From partial, the master row ticks everything back on.
		fireEvent.click(screen.getByRole("checkbox", { name: /TikTok/ }));
		expect(allFiles()).toHaveAttribute("aria-checked", "mixed");
		fireEvent.click(allFiles());
		expect(allFiles()).toHaveAttribute("aria-checked", "true");
		expect(screen.getByRole("button", { name: "Keep" })).toBeEnabled();
	});

	test("a larger subset counts what's left: Restore 2 files", () => {
		const files = [
			{ id: "a", path: "/a.md" },
			{ id: "b", path: "/b.md" },
			{ id: "c", path: "/c.md" },
		];
		render(
			<ExternalWriteReviewControls
				isActive
				mode="historical"
				navigation={{ ...NAVIGATION, fileCount: 3 }}
				files={files}
				activeFileId="a"
				onUndoAll={vi.fn()}
				onPrimary={vi.fn()}
			/>,
		);

		// Historical mode: the read-only past has no Undo all.
		expect(screen.queryByRole("button", { name: /^Undo all/ })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
		fireEvent.click(screen.getByRole("checkbox", { name: /c\.md/ }));
		expect(
			screen.getByRole("button", { name: "Restore 2 files" }),
		).toBeVisible();
		fireEvent.click(screen.getByRole("checkbox", { name: /a\.md/ }));
		expect(screen.getByRole("button", { name: "Restore only" })).toBeVisible();
		// Unticking everything disables the verb — nothing to act on.
		fireEvent.click(screen.getByRole("checkbox", { name: /b\.md/ }));
		expect(screen.getByRole("button", { name: "Restore" })).toBeDisabled();
	});

	test("one changed file: no ▾ and no stepper arrows", () => {
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 1 }}
				files={[FILES[0]]}
				activeFileId="file-tiktok"
				onUndoAll={vi.fn()}
				onPrimary={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "Checkpoint" })).toBeVisible();
		expect(screen.queryByRole("button", { name: "Choose files" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Previous changed file" }),
		).toBeNull();
		expect(screen.getByText("1 of 1")).toBeVisible();
	});

	test("ESC closes an open list (resetting ticks) before exiting; ⌘⏎ fires the verb", async () => {
		const primary = vi.fn(async () => {});
		const exit = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				mode="agent-turn"
				navigation={NAVIGATION}
				files={FILES}
				activeFileId="file-tiktok"
				onPrimary={primary}
				onExit={exit}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Choose files" }));
		fireEvent.click(screen.getByRole("checkbox", { name: /launch-post/ }));
		expect(screen.getByRole("button", { name: "Keep only" })).toBeVisible();

		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).not.toHaveBeenCalled();
		expect(screen.queryByRole("checkbox")).toBeNull();
		// The re-scoped label only lives as long as the list showing it.
		expect(screen.getByRole("button", { name: "Keep" })).toBeVisible();

		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).toHaveBeenCalledOnce();

		fireEvent.keyDown(window, { key: "Enter", metaKey: true });
		await waitFor(() =>
			expect(primary).toHaveBeenCalledWith(["file-tiktok", "file-launch"]),
		);
	});
});
