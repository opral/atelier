import { useRef } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { useCsvTheme } from "./use-csv-theme";

function Fixture() {
	const ref = useRef<HTMLDivElement>(null);
	const appearance = useCsvTheme(ref);
	return (
		<div ref={ref} data-testid="table">
			<output>{JSON.stringify(appearance)}</output>
		</div>
	);
}

test("canvas colors follow token overrides and return to defaults when overrides are removed", async () => {
	const view = render(<Fixture />);
	try {
		const table = screen.getByTestId("table");
		const read = () => JSON.parse(table.querySelector("output")!.textContent!);
		const original = read();
		table.style.setProperty("--color-bg-action-primary", "rgb(170, 60, 10)");
		table.style.setProperty("--color-bg-tag-green", "rgb(210, 230, 210)");
		table.style.setProperty("--color-bg-search-match", "rgb(250, 230, 130)");
		await waitFor(() =>
			expect(read().theme.accentColor).toBe("rgb(170, 60, 10)"),
		);
		expect(read().palette.green[0]).toBe("rgb(210, 230, 210)");
		expect(read().searchColor).toBe("rgb(250, 230, 130)");
		table.removeAttribute("style");
		await waitFor(() => expect(read()).toEqual(original));
	} finally {
		view.unmount();
	}
});
