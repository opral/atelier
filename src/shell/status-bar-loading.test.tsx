import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { CheckpointStatusBar } from "./status-bar";

const state = vi.hoisted(() => ({
	count: { status: "pending", rows: [] } as any,
	epoch: { status: "pending", rows: [] } as any,
	options: [] as any[],
}));
vi.mock("@/lib/lix-react", () => ({
	useQueryResult: (_query: unknown, options: any) => {
		state.options.push(options);
		return "enabled" in options ? state.epoch : state.count;
	},
}));
beforeEach(() => {
	state.count = { status: "pending", rows: [] };
	state.epoch = { status: "pending", rows: [] };
	state.options = [];
});

test("unknown changes never claim an empty checkpoint and epoch demand follows review visibility", () => {
	const view = render(<CheckpointStatusBar />);
	expect(screen.getByRole("status")).toHaveTextContent("Loading changes");
	expect(screen.queryByText("Latest checkpoint")).toBeNull();
	expect(state.options.at(-1)).toMatchObject({ enabled: false });
	view.rerender(<CheckpointStatusBar reviewingWorkingChanges />);
	expect(state.options.at(-1)).toMatchObject({ enabled: true });
	view.rerender(<CheckpointStatusBar />);
	expect(state.options.at(-1)).toMatchObject({ enabled: false });
});

test("failed optional counts preserve controls and provide local retry", () => {
	state.count = { status: "error", rows: [], error: new Error("deadline") };
	render(<CheckpointStatusBar />);
	expect(screen.getByRole("switch")).toBeInTheDocument();
	expect(screen.queryByText("Latest checkpoint")).toBeNull();
	fireEvent.click(
		screen.getByRole("button", { name: "Changes unavailable · Retry" }),
	);
	expect(state.options.at(-2)).toMatchObject({ retryKey: 1 });
});

test("a failed epoch never describes a stale review as current", () => {
	state.count = { status: "success", rows: [{ file_count: 1 }] };
	state.epoch = { status: "error", rows: [], error: new Error("deadline") };
	render(<CheckpointStatusBar reviewingWorkingChanges />);
	expect(
		screen.getByText("1 file changed since checkpoint"),
	).toBeInTheDocument();
	fireEvent.click(
		screen.getByRole("button", { name: "Review status unavailable · Retry" }),
	);
	expect(state.options.at(-1)).toMatchObject({ enabled: true, retryKey: 1 });
});
