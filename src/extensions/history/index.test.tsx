import { Suspense } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
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
	readonly checkpointAll?: () => Promise<void>;
	readonly readOnly?: boolean;
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
		readOnly: overrides?.readOnly ?? false,
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
			checkpointAll: overrides?.checkpointAll ?? (async () => {}),
			autoAccept: false,
		},
		reviews: {
			resolvedReviewIds: [],
		},
	} as unknown as ExtensionRuntime;
}

// Drive container size independently of the browser viewport.
function mockHistoryWidth() {
	let resize: (width: number) => void = () => {};
	vi.stubGlobal(
		"ResizeObserver",
		class {
			constructor(callback: ResizeObserverCallback) {
				resize = (width) =>
					callback(
						[{ contentRect: { width } } as ResizeObserverEntry],
						this as unknown as ResizeObserver,
					);
			}
			observe() {}
			disconnect() {}
		},
	);
	return (width: number) => act(() => resize(width));
}

describe("HistoryView", () => {
	afterEach(() => vi.unstubAllGlobals());

	test("shows working changes after edits and removes the row after checkpointing", async () => {
		const lix = await openLix();
		const view = render(
			<LixProvider lix={lix}>
				<HistoryView atelier={atelierStub()} />
			</LixProvider>,
		);
		await screen.findByText("Initial checkpoint");
		expect(
			screen.queryByRole("button", { name: "Working changes" }),
		).toBeNull();
		await act(async () => {
			await lix.execute(
				"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
				[
					fakeUuid("live-history"),
					"/live.md",
					new TextEncoder().encode("edited"),
				],
			);
		});
		expect(
			await screen.findByRole("button", { name: "Working changes" }),
		).toBeEnabled();
		await act(async () => {
			await createCheckpoint(lix);
		});
		await waitFor(() =>
			expect(
				screen.queryByRole("button", { name: "Working changes" }),
			).toBeNull(),
		);
		expect(screen.getByText("Latest checkpoint")).toBeVisible();
		view.unmount();
		await lix.close();
	});

	test("previews checkpoint and working files before selection only when the panel is wide", async () => {
		const resize = mockHistoryWidth();
		// No intersection API means render all rows (e.g. non-browser hosts).
		vi.stubGlobal("IntersectionObserver", undefined);
		const lix = await openLix();
		const fileIds = ["wide-a", "wide-b", "wide-c"].map(fakeUuid);
		for (const [index, name] of [
			"alpha.md",
			"beta.csv",
			"gamma.txt",
		].entries()) {
			await lix.execute(
				"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
				[fileIds[index], `/${name}`, new TextEncoder().encode("before")],
			);
		}
		const checkpoint = await createCheckpoint(lix);
		await lix.execute("UPDATE lix_file SET content = $1 WHERE id = $2", [
			new TextEncoder().encode("after"),
			fileIds[2],
		]);
		const execute = vi.spyOn(lix, "execute");
		const open = vi.fn(async () => {});
		const view = render(
			<LixProvider lix={lix}>
				<HistoryView atelier={atelierStub({ open })} />
			</LixProvider>,
		);
		const latest = await screen.findByRole("button", {
			name: /Latest checkpoint/,
		});
		const historyReads = () =>
			execute.mock.calls.filter(
				([sql]) =>
					String(sql).includes("lix_diff('lix_file',") ||
					String(sql).includes("lix_state_at("),
			);
		expect(historyReads()).toHaveLength(0);
		expect(within(latest).queryByText("alpha.md")).toBeNull();
		resize(900);
		expect(await within(latest).findByText("alpha.md")).toBeVisible();
		expect(within(latest).getByText("beta.csv")).toBeVisible();
		expect(within(latest).getByText("+1")).toBeVisible();
		expect(latest).not.toHaveAccessibleName(/Changed files/);
		expect(latest).toHaveAccessibleDescription(
			"Changed files: /alpha.md, /beta.csv, /gamma.txt",
		);
		const working = screen.getByRole("button", { name: "Working changes" });
		expect(await within(working).findByText("gamma.txt")).toBeVisible();
		expect(working).toHaveAccessibleDescription("Changed files: /gamma.txt");
		expect(open).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("list", { name: "Files at this checkpoint" }),
		).toBeNull();
		fireEvent.click(within(latest).getByText("alpha.md"));
		expect(open).toHaveBeenCalledWith({
			base: { commitId: expect.any(String) },
			target: { commitId: checkpoint.commitId },
		});
		resize(320);
		expect(within(latest).queryByText("alpha.md")).toBeNull();
		expect(
			screen.getByRole("region", { name: "Checkpoint history" }),
		).toHaveAttribute("data-layout", "compact");
		view.unmount();
		await lix.close();
	});

	test("defers checkpoint preview reads until a wide row approaches the viewport", async () => {
		const resize = mockHistoryWidth();
		const intersections: Array<{
			target: Element;
			callback: IntersectionObserverCallback;
		}> = [];
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				constructor(private callback: IntersectionObserverCallback) {}
				observe(target: Element) {
					intersections.push({ target, callback: this.callback });
				}
				disconnect() {}
			},
		);
		const lix = await openLix();
		await lix.execute(
			"INSERT INTO lix_file (id, path, content) VALUES ($1, $2, $3)",
			[
				fakeUuid("viewport-history"),
				"/visible.md",
				new TextEncoder().encode("before"),
			],
		);
		await createCheckpoint(lix);
		const execute = vi.spyOn(lix, "execute");
		const view = render(
			<LixProvider lix={lix}>
				<HistoryView atelier={atelierStub()} />
			</LixProvider>,
		);
		const latest = await screen.findByRole("button", {
			name: /Latest checkpoint/,
		});
		resize(660);
		await waitFor(() => expect(intersections.length).toBe(2));
		const historicalReads = () =>
			execute.mock.calls.filter(
				([sql]) =>
					String(sql).includes("lix_diff('lix_file',") ||
					String(sql).includes("lix_state_at("),
			);
		expect(historicalReads()).toHaveLength(0);
		const observed = intersections.find(({ target }) =>
			latest.contains(target),
		)!;
		act(() =>
			observed.callback(
				[
					{
						isIntersecting: true,
						target: observed.target,
					} as IntersectionObserverEntry,
				],
				{} as IntersectionObserver,
			),
		);
		expect(await within(latest).findByText("visible.md")).toBeVisible();
		expect(historicalReads()).toHaveLength(1);
		view.unmount();
		await lix.close();
	});

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

		const checkpointList = await screen.findByRole("list", {
			name: "Checkpoints",
		});
		const checkpointItems =
			await within(checkpointList).findAllByRole("listitem");
		expect(checkpointItems).toHaveLength(2);
		expect(
			screen.queryByRole("button", { name: "Working changes" }),
		).toBeNull();
		expect(screen.queryByText("now · nothing new")).toBeNull();
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
