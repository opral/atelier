import { Suspense } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { HistoryView } from ".";

describe("HistoryView", () => {
	test("shows working changes and checkpoint history without mutation actions", async () => {
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_key_value (key, value) VALUES ($1, $2)",
			["history-view-test", "checkpointed"],
		);
		const checkpoint = await lix.createCheckpoint();
		await lix.execute("UPDATE lix_key_value SET value = $1 WHERE key = $2", [
			"working",
			"history-view-test",
		]);

		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<HistoryView />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(await screen.findByText("Working changes")).toBeVisible();
		expect(
			screen.getByText("1 change since the latest checkpoint"),
		).toBeVisible();
		const checkpointList = screen.getByRole("list", {
			name: "Checkpoints",
		});
		expect(within(checkpointList).getAllByRole("listitem")).toHaveLength(2);
		expect(within(checkpointList).getByText("Latest checkpoint")).toBeVisible();
		expect(
			within(checkpointList).getByText("Initial checkpoint"),
		).toBeVisible();
		expect(
			within(checkpointList).getByText(checkpoint.commitId.slice(-8)),
		).toBeVisible();
		expect(screen.queryByRole("button")).toBeNull();

		await act(async () => view?.unmount());
		await lix.close();
	});
});
