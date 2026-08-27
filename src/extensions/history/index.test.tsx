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
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { HistoryView } from ".";

function atelierStub(overrides?: {
	readonly historicalCommitId?: string;
	readonly historicalFiles?: readonly {
		readonly id: string;
		readonly path: string;
	}[];
	readonly open?: (options: {
		readonly base?: { readonly commitId: string } | null;
		readonly target: { readonly commitId: string } | { readonly working: true };
		readonly reveal?: boolean;
	}) => Promise<void>;
	readonly openFile?: (path: string) => void;
	readonly workingChangeFiles?: readonly {
		readonly id: string;
		readonly path: string;
	}[];
	readonly workingChangesActive?: boolean;
}): ExtensionRuntime {
	const session = overrides?.workingChangesActive
		? {
				base: null,
				target: { working: true as const },
				files: (overrides?.workingChangeFiles ?? []).map((file) => ({
					...file,
					changeKind: "modified" as const,
				})),
				activePath: null,
				capabilities: { checkpoint: true, undo: true, restore: false },
			}
		: overrides?.historicalCommitId
			? {
					base: null,
					target: { commitId: overrides.historicalCommitId },
					files: (overrides?.historicalFiles ?? []).map((file) => ({
						...file,
						changeKind: "modified" as const,
					})),
					activePath: null,
					capabilities: { checkpoint: false, undo: false, restore: true },
				}
			: null;
	return {
		icons: {
			fileUrl: () =>
				"data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
		},
		diff: {
			session,
			open: overrides?.open ?? (async () => {}),
			openFile: overrides?.openFile ?? (() => {}),
			exit: () => {},
			accept: async () => {},
			reject: async () => {},
			autoAccept: false,
		},
		reviews: {
			resolvedReviewIds: [],
		},
	} as unknown as ExtensionRuntime;
}

describe("HistoryView", () => {
	test("lists files while working changes is active", async () => {
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3), ($4, $5, $6)",
			[
				fakeUuid("working-file-one"),
				"/docs/one.md",
				new TextEncoder().encode("before one"),
				fakeUuid("working-file-two"),
				"/two.md",
				new TextEncoder().encode("before two"),
			],
		);
		await createCheckpoint(lix);
		await lix.execute("UPDATE lix_file SET content = $1", [
			new TextEncoder().encode("after"),
		]);
		const openFile = vi.fn();
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
								openFile,
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
		expect(openFile).toHaveBeenCalledWith("/two.md");

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("lists workspace moments and opens a checkpoint on click", async () => {
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3), ($4, $5, $6)",
			[
				fakeUuid("history-file-one"),
				"/one.txt",
				new TextEncoder().encode("one"),
				fakeUuid("history-file-two"),
				"/two.txt",
				new TextEncoder().encode("two"),
			],
		);
		const checkpoint = await createCheckpoint(lix);
		const originalExecute = lix.execute.bind(lix);
		let coldHistoryReads = 0;
		vi.spyOn(lix, "execute").mockImplementation(
			async (...args: Parameters<typeof lix.execute>) => {
				if (String(args[0]).toLowerCase().includes("lix_file_history")) {
					coldHistoryReads += 1;
				}
				return originalExecute(...args);
			},
		);
		const open = vi.fn(async () => {});
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<HistoryView atelier={atelierStub({ open })} />
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
		const checkpointItems =
			await within(checkpointList).findAllByRole("listitem");
		expect(checkpointItems).toHaveLength(2);
		expect(within(checkpointList).getByText("Latest checkpoint")).toBeVisible();
		expect(
			within(checkpointList).getByText("Initial checkpoint"),
		).toBeVisible();
		expect(within(checkpointItems[0]!).getByText(/ago|now/)).toBeVisible();
		expect(coldHistoryReads).toBe(0);
		// Nothing is viewed yet, so no row is current and no file list shows.
		expect(checkpointItems[0]).not.toHaveAttribute("aria-current");
		expect(
			screen.queryByRole("list", { name: "Files at this checkpoint" }),
		).toBeNull();

		// A checkpoint that is not being viewed opens on click.
		fireEvent.click(
			within(checkpointItems[0]!).getByRole("button", {
				name: /Latest checkpoint/,
			}),
		);
		expect(open).toHaveBeenCalledWith({
			base: { commitId: expect.any(String) },
			target: { commitId: checkpoint.commitId },
		});

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("opens a checkpoint file without collapsing the checkpoint", async () => {
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3), ($4, $5, $6)",
			[
				fakeUuid("history-file-one"),
				"/docs/one.txt",
				new TextEncoder().encode("one"),
				fakeUuid("history-file-two"),
				"/two.txt",
				new TextEncoder().encode("two"),
			],
		);
		const checkpoint = await createCheckpoint(lix);
		const historicalFiles = [
			{ id: fakeUuid("history-file-one"), path: "/docs/one.txt" },
			{ id: fakeUuid("history-file-two"), path: "/two.txt" },
		];
		const openFile = vi.fn();
		const open = vi.fn(async () => {});
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<HistoryView
							atelier={atelierStub({
								historicalCommitId: checkpoint.commitId,
								historicalFiles,
								openFile,
								open,
							})}
						/>
					</Suspense>
				</LixProvider>,
			);
		});

		const checkpointList = await screen.findByRole("list", {
			name: "Checkpoints",
		});
		const checkpointItems =
			await within(checkpointList).findAllByRole("listitem");
		expect(checkpointItems[0]).toHaveAttribute("aria-current", "true");
		const checkpointDisclosures = checkpointList.querySelectorAll(
			"[data-attr='history-disclosure']",
		);
		expect(checkpointDisclosures[0]).toHaveAttribute("data-state", "open");
		expect(checkpointDisclosures[1]).toHaveAttribute("data-state", "closed");

		const fileList = await screen.findByRole("list", {
			name: "Files at this checkpoint",
		});
		const fileButtons = within(fileList).getAllByRole("button");
		expect(fileButtons.map((button) => button.textContent)).toEqual([
			"one.txt",
			"two.txt",
		]);
		fireEvent.click(fileButtons[1]!);
		expect(openFile).toHaveBeenCalledWith("/two.txt");
		expect(open).not.toHaveBeenCalled();
		expect(checkpointItems[0]).toHaveAttribute("aria-current", "true");
		expect(checkpointDisclosures[0]).toHaveAttribute("data-state", "open");

		// The viewed checkpoint toggles: pressing it again leaves review mode
		// instead of re-opening the same session.
		fireEvent.click(
			within(checkpointItems[0]!).getByRole("button", {
				name: /Latest checkpoint/,
			}),
		);
		expect(open).not.toHaveBeenCalled();

		await act(async () => view?.unmount());
		await lix.close();
	});

	test("switches checkpoint file lists without another history query", async () => {
		const lix = await openLix();
		const fileId = fakeUuid("history-switch-file");
		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
			[fileId, "/switch.txt", new TextEncoder().encode("older")],
		);
		const olderCheckpoint = await createCheckpoint(lix);
		await lix.execute("UPDATE lix_file SET content = $1 WHERE id = $2", [
			new TextEncoder().encode("newer"),
			fileId,
		]);
		const newerCheckpoint = await createCheckpoint(lix);
		const olderHistoricalFiles = [{ id: fileId, path: "/older-switch.txt" }];
		const newerHistoricalFiles = [{ id: fileId, path: "/newer-switch.txt" }];
		const originalExecute = lix.execute.bind(lix);
		let historyReads = 0;
		vi.spyOn(lix, "execute").mockImplementation(
			async (...args: Parameters<typeof lix.execute>) => {
				if (String(args[0]).includes("lix_history('lix_file'")) {
					historyReads += 1;
				}
				return originalExecute(...args);
			},
		);
		let view: ReturnType<typeof render> | undefined;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<Suspense fallback={<div data-testid="history-root-loading" />}>
						<HistoryView
							atelier={atelierStub({
								historicalCommitId: olderCheckpoint.commitId,
								historicalFiles: olderHistoricalFiles,
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
		expect(screen.getByText("older-switch.txt")).toBeVisible();

		await act(async () => {
			view?.rerender(
				<LixProvider lix={lix}>
					<Suspense fallback={<div data-testid="history-root-loading" />}>
						<HistoryView
							atelier={atelierStub({
								historicalCommitId: newerCheckpoint.commitId,
								historicalFiles: newerHistoricalFiles,
							})}
						/>
					</Suspense>
				</LixProvider>,
			);
		});
		expect(
			screen.getByRole("region", { name: "Checkpoint history" }),
		).toBeVisible();
		expect(screen.queryByTestId("history-root-loading")).toBeNull();
		expect(
			screen.getByRole("list", { name: "Files at this checkpoint" }),
		).toBeVisible();
		expect(screen.getByText("newer-switch.txt")).toBeVisible();
		// The outgoing list stays mounted while its disclosure folds away.
		await waitFor(() => {
			expect(screen.queryByText("older-switch.txt")).toBeNull();
		});
		expect(historyReads).toBe(0);

		await act(async () => view?.unmount());
		await lix.close();
	});
});
