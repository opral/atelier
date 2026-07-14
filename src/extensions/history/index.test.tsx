import { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { HistoryView } from ".";

describe("HistoryView", () => {
	test("renders the active Lix branch as the current checkpoint", async () => {
		const lix = await openLix();
		const activeBranchId = await lix.activeBranchId();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<HistoryView
							activeBranchId={activeBranchId}
							switchBranch={async () => {}}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const checkpoint = await screen.findByRole("button", {
			name: "Current Checkpoint",
		});
		expect(checkpoint).toHaveAttribute("aria-current", "true");
		await act(async () => view?.unmount());
		await lix.close();
	});
});
