import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { providePropertyEditor } from "./csv-properties";
afterEach(cleanup);
function mountPicker(optionValues?: readonly string[]) {
	const finish = vi.fn();
	const value = {
		kind: GridCellKind.Text,
		data: "Existing",
		displayData: "Existing",
		allowOverlay: true,
		csvOptionValues: optionValues,
		csvInfo: {
			id: "stage",
			header: "Stage",
			index: 0,
			type: "select",
			options: [
				{ value: "Existing", color: "blue" },
				{ value: "漢字", color: "gray" },
			],
		},
	};
	const config = providePropertyEditor(value as any) as any;
	const Component = config.editor;
	render(
		<Component
			value={value}
			onFinishedEditing={finish}
			onChange={vi.fn()}
			target={{ x: 0, y: 0, width: 200, height: 32 }}
		/>,
	);
	return { input: screen.getByRole("combobox"), finish };
}
test.each(["Enter", "Escape"])(
	"IME %s does not commit or dismiss the property picker",
	(key) => {
		const { input, finish } = mountPicker();
		fireEvent.change(input, { target: { value: "漢" } });
		fireEvent.keyDown(input, { key, isComposing: true, keyCode: 229 });
		expect(finish).not.toHaveBeenCalled();
	},
);
test("Enter after composition commits the selected option", () => {
	const { input, finish } = mountPicker();
	fireEvent.change(input, { target: { value: "漢" } });
	fireEvent.keyDown(input, { key: "Enter" });
	expect(finish).toHaveBeenCalledWith(
		expect.objectContaining({ data: "漢字" }),
	);
});

test("Escape outside composition cancels the picker without changing the value", () => {
	const { input, finish } = mountPicker();
	fireEvent.change(input, { target: { value: "draft" } });
	fireEvent.keyDown(input, { key: "Escape" });
	expect(finish).toHaveBeenCalledWith();
});

test("Arrow keys select an existing option and Enter commits it", () => {
	const { input, finish } = mountPicker();
	fireEvent.keyDown(input, { key: "ArrowDown" });
	fireEvent.keyDown(input, { key: "Enter" });
	expect(finish).toHaveBeenCalledWith(
		expect.objectContaining({ data: "漢字" }),
	);
});

test("a value the column holds without metadata is offered like a declared option", () => {
	const { input, finish } = mountPicker(["Existing", "Research", "漢字"]);
	// Declared first, in metadata order; the undeclared value after them.
	expect(
		screen.getAllByRole("option").map((option) => option.textContent),
	).toEqual(["Existing", "漢字", "Research"]);
	fireEvent.change(input, { target: { value: "research" } });
	// It is a real option now, so there is nothing to create.
	expect(screen.queryByText("Create")).toBeNull();
	fireEvent.keyDown(input, { key: "Enter" });
	expect(finish).toHaveBeenCalledWith(
		expect.objectContaining({ data: "Research" }),
	);
	expect(finish.mock.calls[0]?.[0]).not.toHaveProperty("csvNewOption");
});
