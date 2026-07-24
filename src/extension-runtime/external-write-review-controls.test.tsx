import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { ExternalWriteReviewControls } from "./external-write-review-controls";

describe("ExternalWriteReviewControls", () => {
	test("keeps gated review decisions file-scoped", () => {
		const accept = vi.fn();
		const reject = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				onAccept={accept}
				onReject={reject}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /^Keep/ }));
		expect(accept).toHaveBeenCalledOnce();
		fireEvent.click(screen.getByRole("button", { name: /^Undo/ }));
		expect(reject).toHaveBeenCalledOnce();
		expect(screen.queryByRole("button", { name: /^Checkpoint/ })).toBeNull();
	});

	test("separates file undo from workspace checkpoint in auto-accept mode", async () => {
		const accept = vi.fn();
		const reject = vi.fn();
		const checkpoint = vi.fn(async () => {});
		const exit = vi.fn();
		render(
			<ExternalWriteReviewControls
				isActive
				autoAccept
				navigation={{
					fileName: "note.md",
					activeIndex: 0,
					fileCount: 2,
					onPrevious: vi.fn(),
					onNext: vi.fn(),
				}}
				onAccept={accept}
				onReject={reject}
				onCheckpoint={checkpoint}
				onExit={exit}
			/>,
		);

		expect(screen.getByText("1 of 2")).toBeVisible();
		expect(screen.queryByRole("button", { name: /^Keep/ })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /^Undo/ }));
		expect(reject).toHaveBeenCalledOnce();
		fireEvent.click(screen.getByRole("button", { name: /^Checkpoint/ }));
		await waitFor(() => expect(checkpoint).toHaveBeenCalledOnce());

		fireEvent.keyDown(window, { key: "Escape" });
		expect(exit).toHaveBeenCalledOnce();
		expect(accept).not.toHaveBeenCalled();
	});
});
