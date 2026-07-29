import { Suspense } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
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
		readonly previousCommitId: string;
		readonly createdAt: string;
	}) => Promise<void>;
	readonly openCheckpointFile?: (path: string) => void;
	readonly openWorkingChanges?: () => void;
	readonly workingChangeFiles?: readonly {
		readonly id: string;
		readonly path: string;
	}[];
	readonly openWorkingChangeFile?: (path: string) => void;
	readonly workingChangesActive?: boolean;
}): ExtensionRuntime {
	return {
		icons: {
			fileUrl: () =>
				"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
		},
		reviews: {
			resolvedReviewIds: [],
			viewCheckpoint: overrides?.viewCheckpoint ?? (async () => {}),
			openCheckpointFile: overrides?.openCheckpointFile ?? (() => {}),
			openWorkingChanges: overrides?.openWorkingChanges ?? (() => {}),
			workingChangeFiles: overrides?.workingChangeFiles ?? [],
			openWorkingChangeFile: overrides?.openWorkingChangeFile ?? (() => {}),
			...(overrides?.workingChangesActive
				? { active: true, mode: "working-changes" as const }
				: {}),
			...(overrides?.historicalCommitId
				? { historicalCommitId: overrides.historicalCommitId }
				: {}),
		},
	} as unknown as ExtensionRuntime;
}

describe("HistoryView", () => {
	test("lists files while working changes is active", async () => {
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, data) VALUES ($1, $2, $3), ($4, $5, $6)",
			[
				fakeUuid("working-file-one"),
				"/docs/one.md",
				new TextEncoder().encode("before one"),
				fakeUuid("working-file-two"),
				"/two.md",
				new TextEncoder().encode("before two"),
			],
		);
		await lix.createCheckpoint();
		await lix.execute("UPDATE lix_file SET data = $1", [
			new TextEncoder().encode("after"),
		]);
		const openWorkingChangeFile = vi.fn();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<HistoryView
							atelier={atelierStub({
								workingChangesActive: true,
								workingChangeFiles: [
									{ id: fakeUuid("working-file-one"), path: "/docs/one.md" },
									{ id: fakeUuid("working-file-two"), path: "/two.md" },
								],
								openWorkingChangeFile,
							})}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const fileList = await screen.findByRole("list", {
			name: "Files in working changes",
		});
		const fileButtons = within(fileList).getAllByRole("button");
		expect(fileButtons.map((button) => button.textContent)).toEqual([
			"one.md",
			"two.md",
		]);
		fireEvent.click(fileButtons[1]!);
		expect(openWorkingChangeFile).toHaveBeenCalledWith("/two.md");

		await act(async () => view?.unmount());
		await lix.close();
	});

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
			previousCommitId: expect.any(String),
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

	test("keeps the history timeline visible while a new checkpoint file list loads", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("history-switch-file");
		await lix.execute(
			"INSERT INTO lix_file (id, path, data) VALUES ($1, $2, $3)",
			[fileId, "/switch.txt", new TextEncoder().encode("older")],
		);
		const olderCheckpoint = await lix.createCheckpoint();
		await lix.execute("UPDATE lix_file SET data = $1 WHERE id = $2", [
			new TextEncoder().encode("newer"),
			fileId,
		]);
		const newerCheckpoint = await lix.createCheckpoint();
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={<div data-testid="history-root-loading" />}>
						<HistoryView
							atelier={atelierStub({
								historicalCommitId: olderCheckpoint.commitId,
							})}
						/>
					</Suspense>
				</LixProvider>,
			);
		});
		expect(
			await screen.findByRole("region", { name: "Checkpoint history" }),
		).toBeVisible();
		expect(
			await screen.findByRole("list", { name: "Files at this checkpoint" }),
		).toBeVisible();

		let releaseFileListQuery!: () => void;
		const fileListQueryGate = new Promise<void>((resolve) => {
			releaseFileListQuery = resolve;
		});
		const originalExecute = lix.execute.bind(lix);
		let delayedFileListQuery = false;
		vi.spyOn(lix, "execute").mockImplementation(
			async (...args: Parameters<typeof lix.execute>) => {
				const statement = String(args[0]).toLowerCase();
				const parameters = args[1] as readonly unknown[] | undefined;
				if (
					!delayedFileListQuery &&
					statement.includes("lix_file_history") &&
					parameters?.includes(newerCheckpoint.commitId)
				) {
					delayedFileListQuery = true;
					await fileListQueryGate;
				}
				return originalExecute(...args);
			},
		);

		await act(async () => {
			view?.rerender(
				<LixProvider lix={lix}>
					<Suspense fallback={<div data-testid="history-root-loading" />}>
						<HistoryView
							atelier={atelierStub({
								historicalCommitId: newerCheckpoint.commitId,
							})}
						/>
					</Suspense>
				</LixProvider>,
			);
		});
		await waitFor(() => expect(delayedFileListQuery).toBe(true));
		expect(
			screen.getByRole("region", { name: "Checkpoint history" }),
		).toBeVisible();
		expect(screen.queryByTestId("history-root-loading")).toBeNull();
		expect(
			document.querySelector(
				"[data-attr='history-checkpoint-files-loading']",
			),
		).not.toBeNull();

		await act(async () => releaseFileListQuery());
		expect(
			await screen.findByRole("list", { name: "Files at this checkpoint" }),
		).toBeVisible();

		await act(async () => view?.unmount());
		await lix.close();
	});
});
