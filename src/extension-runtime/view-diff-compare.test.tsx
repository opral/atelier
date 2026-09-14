import { Suspense } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { FileCode2 } from "lucide-react";
import type { AtelierDiffSession } from "../extension-api";
import { LixProvider } from "../lib/lix-react";
import { openLix } from "../test-utils/node-lix-sdk";
import type { ExtensionDefinition } from "./types";
import {
	ViewDiffCompare,
	viewDiffSideState,
	viewDiffSides,
} from "./view-diff-compare";

const view: ExtensionDefinition = {
	kind: "atelier_image",
	label: "Image",
	description: "Show an image.",
	icon: FileCode2,
};

function workingSession(
	changeKind: "added" | "modified" | "removed",
): AtelierDiffSession {
	return {
		base: { commitId: "commit_before" },
		target: { working: true },
		files: [
			{
				id: "file_1",
				path: "/shot.png",
				changeKind,
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
}

describe("viewDiffSides", () => {
	test("a view that renders its own diff is left alone", () => {
		expect(
			viewDiffSides({
				definition: { ...view, diff: true },
				session: workingSession("modified"),
				state: { fileId: "file_1", filePath: "/shot.png" },
			}),
		).toBeNull();
	});

	test("a file under review has both of the review's commits", () => {
		expect(
			viewDiffSides({
				definition: view,
				session: workingSession("modified"),
				state: { fileId: "file_1", filePath: "/shot.png" },
			}),
		).toEqual({
			path: "/shot.png",
			before: { commitId: "commit_before", exists: true },
			after: { commitId: "commit_after", exists: true },
		});
	});

	test.each([
		["added", "before"],
		["removed", "after"],
	] as const)("a %s file has no %s side", (changeKind, missing) => {
		const sides = viewDiffSides({
			definition: view,
			session: workingSession(changeKind),
			state: { fileId: "file_1", filePath: "/shot.png" },
		})!;
		expect(sides[missing].exists).toBe(false);
		// The commit is still known: it names the checkpoint the file is
		// missing from.
		expect(sides[missing].commitId).not.toBeNull();
		expect(sides[missing === "before" ? "after" : "before"].exists).toBe(true);
	});

	test("a checkpoint's span is two sides without a session", () => {
		expect(
			viewDiffSides({
				definition: view,
				session: null,
				state: {
					fileId: "file_1",
					filePath: "/shot.png",
					beforeCommitId: "commit_before",
					afterCommitId: "commit_after",
					sourceCommitId: "commit_after",
				},
			}),
		).toMatchObject({
			before: { commitId: "commit_before" },
			after: { commitId: "commit_after" },
		});
	});

	test("one side is no comparison", () => {
		expect(
			viewDiffSides({
				definition: view,
				session: null,
				state: { fileId: "file_1", filePath: "/shot.png" },
			}),
		).toBeNull();
		expect(
			viewDiffSides({
				definition: view,
				session: workingSession("modified"),
				state: { scope: "branch" },
			}),
		).toBeNull();
	});

	test("a resolved review is not under review any more", () => {
		const session = workingSession("modified");
		expect(
			viewDiffSides({
				definition: view,
				session: {
					...session,
					files: [
						{
							...session.files[0]!,
							review: { id: "review_1", status: "resolved" },
						},
					],
				},
				state: { fileId: "file_1", filePath: "/shot.png" },
			}),
		).toBeNull();
	});
});

test("a pane's state pins one commit and carries no second side", () => {
	expect(
		viewDiffSideState({
			state: {
				fileId: "file_1",
				filePath: "/shot.png",
				beforeCommitId: "commit_before",
				afterCommitId: "commit_after",
				beforeExists: false,
				afterExists: true,
				scrollTop: 40,
			},
			path: "/shot.png",
			commitId: "commit_before",
		}),
	).toEqual({
		fileId: "file_1",
		filePath: "/shot.png",
		sourceCommitId: "commit_before",
		scrollTop: 40,
	});
});

test("an absent side says so instead of rendering the view", async () => {
	const lix = await openLix();
	try {
		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<ViewDiffCompare
							sides={{
								path: "/shot.png",
								before: { commitId: "commit_before", exists: false },
								after: { commitId: "commit_after", exists: true },
							}}
							renderSide={({ key, commitId }) => (
								<div data-testid={`pane:${key}`}>{commitId}</div>
							)}
						/>
					</Suspense>
				</LixProvider>,
			);
		});
		expect(await screen.findByTestId("pane:after")).toHaveTextContent(
			"commit_after",
		);
		expect(screen.queryByTestId("pane:before")).toBeNull();
		expect(
			utils!.container.querySelector("[data-attr='checkpoint-absent-file']"),
		).not.toBeNull();
		// The panes are labelled, so a reader can tell the sides apart.
		expect(
			screen.getByRole("region", { name: "Before: shot.png" }),
		).toHaveTextContent("Before");
		expect(
			screen.getByRole("region", { name: "After: shot.png" }),
		).toBeTruthy();
		utils!.unmount();
	} finally {
		await lix.close();
	}
});
