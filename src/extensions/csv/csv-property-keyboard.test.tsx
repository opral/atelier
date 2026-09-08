import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { providePropertyEditor } from "./csv-properties";
afterEach(cleanup);
function mountPicker() {
	const finish = vi.fn();
	const value = {
		kind: GridCellKind.Text,
		data: "Existing",
		displayData: "Existing",
		allowOverlay: true,
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
