import { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { DiffSides } from "./diff-sides";

test("both sides are labelled, and a missing one says when the file did not exist", async () => {
	const lix = await openLix();
	let utils: ReturnType<typeof render> | undefined;
	try {
		await act(async () => {
			utils = render(
				<div className="atelier-root">
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<DiffSides
								filePath="/assets/shot.png"
								beforeCommitId="commit_before"
								afterCommitId="commit_after"
								before={null}
								after={<p>the working file</p>}
							/>
						</Suspense>
					</LixProvider>
				</div>,
			);
		});

		const before = await screen.findByRole("region", {
			name: "Before: shot.png",
		});
		const after = screen.getByRole("region", { name: "After: shot.png" });
		expect(after).toHaveTextContent("the working file");
		expect(
			before.querySelector("[data-attr='checkpoint-absent-file']"),
		).not.toBeNull();
		// The order is the reading order: the older revision first.
		expect(
			[...utils!.container.querySelectorAll("[data-diff-side]")].map(
				(side) => (side as HTMLElement).dataset.diffSide,
			),
		).toEqual(["before", "after"]);
	} finally {
		await act(async () => utils?.unmount());
		await lix.close();
	}
});
