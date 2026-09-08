import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CsvReviewTrigger } from "../extensions/csv/csv-review-popover";
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

const THREE_FILES = [
	{ id: "file-icp", path: "/icp.md" },
	{ id: "file-leads", path: "/leads.csv" },
	{ id: "file-readme", path: "/README.md" },
] as const;

const chip = (name: string) => screen.getByRole("button", { name });
const scopeRow = (fileId: string) =>
	screen.getByTestId(`diff-scope-file:${fileId}`);

describe("ExternalWriteReviewControls", () => {
	test("Escape dismisses nested change details before exiting review", () => {
		const exit = vi.fn();
		render(
			<>
				<ExternalWriteReviewControls
					isActive
					mode="working-changes"
					navigation={NAVIGATION}
					files={FILES}
					onExit={exit}
				/>
				<CsvReviewTrigger
					label="Stage changed"
					details={[{ label: "Value", before: "Trial", after: "Qualified" }]}
				>
					Qualified
				</CsvReviewTrigger>
			</>,
		);
		const trigger = screen.getByRole("button", { name: "Stage changed" });
		fireEvent.click(trigger);
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(exit).not.toHaveBeenCalled();
		expect(trigger).toHaveFocus();
		fireEvent.keyDown(trigger, { key: "Escape" });
		expect(exit).toHaveBeenCalledOnce();
	});

	test("Escape dismisses hover details without exiting the review", () => {
		const exit = vi.fn();
		render(
			<>
				<ExternalWriteReviewControls
					isActive
					mode="working-changes"
					navigation={NAVIGATION}
					files={FILES}
					onExit={exit}
				/>
				<CsvReviewTrigger
					label="Stage changed"
					details={[{ label: "Value", before: "Trial", after: "Qualified" }]}
				>
					Qualified
				</CsvReviewTrigger>
			</>,
		);
		fireEvent.pointerEnter(
			screen.getByRole("button", { name: "Stage changed" }),
			{ pointerType: "mouse" },
		);
		fireEvent.keyDown(document.body, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(exit).not.toHaveBeenCalled();
	});

	test("the scope starts as the viewed file and both verbs act on it", async () => {
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
		// The chip always carries the denominator.
		expect(chip("Working set: 1 of 2 files")).toHaveTextContent("Seen 1 of 2");
		fireEvent.click(screen.getByRole("button", { name: "Checkpoint" }));
		await waitFor(() =>
			expect(primary).toHaveBeenCalledWith(["file-tiktok"], {
				scope: "selection",
			}),
		);
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		expect(undo).toHaveBeenCalledWith(["file-tiktok"], { scope: "selection" });
	});

	test("stepping to a file adds it to the seen set; stepping away never removes it", () => {
		const { rerender } = render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 3 }}
				files={THREE_FILES}
				onPrimary={vi.fn()}
			/>,
		);
		expect(chip("Working set: 1 of 3 files")).toHaveTextContent("Seen 1 of 3");

		rerender(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{
					...NAVIGATION,
					fileName: "leads.csv",
					activeIndex: 1,
					fileCount: 3,
				}}
				files={THREE_FILES}
				onPrimary={vi.fn()}
			/>,
		);
		expect(chip("Working set: 2 of 3 files")).toHaveTextContent("Seen 2 of 3");

		// Back to the first file: leads.csv stays seen.
		rerender(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 3 }}
				files={THREE_FILES}
				onPrimary={vi.fn()}
			/>,
		);
		expect(chip("Working set: 2 of 3 files")).toBeVisible();

		fireEvent.click(chip("Working set: 2 of 3 files"));
		expect(scopeRow("file-icp")).toBeChecked();
		expect(scopeRow("file-leads")).toBeChecked();
		// Unseen rows are listed below the seen ones; they are not ticks but
		// open the file, which is what makes it seen.
		expect(scopeRow("file-readme")).toHaveAttribute("data-state", "unseen");
		expect(scopeRow("file-readme")).toHaveTextContent("unseen");
		expect(scopeRow("file-icp")).toHaveTextContent("viewing");
		const rows = screen.getAllByRole("checkbox");
		expect(rows.map((row) => row.getAttribute("data-file-id"))).toEqual([
			null,
			"file-icp",
			"file-leads",
		]);
	});

	test("clicking an unseen row opens the file, which makes it seen and ticked", () => {
		const onOpen = vi.fn();
		const { rerender } = render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 3, onOpen }}
				files={THREE_FILES}
				onPrimary={vi.fn()}
			/>,
		);
		fireEvent.click(chip("Working set: 1 of 3 files"));
		fireEvent.click(scopeRow("file-readme"));
		expect(onOpen).toHaveBeenCalledWith(2);

		// The host shows the file; the row moves into the seen group, ticked,
		// and the list stays open.
		rerender(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{
					...NAVIGATION,
					fileName: "README.md",
					activeIndex: 2,
					fileCount: 3,
					onOpen,
				}}
				files={THREE_FILES}
				onPrimary={vi.fn()}
			/>,
		);
		expect(scopeRow("file-readme")).toBeChecked();
		expect(scopeRow("file-readme")).toHaveTextContent("viewing");
		expect(chip("Working set: 2 of 3 files")).toHaveTextContent("Seen 2 of 3");
		expect(
			screen.getByRole("group", { name: "Diff review actions" }),
		).toHaveFocus();
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

		fireEvent.click(chip("Working set: 1 of 2 files"));
		expect(scopeRow("file-tiktok")).toHaveAttribute("data-state", "unseen");
		expect(scopeRow("file-launch")).toBeChecked();
	});

	test("unticking a seen file leaves it out; revisiting does not re-tick it", async () => {
		const primary = vi.fn(async () => {});
		const undo = vi.fn();
		const { rerender } = render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 3 }}
				files={THREE_FILES}
				onUndo={undo}
				onPrimary={primary}
			/>,
		);
		const atLeads = (
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{
					...NAVIGATION,
					fileName: "leads.csv",
					activeIndex: 1,
					fileCount: 3,
				}}
				files={THREE_FILES}
				onUndo={undo}
				onPrimary={primary}
			/>
		);
		rerender(atLeads);
		fireEvent.click(chip("Working set: 2 of 3 files"));
		fireEvent.click(scopeRow("file-leads"));
		// Once anything is left out the label drops the "Seen" prefix.
		expect(chip("Working set: 1 of 3 files")).toHaveTextContent("1 of 3");
		expect(
			within(chip("Working set: 1 of 3 files")).queryByText(/^Seen/, {
				ignore: ".external-write-review-sizer",
			}),
		).toBeNull();
		expect(scopeRow("file-leads")).toHaveAttribute("data-state", "left-out");
		expect(
			screen.getByRole("checkbox", { name: "Seen files" }),
		).toHaveAttribute("aria-checked", "mixed");

		// Step away and back: leads.csv is still left out.
		rerender(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 3 }}
				files={THREE_FILES}
				onUndo={undo}
				onPrimary={primary}
			/>,
		);
		rerender(atLeads);
		expect(chip("Working set: 1 of 3 files")).toBeVisible();

		// The verb reads the ticked set: icp.md only.
		fireEvent.click(screen.getByRole("button", { name: "Checkpoint" }));
		await waitFor(() =>
			expect(primary).toHaveBeenCalledWith(["file-icp"], {
				scope: "selection",
			}),
		);
		// Committing closes the list and starts the scope over.
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(chip("Working set: 1 of 3 files")).toHaveTextContent("Seen 1 of 3");
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

		fireEvent.click(chip("Working set: 1 of 2 files"));
		fireEvent.click(scopeRow("file-tiktok"));
		fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.queryByRole("checkbox")).toBeNull();
		expect(chip("Working set: 0 of 2 files")).toHaveTextContent("0 of 2");
		expect(screen.getByRole("button", { name: "Checkpoint" })).toBeDisabled();
	});

	test("the Seen files master row toggles the seen set; empty selection disables the verbs", () => {
		const { rerender } = render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 3 }}
				files={THREE_FILES}
				onUndo={vi.fn()}
				onPrimary={vi.fn()}
			/>,
		);
		rerender(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{
					...NAVIGATION,
					fileName: "leads.csv",
					activeIndex: 1,
					fileCount: 3,
				}}
				files={THREE_FILES}
				onUndo={vi.fn()}
				onPrimary={vi.fn()}
			/>,
		);

		fireEvent.click(chip("Working set: 2 of 3 files"));
		const seenFiles = () =>
			screen.getByRole("checkbox", { name: "Seen files" });
		expect(seenFiles()).toHaveAttribute("aria-checked", "true");
		fireEvent.click(seenFiles());
		expect(seenFiles()).toHaveAttribute("aria-checked", "false");
		expect(screen.getByRole("button", { name: "Checkpoint" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
		// The unseen file is untouched either way.
		expect(scopeRow("file-readme")).toHaveAttribute("data-state", "unseen");

		// From partial, the master row ticks every seen file back on.
		fireEvent.click(scopeRow("file-icp"));
		expect(seenFiles()).toHaveAttribute("aria-checked", "mixed");
		fireEvent.click(seenFiles());
		expect(seenFiles()).toHaveAttribute("aria-checked", "true");
		expect(chip("Working set: 2 of 3 files")).toHaveTextContent("Seen 2 of 3");
		expect(screen.getByRole("button", { name: "Checkpoint" })).toBeEnabled();
	});

	test("the primary verb's arrow offers all files; ⇧⌘⏎ does the same", async () => {
		const primary = vi.fn(async () => {});
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 3 }}
				files={THREE_FILES}
				onPrimary={primary}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "More checkpoint options" }),
		);
		const menu = screen.getByRole("menu", { name: "Checkpoint options" });
		expect(menu).toBeVisible();
		expect(screen.queryByRole("menuitem", { name: /with a name/ })).toBeNull();
		const checkpointAll = screen.getByRole("menuitem", {
			name: /Checkpoint all 3 files/,
		});
		// "All" carries a stacked flag, distinct from the big half's single one.
		expect(checkpointAll.querySelector("svg")).toHaveAttribute(
			"data-icon",
			"flag-stack",
		);
		fireEvent.click(checkpointAll);
		await waitFor(() =>
			expect(primary).toHaveBeenCalledWith(
				["file-icp", "file-leads", "file-readme"],
				{ scope: "all" },
			),
		);
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Checkpoint" })).toBeEnabled(),
		);
		expect(screen.queryByRole("menu")).toBeNull();

		fireEvent.keyDown(window, { key: "Enter", metaKey: true, shiftKey: true });
		await waitFor(() => expect(primary).toHaveBeenCalledTimes(2));
		expect(primary).toHaveBeenLastCalledWith(
			["file-icp", "file-leads", "file-readme"],
			{ scope: "all" },
		);
	});

	test("Undo's arrow offers only the viewed file or all files", async () => {
		const undo = vi.fn(async () => {});
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{
					...NAVIGATION,
					fileName: "leads.csv",
					activeIndex: 1,
					fileCount: 3,
				}}
				files={THREE_FILES}
				onUndo={undo}
				onPrimary={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "More undo options" }));
		// One file keeps the single undo glyph; "all" stacks it.
		expect(
			screen
				.getByRole("menuitem", { name: "Undo only leads.csv" })
				.querySelector("svg"),
		).not.toHaveAttribute("data-icon");
		expect(
			screen
				.getByRole("menuitem", { name: /Undo all 3 files/ })
				.querySelector("svg"),
		).toHaveAttribute("data-icon", "undo-stack");
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Undo only leads.csv" }),
		);
		await waitFor(() =>
			expect(undo).toHaveBeenCalledWith(["file-leads"], { scope: "file" }),
		);
		// The only seen file left the list, so the ticked set is empty and the
		// big half is disabled; the arrow's "all" still works.
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "More undo options" }),
			).toBeEnabled(),
		);
		expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: "More undo options" }));
		fireEvent.click(screen.getByRole("menuitem", { name: /Undo all 3 files/ }));
		await waitFor(() =>
			expect(undo).toHaveBeenCalledWith(
				["file-icp", "file-leads", "file-readme"],
				{ scope: "all" },
			),
		);
		await waitFor(() =>
			expect(
				screen.getByRole("button", { name: "More undo options" }),
			).toBeEnabled(),
		);

		fireEvent.keyDown(window, {
			key: "Backspace",
			metaKey: true,
			shiftKey: true,
		});
		await waitFor(() => expect(undo).toHaveBeenCalledTimes(3));
		expect(undo).toHaveBeenLastCalledWith(
			["file-icp", "file-leads", "file-readme"],
			{ scope: "all" },
		);
	});

	test("a file leaving the list after Undo keeps the rest of the scope; the denominator drops", async () => {
		const undo = vi.fn(async () => {});
		const { rerender } = render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 3 }}
				files={THREE_FILES}
				onUndo={undo}
				onPrimary={vi.fn()}
			/>,
		);
		rerender(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{
					...NAVIGATION,
					fileName: "leads.csv",
					activeIndex: 1,
					fileCount: 3,
				}}
				files={THREE_FILES}
				onUndo={undo}
				onPrimary={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "More undo options" }));
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Undo only leads.csv" }),
		);
		await waitFor(() => expect(undo).toHaveBeenCalled());

		// The host drops the file and shows the next one.
		const remaining = [THREE_FILES[0], THREE_FILES[2]];
		rerender(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{
					...NAVIGATION,
					fileName: "README.md",
					activeIndex: 1,
					fileCount: 2,
				}}
				files={remaining}
				onUndo={undo}
				onPrimary={vi.fn()}
			/>,
		);
		expect(chip("Working set: 2 of 2 files")).toHaveTextContent("Seen 2 of 2");
	});

	test("a file joining the list mid-review arrives unseen; the selection is kept", () => {
		const { rerender } = render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={NAVIGATION}
				files={FILES}
				onPrimary={vi.fn()}
			/>,
		);
		fireEvent.click(chip("Working set: 1 of 2 files"));
		fireEvent.click(scopeRow("file-tiktok"));
		fireEvent.keyDown(window, { key: "Escape" });

		rerender(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 3 }}
				files={[...FILES, THREE_FILES[2]]}
				onPrimary={vi.fn()}
			/>,
		);
		expect(chip("Working set: 0 of 3 files")).toHaveTextContent("0 of 3");
		fireEvent.click(chip("Working set: 0 of 3 files"));
		expect(scopeRow("file-tiktok")).not.toBeChecked();
		expect(scopeRow("file-tiktok")).toBeEnabled();
		expect(scopeRow("file-readme")).toHaveAttribute("data-state", "unseen");
	});

	test("with no changed file on screen nothing is seen and the stepper names no file", () => {
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{
					...NAVIGATION,
					fileName: null,
					activeIndex: null,
					fileCount: 1,
				}}
				files={[FILES[0]]}
				onUndo={vi.fn()}
				onPrimary={vi.fn()}
			/>,
		);
		expect(screen.getByText("No changed file open")).toBeVisible();
		expect(screen.queryByText("TikTok.md")).toBeNull();
		// The arrows are the way to a changed file even with one in the list.
		expect(
			screen.getByRole("button", { name: "Next changed file" }),
		).toBeVisible();
	});

	test("historical: Restore acts on the seen set and has no Undo", async () => {
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
		expect(
			screen.queryByRole("button", { name: "More undo options" }),
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Restore" }));
		await waitFor(() =>
			expect(restore).toHaveBeenCalledWith(["file-launch"], {
				scope: "selection",
			}),
		);
		fireEvent.click(
			screen.getByRole("button", { name: "More restore options" }),
		);
		fireEvent.click(
			screen.getByRole("menuitem", { name: /Restore all 2 files/ }),
		);
		await waitFor(() =>
			expect(restore).toHaveBeenCalledWith(["file-tiktok", "file-launch"], {
				scope: "all",
			}),
		);
	});

	test("one changed file: no chip, no stepper arrows, no verb arrows", () => {
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
		expect(
			screen.queryByRole("button", { name: "More checkpoint options" }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "More undo options" }),
		).toBeNull();
		expect(
			screen.getByText("1 of 1", { ignore: ".external-write-review-sizer" }),
		).toBeVisible();
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
		expect(
			screen.getByRole("button", { name: "More checkpoint options" }),
		).toBeDisabled();

		fireEvent.click(checkpoint);
		fireEvent.keyDown(window, { key: "Enter", metaKey: true });
		fireEvent.keyDown(window, { key: "Enter", metaKey: true, shiftKey: true });
		fireEvent.keyDown(window, {
			key: "Backspace",
			metaKey: true,
			shiftKey: true,
		});
		expect(primary).not.toHaveBeenCalled();
		expect(undo).not.toHaveBeenCalled();
	});

	test("surfaces a stale Undo rejection without an unhandled promise", async () => {
		const undo = vi.fn(async () => {
			throw new Error("The working diff changed. Reopen the review.");
		});
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileCount: 1 }}
				files={[FILES[0]]}
				onUndo={undo}
				onPrimary={vi.fn()}
			/>,
		);

		const button = screen.getByRole("button", { name: "Undo" });
		fireEvent.click(button);
		await waitFor(() =>
			expect(button).toHaveAttribute(
				"title",
				"The working diff changed. Reopen the review.",
			),
		);
		expect(button).toBeEnabled();
	});

	test("opening review focuses the float; ← → step files from there only", () => {
		const onPrevious = vi.fn();
		const onNext = vi.fn();
		render(
			<>
				<input aria-label="Elsewhere" />
				<ExternalWriteReviewControls
					isActive
					mode="working-changes"
					navigation={{ ...NAVIGATION, onPrevious, onNext }}
					files={FILES}
					onPrimary={vi.fn()}
				/>
			</>,
		);
		const float = screen.getByRole("group", { name: "Diff review actions" });
		expect(float).toHaveFocus();

		fireEvent.keyDown(float, { key: "ArrowRight" });
		expect(onNext).toHaveBeenCalledOnce();
		fireEvent.keyDown(float, { key: "ArrowLeft" });
		expect(onPrevious).toHaveBeenCalledOnce();
		// From a button inside the float the arrows still step.
		fireEvent.keyDown(screen.getByRole("button", { name: "Checkpoint" }), {
			key: "ArrowRight",
		});
		expect(onNext).toHaveBeenCalledTimes(2);

		// Outside the float the arrows belong to whatever has focus.
		const elsewhere = screen.getByRole("textbox", { name: "Elsewhere" });
		elsewhere.focus();
		fireEvent.keyDown(elsewhere, { key: "ArrowRight" });
		fireEvent.keyDown(document.body, { key: "ArrowLeft" });
		expect(onNext).toHaveBeenCalledTimes(2);
		expect(onPrevious).toHaveBeenCalledOnce();
	});

	test("the float takes focus back after a keyboard step opens the next file", () => {
		const { rerender } = render(
			<>
				<input aria-label="Editor" />
				<ExternalWriteReviewControls
					isActive
					mode="working-changes"
					navigation={NAVIGATION}
					files={FILES}
					onPrimary={vi.fn()}
				/>
			</>,
		);
		const float = screen.getByRole("group", { name: "Diff review actions" });
		fireEvent.keyDown(float, { key: "ArrowRight" });
		// The opened file's view grabs focus…
		screen.getByRole("textbox", { name: "Editor" }).focus();
		rerender(
			<>
				<input aria-label="Editor" />
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
				/>
			</>,
		);
		// …and the float takes it back once the file is on screen.
		expect(float).toHaveFocus();
	});

	test("the stepper reserves room for the longest file name and the widest counter", () => {
		render(
			<ExternalWriteReviewControls
				isActive
				mode="working-changes"
				navigation={{ ...NAVIGATION, fileName: "icp.md", fileCount: 3 }}
				files={[
					{ id: "file-icp", path: "/icp.md" },
					{ id: "file-long", path: "/gtm/company-brain-productization.md" },
					{ id: "file-readme", path: "/README.md" },
				]}
				onPrimary={vi.fn()}
			/>,
		);
		const sizers = document.querySelectorAll(".external-write-review-sizer");
		const sizerTexts = Array.from(sizers, (node) => node.textContent);
		expect(sizerTexts).toContain("company-brain-productization.md");
		expect(sizerTexts).toContain("3 of 3");
		expect(sizerTexts).toContain("Seen 3 of 3");
		for (const sizer of sizers) {
			expect(sizer).toHaveAttribute("aria-hidden", "true");
		}
		expect(screen.getByText("icp.md")).toBeVisible();
		expect(screen.getByText("1 of 3")).toBeVisible();
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

	test("ESC closes an open list or menu before exiting; ⌘⏎ fires the verb on the selection", async () => {
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

		fireEvent.click(chip("Working set: 1 of 2 files"));
		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).not.toHaveBeenCalled();
		expect(screen.queryByRole("checkbox")).toBeNull();

		fireEvent.click(
			screen.getByRole("button", { name: "More checkpoint options" }),
		);
		expect(screen.getByRole("menu")).toBeVisible();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).not.toHaveBeenCalled();
		expect(screen.queryByRole("menu")).toBeNull();

		fireEvent.keyDown(window, { key: "Enter", metaKey: true });
		await waitFor(() =>
			expect(primary).toHaveBeenCalledWith(["file-tiktok"], {
				scope: "selection",
			}),
		);

		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).toHaveBeenCalledOnce();
	});
});
