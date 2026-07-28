import { Suspense } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { HistoryView } from ".";

describe("HistoryView", () => {
	test("shows a simple read-only checkpoint list", async () => {
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, data) VALUES ($1, $2, $3), ($4, $5, $6)",
			[
				fakeUuid("history-file-one"),
				"/one.txt",
				new TextEncoder().encode("one"),
				fakeUuid("history-file-two"),
				"/two.txt",
				new TextEncoder().encode("two"),
			],
		);
		const checkpoint = await lix.createCheckpoint();
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

		const checkpointList = await screen.findByRole("list", {
			name: "Checkpoints",
		});
		const checkpointItems = within(checkpointList).getAllByRole("listitem");
		expect(checkpointItems).toHaveLength(2);
		expect(checkpointItems[0]).toHaveAttribute("aria-current", "true");
		expect(within(checkpointList).getByText("Latest checkpoint")).toBeVisible();
		expect(
			within(checkpointList).getByText("Initial checkpoint"),
		).toBeVisible();
		expect(within(checkpointItems[0]!).getByText("2 files")).toBeVisible();
		expect(within(checkpointItems[1]!).getByText("0 files")).toBeVisible();
		expect(
			checkpointItems[0]?.querySelector("[data-checkpoint-flag]"),
		).not.toBeNull();
		expect(
			checkpointItems[1]?.querySelector("[data-checkpoint-flag]"),
		).not.toBeNull();
		expect(
			within(checkpointList).queryByText(checkpoint.commitId.slice(-8)),
		).toBeNull();
		expect(screen.queryByText("Working changes")).toBeNull();
		expect(screen.queryByText("Checkpoints")).toBeNull();
		expect(screen.queryByRole("button")).toBeNull();

		await act(async () => view?.unmount());
		await lix.close();
	});
});
