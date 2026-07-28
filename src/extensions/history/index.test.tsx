import { Suspense } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ExtensionRuntime } from "@/extension-runtime/types";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { HistoryView } from ".";

function atelierStub(overrides?: {
	readonly historicalCommitId?: string;
	readonly viewCheckpoint?: (args: {
		readonly commitId: string;
		readonly createdAt: string;
	}) => Promise<void>;
	readonly openCheckpointFile?: (path: string) => void;
	readonly openWorkingChanges?: () => void;
}): ExtensionRuntime {
	return {
		reviews: {
			resolvedReviewIds: [],
			viewCheckpoint: overrides?.viewCheckpoint ?? (async () => {}),
			openCheckpointFile: overrides?.openCheckpointFile ?? (() => {}),
			openWorkingChanges: overrides?.openWorkingChanges ?? (() => {}),
			...(overrides?.historicalCommitId
				? { historicalCommitId: overrides.historicalCommitId }
				: {}),
		},
	} as unknown as ExtensionRuntime;
}

describe("HistoryView", () => {
	test("lists workspace moments and opens a checkpoint on click", async () => {
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
		const viewCheckpoint = vi.fn(async () => {});
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<HistoryView atelier={atelierStub({ viewCheckpoint })} />
					</Suspense>
				</LixProvider>,
			);
		});

		// Working changes leads the list; sealed workspace reads as quiet "now".
		const workingChanges = await screen.findByRole("button", {
			name: /Working changes/,
		});
		expect(workingChanges).toBeDisabled();
		expect(screen.getByText("now · nothing new")).toBeVisible();

		const checkpointList = await screen.findByRole("list", {
			name: "Checkpoints",
		});
		const checkpointItems = within(checkpointList).getAllByRole("listitem");
		expect(checkpointItems).toHaveLength(2);
		expect(within(checkpointList).getByText("Latest checkpoint")).toBeVisible();
		expect(
			within(checkpointList).getByText("Initial checkpoint"),
		).toBeVisible();
		expect(within(checkpointItems[0]!).getByText("2 files")).toBeVisible();
		expect(within(checkpointItems[1]!).getByText("0 files")).toBeVisible();
		// Nothing is viewed yet, so no row is current and no file list shows.
		expect(checkpointItems[0]).not.toHaveAttribute("aria-current");
		expect(
			screen.queryByRole("list", { name: "Files at this checkpoint" }),
		).toBeNull();

		fireEvent.click(
			within(checkpointItems[0]!).getByRole("button", {
				name: /Latest checkpoint/,
			}),
		);
		expect(viewCheckpoint).toHaveBeenCalledWith({
			commitId: checkpoint.commitId,
			createdAt: expect.any(String),
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("marks the viewed checkpoint and lists its files", async () => {
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, data) VALUES ($1, $2, $3), ($4, $5, $6)",
			[
				fakeUuid("history-file-one"),
				"/docs/one.txt",
				new TextEncoder().encode("one"),
				fakeUuid("history-file-two"),
				"/two.txt",
				new TextEncoder().encode("two"),
			],
		);
		const checkpoint = await lix.createCheckpoint();
		const openCheckpointFile = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<HistoryView
							atelier={atelierStub({
								historicalCommitId: checkpoint.commitId,
								openCheckpointFile,
							})}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const checkpointList = await screen.findByRole("list", {
			name: "Checkpoints",
		});
		const checkpointItems = within(checkpointList).getAllByRole("listitem");
		expect(checkpointItems[0]).toHaveAttribute("aria-current", "true");

		const fileList = await screen.findByRole("list", {
			name: "Files at this checkpoint",
		});
		const fileButtons = within(fileList).getAllByRole("button");
		expect(fileButtons.map((button) => button.textContent)).toEqual([
			"one.txt",
			"two.txt",
		]);
		fireEvent.click(fileButtons[1]!);
		expect(openCheckpointFile).toHaveBeenCalledWith("/two.txt");

		await act(async () => view?.unmount());
		await lix.close();
	});
});
