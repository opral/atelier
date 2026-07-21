import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { TopBar } from ".";

describe("TopBar", () => {
	test("matches the panel frame horizontal inset", () => {
		const { container } = render(<TopBar />);

		expect(container.querySelector("header")).toHaveClass("px-2");
		expect(container.querySelector("header")).not.toHaveClass("px-3");
		expect(screen.getByLabelText("Toggle left panel")).toHaveClass(
			"justify-center",
		);
		expect(screen.getByLabelText("Toggle right panel")).toHaveClass(
			"justify-center",
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

	test("forwards host props to a stable semantic header", () => {
		const ref = createRef<HTMLElement>();
		const onPointerDown = vi.fn();
		const { container } = render(
			<TopBar
				rootProps={{
					"aria-label": "Workspace controls",
					"data-app-titlebar": true,
					className: "bg-red-500",
					onPointerDown,
					ref,
				}}
			/>,
		);

		const header = container.querySelector("header");
		expect(header).toHaveAttribute("data-atelier-part", "top-bar");
		expect(header).toHaveAttribute("data-app-titlebar", "true");
		expect(header).toHaveAttribute("aria-label", "Workspace controls");
		expect(header).toHaveClass("bg-red-500", "px-2");
		expect(ref.current).toBe(header);
		if (!header) throw new Error("Top bar header is unavailable");
		fireEvent.pointerDown(header);
		expect(onPointerDown).toHaveBeenCalledOnce();
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

	test("shows reviewing label after the active file name in review mode", () => {
		render(<TopBar activeFileName="note.md" isReviewing={true} />);

		expect(screen.getByText("note.md")).toBeVisible();
		expect(screen.getByText("Reviewing")).toBeVisible();
	});

	test("shows a read-only chip beside the active file name", () => {
		render(<TopBar activeFileName="note.md" isReadOnly />);

		expect(screen.getByText("note.md")).toBeVisible();
		expect(screen.getByText("Read-only")).toBeVisible();
	});

	test("shows the read-only chip even without an active file", () => {
		render(<TopBar isReadOnly />);

		expect(screen.getByText("Read-only")).toBeVisible();
	});

	test("does not show a read-only chip for writable workspaces", () => {
		render(<TopBar activeFileName="note.md" />);

		expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
	});

	test("does not show reviewing label without an active file", () => {
		render(<TopBar isReviewing={true} />);

		expect(screen.queryByText("Reviewing")).toBeNull();
	});
});
