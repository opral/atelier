import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import {
	CsvReviewFoldAction,
	CsvReviewGrid,
	CsvReviewSummary,
	useCsvReviewFolds,
} from "./csv-review-grid";
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

	test("only a changed cell opens details; added and removed cells have nothing to compare", () => {
		grid(
			model(
				"Name,Notes\nAlex,Before text\nRemoved,Gone\n",
				"Name,Notes\nAlex,After text\nAdded,New\n",
			),
		);
		// A changed value has two sides worth a popover.
		expect(
			screen.getByRole("button", { name: "Notes, row 1: changed" }),
		).toBeVisible();
		// An added or removed cell's other side is "not present" by definition:
		// the row colour already says so, and there is no trigger to click.
		expect(
			screen.queryByRole("button", { name: /Notes, row \d+: added/ }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: /Name, row \d+: added/ }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: /row \d+: removed/ }),
		).toBeNull();
		const table = screen.getByRole("table", { name: "CSV changes" });
		expect(within(table).getByText("New")).toBeVisible();
		expect(within(table).getByText("Gone")).toBeVisible();
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

	// Both labels are one flex row of a count and a word, and the toolbar
	// spaces those two items itself: the space between them in the markup is
	// collapsed away, whichever branch rendered it.
	test("counts and their word are the same two parts whether or not there are changes", () => {
		const changed = render(
			<CsvReviewSummary model={model("Name\nAlex\n", "Name\nAlexa\n")} />,
		);
		const changedLabel = screen.getByRole("button", { name: "Review changes" });
		expect(changedLabel).toHaveClass("csv-review-summary");
		expect(changedLabel.textContent).toBe("2 changes");
		expect(
			changedLabel.querySelector(".csv-review-summary-word")?.textContent,
		).toBe(" changes");
		changed.unmount();

		render(<CsvReviewSummary model={model("Name\nAlex\n", "Name\nAlex\n")} />);
		const zeroLabel = screen.getByLabelText("No changes");
		expect(zeroLabel).toHaveClass("csv-review-summary");
		expect(zeroLabel.textContent).toBe("0 changes");
		expect(
			zeroLabel.querySelector(".csv-review-summary-word")?.textContent,
		).toBe(" changes");
	});
});

function sheet(count: number, changed: Record<number, string> = {}) {
	const lines = ["Name,Note"];
	for (let index = 1; index <= count; index++)
		lines.push(`${index},${changed[index] ?? index}`);
	return `${lines.join("\n")}\n`;
}
/** The toolbar slot and the grid, wired the way the CSV view wires them. */
function Review({ review }: { review: ReturnType<typeof model> }) {
	const folds = useCsvReviewFolds(review, {
		search: "",
		filter: EMPTY_CSV_FILTER,
		sort: null,
	});
	return (
		<>
			<CsvReviewFoldAction folds={folds} />
			<CsvReviewGrid
				model={review}
				widths={review.columns.map(() => 180)}
				wrapped={review.columns.map(() => false)}
				rowHeight={() => 40}
				search=""
				filter={EMPTY_CSV_FILTER}
				sort={null}
				folds={folds}
			/>
		</>
	);
}
const names = () =>
	[
		...screen
			.getByRole("table", { name: "CSV changes" })
			.querySelectorAll("tbody tr:not(.csv-review-band) th"),
	].map((cell) => cell.textContent);

describe("folded CSV review", () => {
	test("a review opens folded, with a band standing in for each run", () => {
		grid(model(sheet(10), sheet(10, { 5: "five" })));
		expect(names()).toEqual(["4", "5", "6"]);
		const bands = screen.getAllByRole("button", { name: /unchanged rows?,/ });
		expect(
			bands.every((band) => band.getAttribute("aria-expanded") === "false"),
		).toBe(true);
		expect(bands.map((band) => band.getAttribute("aria-label"))).toEqual([
			"3 unchanged rows, rows 1 to 3",
			"4 unchanged rows, rows 7 to 10",
		]);
		expect(screen.getByRole("table", { name: "CSV changes" })).toHaveAttribute(
			"aria-rowcount",
			"11",
		);
	});

	test("a band opens its own run and keeps saying what it holds", () => {
		grid(model(sheet(10), sheet(10, { 5: "five" })));
		const band = screen.getByRole("button", {
			name: "3 unchanged rows, rows 1 to 3",
		});
		expect(band).toHaveTextContent("Show");
		fireEvent.click(band);
		expect(names()).toEqual(["1", "2", "3", "4", "5", "6"]);
		expect(band).toHaveAttribute("aria-expanded", "true");
		expect(band).toHaveTextContent("Hide");
		// The rows it revealed keep their own place in the table, not a place in
		// what is currently on screen.
		const revealed = screen
			.getByRole("table", { name: "CSV changes" })
			.querySelectorAll("tbody tr:not(.csv-review-band)");
		expect(revealed[0]).toHaveAttribute("aria-rowindex", "2");
		expect(revealed[3]).toHaveAttribute("aria-rowindex", "5");
		fireEvent.click(band);
		expect(names()).toEqual(["4", "5", "6"]);
		expect(band).toHaveAttribute("aria-expanded", "false");
	});

	test("the toolbar action opens every band at once, and then closes them", () => {
		render(<Review review={model(sheet(10), sheet(10, { 5: "five" }))} />);
		const action = screen.getByRole("button", { name: "Show all 10 rows" });
		fireEvent.click(action);
		expect(names()).toHaveLength(10);
		expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(2);
		const back = screen.getByRole("button", { name: "Show changes only" });
		fireEvent.click(back);
		expect(names()).toEqual(["4", "5", "6"]);
		expect(
			screen.getByRole("button", { name: "Show all 10 rows" }),
		).toBeVisible();
	});

	test("opening one band of two leaves the toolbar still offering the rest", () => {
		render(<Review review={model(sheet(10), sheet(10, { 5: "five" }))} />);
		fireEvent.click(
			screen.getByRole("button", { name: "3 unchanged rows, rows 1 to 3" }),
		);
		expect(
			screen.getByRole("button", { name: "Show all 10 rows" }),
		).toBeVisible();
	});

	// Nothing to fold, so no separator and no action: entering a review that
	// reports nothing adds nothing to the toolbar.
	test("a review with no changes offers no action and folds no rows", () => {
		render(<Review review={model(sheet(6), sheet(6))} />);
		expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
		expect(document.querySelector(".csv-review-fold-separator")).toBeNull();
		expect(names()).toHaveLength(6);
	});

	test("a review where every row changed has no bands", () => {
		render(
			<Review review={model(sheet(3), sheet(3, { 1: "a", 2: "b", 3: "c" }))} />,
		);
		expect(document.querySelector(".csv-review-band")).toBeNull();
		expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
		expect(names()).toEqual(["1", "2", "3"]);
	});

	test("a change that is only a column folds every row into one band", () => {
		render(
			<Review
				review={model(
					"Name,Note\n1,one\n2,two\n3,three\n",
					"Name,Remark\n1,one\n2,two\n3,three\n",
				)}
			/>,
		);
		expect(names()).toEqual([]);
		expect(
			screen.getByRole("button", { name: "3 unchanged rows, rows 1 to 3" }),
		).toBeVisible();
		expect(
			screen.getByRole("button", { name: "Show all 3 rows" }),
		).toBeVisible();
	});
});
