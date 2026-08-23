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
	test("the chip is the working set; verbs commit every file in one press", async () => {
		const primary = vi.fn(async () => {});
		const undo = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				mode="agent-turn"
				navigation={NAVIGATION}
				files={FILES}
				onUndo={undo}
				onPrimary={primary}
			/>,
		);

		expect(screen.getByText("1 of 2")).toBeVisible();
		expect(
			screen.getByRole("button", { name: "Working set: 2 of 2 files" }),
		).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "Keep" }));
		await waitFor(() =>
			expect(primary).toHaveBeenCalledWith(["file-tiktok", "file-launch"]),
		);
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(undo).toHaveBeenCalledWith(["file-tiktok", "file-launch"]);
	});

	test("unticking re-scopes the chip's count; labels never change", async () => {
		const primary = vi.fn(async () => {});
		const undo = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				mode="agent-turn"
				navigation={NAVIGATION}
				files={FILES}
				onUndo={undo}
				onPrimary={primary}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Working set: 2 of 2 files" }),
		);
		const checkboxes = screen.getAllByRole("checkbox");
		// "All files" master row plus one row per file.
		expect(checkboxes).toHaveLength(3);
		for (const checkbox of checkboxes) {
			expect(checkbox).toBeChecked();
		}
		expect(checkboxes[0]).toHaveAccessibleName("All files");

		fireEvent.click(screen.getByRole("checkbox", { name: /launch-post/ }));
		// The chip counts the selection; the verb labels stay put.
		expect(
			screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
		).toBeVisible();
		expect(screen.getByText("1 file")).toBeVisible();
		expect(screen.getByRole("button", { name: "Keep" })).toBeVisible();
		expect(screen.getByRole("checkbox", { name: "All files" })).toHaveAttribute(
			"aria-checked",
			"mixed",
		);

		// Both verbs apply to the selection.
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(undo).toHaveBeenCalledWith(["file-tiktok"]);
		fireEvent.click(screen.getByRole("button", { name: "Keep" }));
		await waitFor(() => expect(primary).toHaveBeenCalledWith(["file-tiktok"]));
		// Committing closes the list and resets the working set.
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Working set: 2 of 2 files" }),
		).toBeVisible();
	});

	test("the selection survives closing the list — the chip keeps it visible", () => {
		render(
			<ExternalWriteReviewControls
				isActive
				mode="agent-turn"
				navigation={NAVIGATION}
				files={FILES}
				onUndo={vi.fn()}
				onPrimary={vi.fn()}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Working set: 2 of 2 files" }),
		);
		fireEvent.click(screen.getByRole("checkbox", { name: /launch-post/ }));
		fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
		).toBeVisible();
		expect(screen.getByText("1 file")).toBeVisible();
	});

	test("the All files master row toggles the lot; empty selection disables the verbs", () => {
		render(
			<ExternalWriteReviewControls
				isActive
				mode="agent-turn"
				navigation={NAVIGATION}
				files={FILES}
				onUndo={vi.fn()}
				onPrimary={vi.fn()}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Working set: 2 of 2 files" }),
		);
		const allFiles = () => screen.getByRole("checkbox", { name: "All files" });
		fireEvent.click(allFiles());
		expect(allFiles()).toHaveAttribute("aria-checked", "false");
		expect(screen.getByRole("button", { name: "Keep" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

		// From partial, the master row ticks everything back on.
		fireEvent.click(screen.getByRole("checkbox", { name: /TikTok/ }));
		expect(allFiles()).toHaveAttribute("aria-checked", "mixed");
		fireEvent.click(allFiles());
		expect(allFiles()).toHaveAttribute("aria-checked", "true");
		expect(screen.getByRole("button", { name: "Keep" })).toBeEnabled();
	});

	test("historical: the read-only past has no Undo", () => {
		render(
			<ExternalWriteReviewControls
				isActive
				mode="historical"
				navigation={NAVIGATION}
				files={FILES}
				onUndo={vi.fn()}
				onPrimary={vi.fn()}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
		expect(screen.getByRole("button", { name: "Restore" })).toBeVisible();
	});

	test("one changed file: no chip and no stepper arrows", () => {
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 1 }}
				files={[FILES[0]]}
				onUndo={vi.fn()}
				onPrimary={vi.fn()}
			/>,
		);

		expect(screen.getByRole("button", { name: "Checkpoint" })).toBeVisible();
		expect(screen.queryByRole("button", { name: /Working set/ })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Previous changed file" }),
		).toBeNull();
		expect(screen.getByText("1 of 1")).toBeVisible();
	});

	test("read-only review keeps the float visible but disables mutations", () => {
		const primary = vi.fn();
		const undo = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				readOnly
				mode="working-changes"
				navigation={NAVIGATION}
				files={FILES}
				onUndo={undo}
				onPrimary={primary}
			/>,
		);

		const checkpoint = screen.getByRole("button", { name: "Checkpoint" });
		expect(checkpoint).toBeVisible();
		expect(checkpoint).toBeDisabled();
		expect(checkpoint).toHaveAttribute(
			"title",
			"Sign in with edit access to create a checkpoint",
		);
		expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

		fireEvent.click(checkpoint);
		fireEvent.keyDown(window, { key: "Enter", metaKey: true });
		expect(primary).not.toHaveBeenCalled();
		expect(undo).not.toHaveBeenCalled();
	});

	test("puts the Esc Exit control at the far left of the float", () => {
		const exit = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={NAVIGATION}
				files={FILES}
				onExit={exit}
			/>,
		);

		const exitButton = screen.getByRole("button", { name: "Exit" });
		expect(exitButton).toHaveTextContent("Esc");
		expect(exitButton).toHaveTextContent("Exit");
		expect(exitButton.querySelector("svg")).toBeNull();
		expect(
			exitButton.closest(".external-write-review-scope")?.firstElementChild,
		).toBe(exitButton);

		fireEvent.click(exitButton);
		expect(exit).toHaveBeenCalledOnce();
	});

	test("ESC closes an open list before exiting; ⌘⏎ fires the verb on the selection", async () => {
		const primary = vi.fn(async () => {});
		const exit = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				mode="agent-turn"
				navigation={NAVIGATION}
				files={FILES}
				onPrimary={primary}
				onExit={exit}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Working set: 2 of 2 files" }),
		);
		fireEvent.click(screen.getByRole("checkbox", { name: /launch-post/ }));

		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).not.toHaveBeenCalled();
		expect(screen.queryByRole("checkbox")).toBeNull();

		fireEvent.keyDown(window, { key: "Enter", metaKey: true });
		await waitFor(() => expect(primary).toHaveBeenCalledWith(["file-tiktok"]));

		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).toHaveBeenCalledOnce();
	});
});
