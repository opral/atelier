import { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import type { AtelierDiffSession } from "@/extension-api";
import { DiffSides, viewShowsDiff } from "./diff-sides";

describe("viewShowsDiff", () => {
	const session: AtelierDiffSession = {
		base: { commitId: "commit_before" },
		target: { working: true },
		files: [
			{
				id: "file_1",
				path: "/shot.png",
				changeKind: "modified",
				workingEpoch: {
					beforeCommitId: "commit_before",
					afterCommitId: "commit_after",
				},
				review: { id: "review_1", status: "pending" },
			},
		],
		activePath: "/shot.png",
		capabilities: { checkpoint: true, undo: true, restore: false },
	};

	test("a file under review is comparing", () => {
		expect(viewShowsDiff({ session, state: { fileId: "file_1" } })).toBe(true);
	});

	test("so is a file opened at both ends of a span", () => {
		expect(
			viewShowsDiff({
				session: null,
				state: {
					fileId: "file_1",
					beforeCommitId: "commit_a",
					afterCommitId: "commit_b",
				},
			}),
		).toBe(true);
	});

	test("one revision is not", () => {
		expect(viewShowsDiff({ session: null, state: { fileId: "file_1" } })).toBe(
			false,
		);
		expect(
			viewShowsDiff({
				session: null,
				state: { fileId: "file_1", sourceCommitId: "commit_a" },
			}),
		).toBe(false);
		// Another file's review says nothing about this view.
		expect(viewShowsDiff({ session, state: { fileId: "file_2" } })).toBe(false);
		expect(viewShowsDiff({ session, state: { scope: "branch" } })).toBe(false);
	});

	test("a resolved review is over", () => {
		expect(
			viewShowsDiff({
				session: {
					...session,
					files: [
						{
							...session.files[0]!,
							review: { id: "review_1", status: "resolved" },
						},
					],
				},
				state: { fileId: "file_1" },
			}),
		).toBe(false);
	});
});

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

test("a pending comparison keeps both columns, with nothing in them yet", () => {
	const utils = render(
		<div className="atelier-root">
			<DiffSides pending filePath="/assets/shot.png" />
		</div>,
	);
	try {
		const sides = utils.getByTestId("diff-sides");
		expect(sides).toHaveAttribute("data-atelier-diff-pending");
		expect(sides).toHaveAttribute("aria-busy", "true");
		const before = screen.getByRole("region", { name: "Before: shot.png" });
		const after = screen.getByRole("region", { name: "After: shot.png" });
		expect(before).toHaveTextContent("Before");
		expect(after).toHaveTextContent("After");
		// Neither the absent-file notice nor a spinner: the frame waits quietly.
		expect(
			sides.querySelector("[data-attr='checkpoint-absent-file']"),
		).toBeNull();
		expect(screen.queryByRole("status")).toBeNull();
	} finally {
		utils.unmount();
	}
});
