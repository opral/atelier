import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { CsvReviewGrid, CsvReviewSummary } from "./csv-review-grid";
import { buildCsvReviewModel } from "./csv-review-model";
import { EMPTY_CSV_FILTER } from "./csv-filter";

const encoder = new TextEncoder();
function model(before: string, after: string) {
	return buildCsvReviewModel({
		beforeData: encoder.encode(before),
		afterData: encoder.encode(after),
	});
}
function grid(review: ReturnType<typeof model>, overrides = {}) {
	return render(
		<CsvReviewGrid
			model={review}
			widths={review.columns.map(() => 180)}
			wrapped={review.columns.map(() => false)}
			rowHeight={() => 40}
			search=""
			filter={EMPTY_CSV_FILTER}
			sort={null}
			{...overrides}
		/>,
	);
}

describe("inline CSV review", () => {
	test("keeps added and removed rows and columns inside one table", () => {
		const review = model(
			"Name,Stage,Legacy\nAlex,Trial,old A\nJamie,Qualified,old B\nRobin,Discovery,old C\n",
			"Name,Stage,Owner\nAlex,Evaluating,Sam\nRobin,Discovery,Sam\nCasey,Onboarded,Taylor\n",
		);
		grid(review);
		const table = screen.getByRole("table", { name: "CSV changes" });
		expect(
			within(table).getByRole("columnheader", { name: /Legacy/ }),
		).toHaveAttribute("data-diff-status", "removed");
		expect(
			within(table).getByRole("columnheader", { name: /Owner/ }),
		).toHaveAttribute("data-diff-status", "added");
		expect(within(table).getByText("Jamie").closest("tr")).toHaveAttribute(
			"data-diff-status",
			"removed",
		);
		expect(within(table).getByText("Casey").closest("tr")).toHaveAttribute(
			"data-diff-status",
			"added",
		);
		expect(within(table).getByText("Alex").closest("tr")).not.toHaveAttribute(
			"data-diff-status",
			"added",
		);
	});

	test("details preserve the original row and header nodes and show exact before and after", () => {
		grid(
			model("Name,Notes\nAlex,Before text\n", "Name,Notes\nAlex,After text\n"),
		);
		const table = screen.getByRole("table", { name: "CSV changes" });
		const header = within(table).getByRole("columnheader", { name: "Notes" });
		const row = within(table).getByText("Alex").closest("tr");
		const trigger = screen.getByRole("button", {
			name: "Notes, row 1: changed",
		});
		fireEvent.click(trigger);
		const detail = screen.getByRole("dialog");
		expect(within(detail).getByText("Before text")).toBeVisible();
		expect(within(detail).getByText("After text")).toBeVisible();
		expect(within(table).getByRole("columnheader", { name: "Notes" })).toBe(
			header,
		);
		expect(within(table).getByText("Alex").closest("tr")).toBe(row);
		expect(table.contains(detail)).toBe(false);
		fireEvent.keyDown(document, { key: "Escape" });
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(trigger).toHaveFocus();
		fireEvent.click(trigger);
		fireEvent.pointerDown(document.body);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	test("whole-table deletion retains headers and all removed records", () => {
		grid(model("Name,Notes\nAlex,Keep visible\n", ""));
		const table = screen.getByRole("table", { name: "CSV changes" });
		expect(
			within(table).getByRole("columnheader", { name: /Name/ }),
		).toHaveAttribute("data-diff-status", "removed");
		expect(
			within(table).getByText("Keep visible").closest("tr"),
		).toHaveAttribute("data-diff-status", "removed");
	});

	test("search can locate a removed value or an old changed value", () => {
		const review = model(
			"Name,Notes\nAlex,Old phrase\nJamie,Deleted phrase\nRobin,Anchor\n",
			"Name,Notes\nAlex,New phrase\nRobin,Anchor\n",
		);
		const { rerender } = grid(review, { search: "Old phrase" });
		expect(screen.getByText("Alex")).toBeVisible();
		expect(screen.queryByText("Jamie")).toBeNull();
		rerender(
			<CsvReviewGrid
				model={review}
				widths={[180, 180]}
				wrapped={[false, false]}
				rowHeight={() => 40}
				search="Deleted phrase"
				filter={EMPTY_CSV_FILTER}
				sort={null}
			/>,
		);
		expect(screen.getByText("Jamie")).toBeVisible();
		expect(screen.queryByText("Alex")).toBeNull();
	});

	test("row reordering is discoverable in the review summary", () => {
		const review = model(
			"Name,Notes\nAlex,One\nJamie,Two\nRobin,Three\n",
			"Name,Notes\nJamie,Two\nAlex,One\nRobin,Three\n",
		);
		render(<CsvReviewSummary model={review} />);
		fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
		expect(screen.getByRole("dialog")).toHaveTextContent("Row position");
		expect(screen.queryByLabelText("No changes")).toBeNull();
	});

	test("an unannotated plain CSV has no spurious settings changes", () => {
		const review = model("Name,Notes\nAlex,Same\n", "Name,Notes\nAlex,Same\n");
		render(<CsvReviewSummary model={review} />);
		expect(screen.getByLabelText("No changes")).toBeVisible();
		expect(screen.queryByRole("button")).toBeNull();
	});
});
