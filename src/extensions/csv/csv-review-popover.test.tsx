import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { CsvReviewTrigger } from "./csv-review-popover";

function Fixture() {
	return (
		<div className="atelier-root">
			<input aria-label="Outside" />
			<CsvReviewTrigger
				label="Stage changed"
				title="Stage"
				details={[
					{ label: "Type", before: "Text", after: "Select" },
					{ label: "Choice", before: "", after: "Trial" },
					{ label: "Added option", after: "Qualified" },
				]}
			>
				<span>Trial</span>
			</CsvReviewTrigger>
		</div>
	);
}
afterEach(() => vi.useRealTimers());

test("hover details preserve focus and bridge the gap; leaving closes after a grace period", () => {
	vi.useFakeTimers();
	const view = render(<Fixture />);
	try {
		const outside = screen.getByLabelText("Outside");
		outside.focus();
		const trigger = screen.getByRole("button", { name: "Stage changed" });
		fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
		const dialog = screen.getByRole("dialog", { name: "Stage" });
		expect(outside).toHaveFocus();
		fireEvent.pointerLeave(trigger);
		act(() => vi.advanceTimersByTime(100));
		fireEvent.pointerEnter(dialog);
		act(() => vi.advanceTimersByTime(200));
		expect(dialog).toBeInTheDocument();
		fireEvent.pointerLeave(dialog);
		act(() => vi.advanceTimersByTime(181));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	} finally {
		view.unmount();
	}
});

test("click pins details, Escape restores trigger focus without reopening, and outside press dismisses", () => {
	vi.useFakeTimers();
	const view = render(<Fixture />);
	try {
		const trigger = screen.getByRole("button", { name: "Stage changed" });
		fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
		fireEvent.click(trigger);
		const dialog = screen.getByRole("dialog", { name: "Stage" });
		expect(dialog).toHaveFocus();
		fireEvent.pointerLeave(trigger);
		act(() => vi.advanceTimersByTime(200));
		expect(dialog).toBeInTheDocument();
		fireEvent.keyDown(dialog, { key: "Escape" });
		expect(trigger).toHaveFocus();
		expect(trigger).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
		fireEvent.click(trigger);
		fireEvent.pointerDown(screen.getByLabelText("Outside"));
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	} finally {
		view.unmount();
	}
});

test("details distinguish absent properties from empty values and render strings safely", () => {
	const view = render(<Fixture />);
	try {
		fireEvent.click(screen.getByRole("button", { name: "Stage changed" }));
		const dialog = screen.getByRole("dialog");
		expect(within(dialog).getByText("Empty")).toBeInTheDocument();
		expect(within(dialog).getByText("Not present")).toBeInTheDocument();
		expect(within(dialog).getAllByText("Before")).toHaveLength(3);
		expect(within(dialog).getAllByText("After")).toHaveLength(3);
		expect(dialog.parentElement).toHaveClass("atelier-root");
	} finally {
		view.unmount();
	}
});

test("portalled details in a shadow root treat inside presses as inside, and outside focus dismisses", () => {
	const host = document.createElement("div");
	document.body.append(host);
	const shadow = host.attachShadow({ mode: "open" });
	const container = document.createElement("div");
	shadow.append(container);
	const view = render(<Fixture />, { container });
	try {
		const trigger = within(container).getByRole("button", {
			name: "Stage changed",
		});
		fireEvent.click(trigger);
		const dialog = within(container).getByRole("dialog");
		fireEvent.pointerDown(within(dialog).getByText("Text"));
		expect(dialog).toBeInTheDocument();
		act(() => within(container).getByLabelText("Outside").focus());
		expect(within(container).queryByRole("dialog")).not.toBeInTheDocument();
	} finally {
		view.unmount();
		host.remove();
	}
});

test("scrolling the table dismisses the fixed popover; scrolling its details does not", () => {
	const view = render(<Fixture />);
	try {
		fireEvent.click(screen.getByRole("button", { name: "Stage changed" }));
		const dialog = screen.getByRole("dialog");
		fireEvent.scroll(dialog);
		expect(dialog).toBeInTheDocument();
		fireEvent.scroll(document);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	} finally {
		view.unmount();
	}
});

test("option color changes retain the choice label and expose each color accessibly", () => {
	const view = render(
		<CsvReviewTrigger
			label="Stage changed"
			details={[
				{
					label: "Option color",
					before: "Trial",
					after: "Trial",
					beforeColor: "blue",
					afterColor: "purple",
				},
				{
					label: "Untrusted color",
					after: "Other",
					afterColor: "url(javascript:invalid)",
				},
				{ label: "Property type", before: "text", after: "select" },
			]}
		>
			Stage
		</CsvReviewTrigger>,
	);
	try {
		fireEvent.click(screen.getByRole("button", { name: "Stage changed" }));
		const before = screen.getByRole("img", { name: "Trial, blue" });
		const after = screen.getByRole("img", { name: "Trial, purple" });
		expect(before).toHaveTextContent("Trial");
		expect(after).toHaveTextContent("Trial");
		expect(before).toHaveAttribute("data-color", "blue");
		expect(after).toHaveAttribute("data-color", "purple");
		expect(screen.getByText("Other")).not.toHaveAttribute("data-color");
		expect(screen.getByText("Text")).toHaveClass("csv-review-detail-type");
		expect(screen.getByText("Select")).toHaveClass("csv-review-detail-type");
	} finally {
		view.unmount();
	}
});
