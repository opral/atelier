import { Suspense } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { CheckpointStatusBar } from "./status-bar";

describe("CheckpointStatusBar", () => {
	test("creates a checkpoint for the current working changes", async () => {
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_key_value (key, value) VALUES ($1, $2)",
			["checkpoint-status-test", "working"],
		);
		const openHistory = vi.fn();

		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointStatusBar onOpenHistory={openHistory} />
					</Suspense>
				</LixProvider>,
			);
		});

		const historyButton = await screen.findByRole("button", {
			name: "1 working change. Open checkpoint history",
		});
		expect(historyButton).toHaveTextContent("1 working change");
		fireEvent.click(historyButton);
		expect(openHistory).toHaveBeenCalledOnce();

		fireEvent.click(screen.getByRole("button", { name: "Checkpoint" }));
		expect(
			await screen.findByRole("button", {
				name: /Checkpointed · .*Open checkpoint history/,
			}),
		).toHaveTextContent(/^Checkpointed · /);
		expect(screen.queryByRole("button", { name: "Checkpoint" })).toBeNull();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("keeps checkpoint creation out of read-only workspaces", async () => {
		const lix = await openLix();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<CheckpointStatusBar readOnly />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByText(/^Checkpointed · /)).toBeVisible();
		expect(screen.queryByRole("button", { name: "Checkpoint" })).toBeNull();

		await act(async () => view?.unmount());
		await lix.close();
	});
});
