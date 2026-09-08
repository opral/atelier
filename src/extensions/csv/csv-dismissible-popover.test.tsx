import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { CsvDismissiblePopover } from "./csv-dismissible-popover";
import { CsvToolbarSelect } from "./csv-toolbar-select";

function Fixture({ label }: { label: string }) {
	const [open, setOpen] = useState(false);
	const [value, setValue] = useState("");
	const [clicks, setClicks] = useState(0);
	const trigger = useRef<HTMLButtonElement>(null);
	return (
		<>
			<button ref={trigger} onClick={() => setOpen(!open)}>
				{label}
			</button>
			<button onClick={() => setClicks(clicks + 1)}>Outside {clicks}</button>
			<input aria-label="Outside input" />
			{open && (
				<CsvDismissiblePopover
					label={label}
					trigger={trigger}
					onDismiss={() => setOpen(false)}
				>
					<input aria-label="Inside input" />
					<CsvToolbarSelect
						label="Column"
						value={value}
						options={[{ value: "stage", label: "Stage" }]}
						onChange={setValue}
					/>
				</CsvDismissiblePopover>
			)}
		</>
	);
}

test.each(["Sort by", "Filter by"])(
	"%s dismisses on an outside press without consuming the click",
	(label) => {
		const view = render(<Fixture label={label} />);
		try {
			fireEvent.click(screen.getByRole("button", { name: label }));
			fireEvent.pointerDown(screen.getByLabelText("Inside input"));
			expect(screen.getByRole("dialog", { name: label })).toBeInTheDocument();
			const outside = screen.getByRole("button", { name: "Outside 0" });
			fireEvent.pointerDown(outside);
			expect(
				screen.queryByRole("dialog", { name: label }),
			).not.toBeInTheDocument();
			fireEvent.click(outside);
			expect(
				screen.getByRole("button", { name: "Outside 1" }),
			).toBeInTheDocument();
		} finally {
			view.unmount();
		}
	},
);

test("portalled picker interaction stays inside the parent; Escape dismisses one level at a time", async () => {
	const view = render(<Fixture label="Sort by" />);
	try {
		const trigger = screen.getByRole("button", { name: "Sort by" });
		fireEvent.click(trigger);
		fireEvent.keyDown(screen.getByRole("button", { name: "Column" }), {
			key: "ArrowDown",
		});
		const option = await screen.findByRole("menuitemradio", { name: "Stage" });
		fireEvent.pointerDown(option);
		expect(screen.getByRole("dialog", { name: "Sort by" })).toBeInTheDocument();
		fireEvent.click(option);
		expect(screen.getByRole("button", { name: "Column" })).toHaveTextContent(
			"Stage",
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Column" }), {
			key: "ArrowDown",
		});
		fireEvent.keyDown(
			await screen.findByRole("menuitemradio", { name: "Stage" }),
			{ key: "Escape" },
		);
		expect(screen.getByRole("dialog", { name: "Sort by" })).toBeInTheDocument();
		fireEvent.keyDown(screen.getByRole("button", { name: "Column" }), {
			key: "Escape",
		});
		expect(
			screen.queryByRole("dialog", { name: "Sort by" }),
		).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	} finally {
		view.unmount();
	}
});

test("moving keyboard focus outside dismisses the popover", () => {
	const view = render(<Fixture label="Filter by" />);
	try {
		fireEvent.click(screen.getByRole("button", { name: "Filter by" }));
		fireEvent.focusIn(screen.getByLabelText("Outside input"));
		expect(
			screen.queryByRole("dialog", { name: "Filter by" }),
		).not.toBeInTheDocument();
	} finally {
		view.unmount();
	}
});

test("outside events crossing a shadow root still dismiss", () => {
	const view = render(<Fixture label="Sort by" />);
	const host = document.createElement("div");
	const outside = document.createElement("button");
	host.attachShadow({ mode: "open" }).append(outside);
	document.body.append(host);
	try {
		fireEvent.click(screen.getByRole("button", { name: "Sort by" }));
		fireEvent.pointerDown(outside, { composed: true, bubbles: true });
		expect(
			screen.queryByRole("dialog", { name: "Sort by" }),
		).not.toBeInTheDocument();
	} finally {
		host.remove();
		view.unmount();
	}
});
