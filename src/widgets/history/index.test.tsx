import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { HistoryView } from "./index";
import {
	COMMIT_WIDGET_KIND,
	commitWidgetInstance,
} from "../../widget-runtime/widget-instance-helpers";

const mockId = "cp-1";
vi.mock("@/lib/lix-react", () => ({
	useQuery: vi.fn(() => [
		{
			id: mockId,
			added: 0,
			removed: 0,
			checkpoint_created_at: "2024-01-01T00:00:00.000Z",
		},
	]),
}));

describe("HistoryView", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("opens commit without stealing focus when the panel is focused", async () => {
		const handleOpenCommit = vi.fn();

		render(
			<HistoryView
				context={{
					openWidget: handleOpenCommit,
					isPanelFocused: true,
					setTabBadgeCount: () => {},
					lix: {} as any,
				}}
			/>,
		);

		const commitButton = await screen.findByTestId(
			`history-checkpoint-${mockId}`,
		);
		fireEvent.click(commitButton);

		expect(handleOpenCommit).toHaveBeenCalledWith({
			panel: "central",
			kind: COMMIT_WIDGET_KIND,
			instance: commitWidgetInstance(mockId),
			state: {
				checkpointId: mockId,
				flashtype: { label: expect.any(String) },
			},
			focus: false,
		});
	});

	test("falls back to default focusing when the panel is not focused", async () => {
		const handleOpenCommit = vi.fn();

		render(
			<HistoryView
				context={{
					openWidget: handleOpenCommit,
					isPanelFocused: false,
					setTabBadgeCount: () => {},
					lix: {} as any,
				}}
			/>,
		);

		const commitButton = await screen.findByTestId(
			`history-checkpoint-${mockId}`,
		);
		fireEvent.click(commitButton);

		expect(handleOpenCommit).toHaveBeenCalledWith({
			panel: "central",
			kind: COMMIT_WIDGET_KIND,
			instance: commitWidgetInstance(mockId),
			state: {
				checkpointId: mockId,
				flashtype: { label: expect.any(String) },
			},
			focus: undefined,
		});
	});
});
