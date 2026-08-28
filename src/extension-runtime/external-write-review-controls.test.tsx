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
	test("the chip defaults to the viewed file and scopes both verbs to it", async () => {
		const primary = vi.fn(async () => {});
		const undo = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={NAVIGATION}
				files={FILES}
				onUndo={undo}
				onPrimary={primary}
			/>,
		);

		expect(screen.getByText("1 of 2")).toBeVisible();
		expect(
			screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
		).toBeVisible();
		fireEvent.click(screen.getByRole("button", { name: "Checkpoint" }));
		await waitFor(() => expect(primary).toHaveBeenCalledWith(["file-tiktok"]));
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(undo).toHaveBeenCalledWith(["file-tiktok"]);
	});

	test("uses the currently viewed file when the review opens later in the list", () => {
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{
					...NAVIGATION,
					fileName: "launch-post.md",
					activeIndex: 1,
				}}
				files={FILES}
				onPrimary={vi.fn()}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
		);
		expect(screen.getByTestId("diff-scope-file:file-tiktok")).not.toBeChecked();
		expect(screen.getByTestId("diff-scope-file:file-launch")).toBeChecked();
	});

	test("the checklist can expand or move the working set", async () => {
		const primary = vi.fn(async () => {});
		const undo = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={NAVIGATION}
				files={FILES}
				onUndo={undo}
				onPrimary={primary}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
		);
		const checkboxes = screen.getAllByRole("checkbox");
		// "All files" master row plus one row per file.
		expect(checkboxes).toHaveLength(3);
		expect(checkboxes[0]).toHaveAccessibleName("All files");
		expect(checkboxes[0]).toHaveAttribute("aria-checked", "mixed");
		expect(screen.getByTestId("diff-scope-file:file-tiktok")).toBeChecked();
		expect(screen.getByTestId("diff-scope-file:file-launch")).not.toBeChecked();

		fireEvent.click(screen.getByTestId("diff-scope-file:file-launch"));
		expect(
			screen.getByRole("button", { name: "Working set: 2 of 2 files" }),
		).toBeVisible();
		fireEvent.click(screen.getByTestId("diff-scope-file:file-tiktok"));
		expect(screen.getByText("1 file")).toBeVisible();
		expect(screen.getByRole("button", { name: "Checkpoint" })).toBeVisible();
		expect(screen.getByRole("checkbox", { name: "All files" })).toHaveAttribute(
			"aria-checked",
			"mixed",
		);

		// Both verbs apply to the selection.
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(undo).toHaveBeenCalledWith(["file-launch"]);
		fireEvent.click(screen.getByRole("button", { name: "Checkpoint" }));
		await waitFor(() => expect(primary).toHaveBeenCalledWith(["file-launch"]));
		// Committing closes the list and restores the viewed-file default.
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(
			screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
		).toBeVisible();
	});

	test("the selection survives closing the list — the chip keeps it visible", () => {
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={NAVIGATION}
				files={FILES}
				onUndo={vi.fn()}
				onPrimary={vi.fn()}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
		);
		fireEvent.click(screen.getByTestId("diff-scope-file:file-launch"));
		fireEvent.click(screen.getByTestId("diff-scope-file:file-tiktok"));
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
				mode="working-changes"
				navigation={NAVIGATION}
				files={FILES}
				onUndo={vi.fn()}
				onPrimary={vi.fn()}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
		);
		const allFiles = () => screen.getByRole("checkbox", { name: "All files" });
		expect(allFiles()).toHaveAttribute("aria-checked", "mixed");
		fireEvent.click(allFiles());
		expect(allFiles()).toHaveAttribute("aria-checked", "true");
		fireEvent.click(allFiles());
		expect(allFiles()).toHaveAttribute("aria-checked", "false");
		expect(screen.getByRole("button", { name: "Checkpoint" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

		// From partial, the master row ticks everything back on.
		fireEvent.click(screen.getByTestId("diff-scope-file:file-tiktok"));
		expect(allFiles()).toHaveAttribute("aria-checked", "mixed");
		fireEvent.click(allFiles());
		expect(allFiles()).toHaveAttribute("aria-checked", "true");
		expect(screen.getByRole("button", { name: "Checkpoint" })).toBeEnabled();
	});

	test("historical: Restore defaults to the viewed file and has no Undo", async () => {
		const restore = vi.fn(async () => {});
		render(
			<ExternalWriteReviewControls
				isActive
				mode="historical"
				navigation={{
					...NAVIGATION,
					fileName: "launch-post.md",
					activeIndex: 1,
				}}
				files={FILES}
				onUndo={vi.fn()}
				onPrimary={restore}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Restore" }));
		await waitFor(() => expect(restore).toHaveBeenCalledWith(["file-launch"]));
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
				mode="working-changes"
				navigation={NAVIGATION}
				files={FILES}
				onPrimary={primary}
				onExit={exit}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
		);

		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).not.toHaveBeenCalled();
		expect(screen.queryByRole("checkbox")).toBeNull();

		fireEvent.keyDown(window, { key: "Enter", metaKey: true });
		await waitFor(() => expect(primary).toHaveBeenCalledWith(["file-tiktok"]));

		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).toHaveBeenCalledOnce();
	});
});
