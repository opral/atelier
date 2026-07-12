import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TopBar } from ".";

describe("TopBar", () => {
	test("matches the panel frame horizontal inset", () => {
		const { container } = render(<TopBar />);

		expect(container.querySelector("header")).toHaveClass("px-2");
		expect(container.querySelector("header")).not.toHaveClass("px-3");
		expect(screen.getByLabelText("Toggle left panel")).toHaveClass(
			"justify-start",
		);
		expect(screen.getByLabelText("Toggle right panel")).toHaveClass(
			"justify-end",
		);
	});

	test("renders stable analytics selectors for chrome controls", () => {
		render(
			<TopBar onToggleLeftSidebar={vi.fn()} onToggleRightSidebar={vi.fn()} />,
		);

		expect(screen.getByLabelText("Toggle left panel")).toHaveAttribute(
			"data-attr",
			"topbar-toggle-left-panel",
		);
		expect(screen.queryByLabelText("Install update")).not.toBeInTheDocument();
		expect(screen.queryByTitle("GitHub")).not.toBeInTheDocument();
		expect(screen.getByLabelText("Toggle right panel")).toHaveAttribute(
			"data-attr",
			"topbar-toggle-right-panel",
		);
	});

	test("renders host navbar content around Atelier's panel controls", () => {
		render(
			<TopBar
				navbarStart={<a href="/">Host home</a>}
				navbarEnd={<button type="button">Share</button>}
			/>,
		);

		const start = screen.getByText("Host home");
		const leftToggle = screen.getByLabelText("Toggle left panel");
		const end = screen.getByText("Share");
		const rightToggle = screen.getByLabelText("Toggle right panel");

		expect(
			start.compareDocumentPosition(leftToggle) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			end.compareDocumentPosition(rightToggle) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	test("shows reviewing label after the active file name in checkpoint diff mode", () => {
		render(<TopBar activeFileName="note.md" isReviewingCheckpoint={true} />);

		expect(screen.getByText("note.md")).toBeVisible();
		expect(screen.getByText("Reviewing")).toBeVisible();
	});

	test("does not show reviewing label without an active file", () => {
		render(<TopBar isReviewingCheckpoint={true} />);

		expect(screen.queryByText("Reviewing")).toBeNull();
	});
});
