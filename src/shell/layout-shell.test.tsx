import { StrictMode, Suspense } from "react";
import { describe, expect, test, vi } from "vitest";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { qb } from "@/lib/lix-kysely";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	createCheckpointAfterPendingWrites,
	flushPendingWriteHandlers,
	flushRetryablePendingWriteHandlers,
	resolveLixFileForOpen,
	selectCheckpointFiles,
	startRetryablePendingWriteHandler,
	syncPanelGroupLayout,
	V2LayoutShell,
} from "./layout-shell";
import {
	fileExtensionInstanceForKind,
	FILES_EXTENSION_KIND,
	HISTORY_EXTENSION_KIND,
} from "@/extension-runtime/extension-instance-helpers";
import { DEFAULT_ATELIER_UI_STATE } from "./ui-state";
import { createAtelier } from "../atelier-instance";
import {
	appendAgentTurnCommitRange,
	readAgentTurnCommitRanges,
} from "./agent-turn-review-range";
import {
	createMemoryPreferencesStore,
	createMemoryReviewStatusStore,
	createMemorySessionStateStore,
} from "../state-adapters";
import { fakeUuid } from "@/test-utils/fake-uuid";
import type { AtelierEvent } from "@/extension-api";
import { selectFileWorkingChanges } from "@/queries";

const ASYNC_UI_TIMEOUT = 10_000;

test("pending editor writes form a barrier before checkpoint preparation", async () => {
	let releaseWrite!: () => void;
	const writeGate = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});
	const handler = vi.fn(() => writeGate);
	let barrierCompleted = false;
	const barrier = flushPendingWriteHandlers([
		{
			panelSide: "central",
			viewInstance: "markdown-1",
			handler,
		},
	]).then(() => {
		barrierCompleted = true;
	});

	await waitFor(() => expect(handler).toHaveBeenCalledOnce());
	expect(barrierCompleted).toBe(false);
	releaseWrite();
	await barrier;
	expect(barrierCompleted).toBe(true);
});

test("a retired editor write is retried until it flushes successfully", async () => {
	const registration = {
		panelSide: "central" as const,
		viewInstance: "markdown-retired",
		handler: vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("transient write failure"))
			.mockResolvedValueOnce(),
	};
	const retired = {
		registrations: new Set([registration]),
		inFlight: new Map<typeof registration, Promise<void>>(),
	};

	await expect(
		startRetryablePendingWriteHandler(retired, registration),
	).rejects.toThrow("transient write failure");
	expect(retired.registrations.has(registration)).toBe(true);
	await flushRetryablePendingWriteHandlers(retired);

	expect(registration.handler).toHaveBeenCalledTimes(2);
	expect(retired.registrations.has(registration)).toBe(false);
});

test("checkpoint creation waits for editor persistence and includes its write", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("checkpoint-persistence-barrier");
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/checkpoint-persistence-barrier.md",
				content: new TextEncoder().encode("before"),
			})
			.execute();
		await lix.createCheckpoint();

		let releaseWrite!: () => void;
		const writeGate = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		const execute = vi.spyOn(lix, "execute");
		const checkpoint = createCheckpointAfterPendingWrites({
			lix,
			selectedFileIds: [fileId],
			flushPendingWrites: async () => {
				await writeGate;
				await qb(lix)
					.updateTable("lix_file")
					.set({ content: new TextEncoder().encode("after") })
					.where("id", "=", fileId)
					.execute();
			},
		});

		await Promise.resolve();
		expect(
			execute.mock.calls.some(([statement]) =>
				String(statement).includes("INSERT INTO lix_create_checkpoint"),
			),
		).toBe(false);
		releaseWrite();
		expect(await checkpoint).toEqual(
			expect.objectContaining({ commitId: expect.any(String) }),
		);
		expect(
			execute.mock.calls.filter(([statement]) =>
				String(statement).includes("INSERT INTO lix_create_checkpoint"),
			),
		).toHaveLength(1);
		const remaining = await lix.execute(
			"SELECT count(*) AS count FROM lix_working_diff()",
		);
		expect(Number(remaining.rows[0]?.get("count") ?? -1)).toBe(0);
	} finally {
		await lix.close();
	}
});

test("checkpoint creation leaves a later unselected file edit working", async () => {
	const lix = await openLix();
	const selectedFileId = fakeUuid("checkpoint-frozen-selected");
	const laterFileId = fakeUuid("checkpoint-frozen-later");
	try {
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: selectedFileId,
					path: "/checkpoint-frozen-selected.md",
					content: new TextEncoder().encode("selected before"),
				},
				{
					id: laterFileId,
					path: "/checkpoint-frozen-later.md",
					content: new TextEncoder().encode("later before"),
				},
			])
			.execute();
		await lix.createCheckpoint();
		await qb(lix)
			.updateTable("lix_file")
			.set({ content: new TextEncoder().encode("selected after") })
			.where("id", "=", selectedFileId)
			.execute();

		await createCheckpointAfterPendingWrites({
			lix,
			selectedFileIds: [selectedFileId],
			flushPendingWrites: async () => {
				await qb(lix)
					.updateTable("lix_file")
					.set({ content: new TextEncoder().encode("later after") })
					.where("id", "=", laterFileId)
					.execute();
			},
		});

		expect(await selectFileWorkingChanges(lix).execute()).toEqual([
			expect.objectContaining({ id: laterFileId }),
		]);
	} finally {
		await lix.close();
	}
});

describe("resolveLixFileForOpen", () => {
	test("resolves normalized paths from Lix", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("readme"),
				path: "/docs/README.md",
				content: new TextEncoder().encode("# README\n"),
			})
			.execute();

		await expect(
			resolveLixFileForOpen({ lix, filePath: "docs/./README.md" }),
		).resolves.toEqual({ id: fakeUuid("readme"), path: "/docs/README.md" });
		await lix.close();
	});

	test("does not import files that are absent from Lix", async () => {
		const lix = await openLix();
		await expect(
			resolveLixFileForOpen({ lix, filePath: "/missing.md" }),
		).resolves.toBeNull();
		await lix.close();
	});
});

describe("syncPanelGroupLayout", () => {
	test("applies a remote canonical layout only when it differs", () => {
		const group = {
			getLayout: vi.fn(() => ({ left: 20, central: 60, right: 20 })),
			setLayout: vi.fn((layout: Record<string, number>) => layout),
		};

		expect(
			syncPanelGroupLayout(group, { left: 20, central: 60, right: 20 }),
		).toBe(false);
		expect(group.setLayout).not.toHaveBeenCalled();

		group.getLayout.mockReturnValue({ left: 0, central: 100, right: 0 });
		const remoteLayout = { left: 25, central: 50, right: 25 };
		expect(syncPanelGroupLayout(group, remoteLayout)).toBe(true);
		expect(group.setLayout).toHaveBeenCalledWith(remoteLayout);
	});
});

describe("extension menu preferences", () => {
	test("shares the Files hidden-file toggle between the sidebar and central tab", async () => {
		const lix = await openLix();
		const preferencesStore = createMemoryPreferencesStore();
		const atelier = createAtelier({ lix, preferencesStore });
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: fakeUuid("visible-file"),
					path: "/visible.md",
					content: new TextEncoder().encode("# Visible\n"),
				},
				{
					id: fakeUuid("hidden-file"),
					path: "/.lix/config.json",
					content: new TextEncoder().encode('{"hidden":true}'),
				},
			])
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		try {
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			await findFilesTreeItem("visible.md");
			const treeContains = (path: string) =>
				screen
					.getAllByLabelText("Files")
					.filter((candidate) => candidate.shadowRoot)
					.some((host) =>
						host.shadowRoot?.querySelector(
							`[data-type='item'][data-item-path='${CSS.escape(path)}']`,
						),
					);
			expect(treeContains(".lix/")).toBe(false);

			fireEvent.pointerDown(
				screen.getByRole("button", { name: "Files panel view menu" }),
				{ button: 0 },
			);
			const sidebarToggle = await screen.findByRole("menuitemcheckbox", {
				name: "Show hidden files",
			});
			expect(sidebarToggle).toHaveAttribute("aria-checked", "false");
			expect(sidebarToggle.querySelector(".lucide-eye")).not.toBeNull();
			fireEvent.click(sidebarToggle);
			await waitFor(() => expect(treeContains(".lix/")).toBe(true));
			await waitFor(async () => {
				expect(
					(await preferencesStore.load())?.extensions?.atelier_files
						?.showHiddenFiles,
				).toBe(true);
			});

			await act(async () => {
				await atelier.views.open(FILES_EXTENSION_KIND, {
					panel: "central",
					newTab: true,
				});
			});
			const filesTab = await waitFor(() => {
				const tab = document.querySelector<HTMLButtonElement>(
					'header [data-slot="central-tab-strip"] button[data-view-key="atelier_files"]',
				);
				if (!tab) throw new Error("central Files tab not found");
				return tab;
			});
			fireEvent.contextMenu(filesTab);
			const tabToggle = await screen.findByRole("menuitemcheckbox", {
				name: "Show hidden files",
			});
			expect(tabToggle).toHaveAttribute("aria-checked", "true");
			expect(tabToggle.querySelector(".lucide-eye")).not.toBeNull();
			expect(tabToggle.querySelector(".lucide-check")).not.toBeNull();
			fireEvent.click(tabToggle);
			await waitFor(() => expect(treeContains(".lix/")).toBe(false));
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});
});

describe("open file lifecycle", () => {
	test("opens documents as central tabs beside the sidebar Files view", async () => {
		const lix = await openLix();
		const onEvent = vi.fn();
		const sessionStateStore = createMemorySessionStateStore();
		const preferencesStore = createMemoryPreferencesStore();
		const atelier = createAtelier({
			lix,
			onEvent,
			sessionStateStore,
			preferencesStore,
		});
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: fakeUuid("one"),
					path: "/one.md",
					content: new TextEncoder().encode("# One\n"),
				},
				{
					id: fakeUuid("two"),
					path: "/two.md",
					content: new TextEncoder().encode("# Two\n"),
				},
			])
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<V2LayoutShell instance={atelier} onEvent={onEvent} />
					</Suspense>
				</LixProvider>,
			);
		});
		fireEvent.click(await findFilesTreeItem("one.md"));
		expect(await screen.findByRole("heading", { name: "One" })).toBeVisible();
		expect(onEvent).toHaveBeenCalledWith({
			type: "document_open_attempted",
			filePath: "/one.md",
			documentOrigin: "existing",
			viewKind: "atelier_file",
			supported: true,
		});
		expect(onEvent).toHaveBeenCalledWith({
			type: "document_viewed",
			filePath: "/one.md",
			documentOrigin: "existing",
			viewKind: "atelier_file",
		});
		// Files stays in the sidebar; the document is the only central view.
		await waitFor(() => {
			const value = sessionStateStore.getSnapshot();
			expect(value?.panels?.left?.views).toEqual([
				expect.objectContaining({ kind: FILES_EXTENSION_KIND }),
			]);
			expect(value?.panels?.central?.views).toEqual([
				expect.objectContaining({
					state: expect.objectContaining({ fileId: fakeUuid("one") }),
				}),
			]);
		});

		// A plain click navigates the active tab in place.
		fireEvent.click(await findFilesTreeItem("two.md"));
		expect(await screen.findByRole("heading", { name: "Two" })).toBeVisible();
		await waitFor(() => {
			const value = sessionStateStore.getSnapshot();
			expect(value?.panels?.central?.views).toEqual([
				expect.objectContaining({
					state: expect.objectContaining({ fileId: fakeUuid("two") }),
				}),
			]);
		});

		// newTab appends instead of replacing.
		await act(async () => {
			await atelier.documents.open("/one.md", { newTab: true });
		});
		await waitFor(() => {
			expect(
				sessionStateStore.getSnapshot()?.panels?.central?.views,
			).toHaveLength(2);
		});

		// Deleting every open file leaves the central empty state.
		await act(async () => {
			await qb(lix)
				.deleteFrom("lix_file")
				.where("id", "=", fakeUuid("two"))
				.execute();
		});
		await act(async () => {
			await qb(lix)
				.deleteFrom("lix_file")
				.where("id", "=", fakeUuid("one"))
				.execute();
		});
		await waitFor(() => {
			expect(screen.getByTestId("central-panel-empty-state")).toBeVisible();
			expect(sessionStateStore.getSnapshot()?.panels?.central?.views).toEqual(
				[],
			);
		});

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("shows the empty state when the last open file is deleted", async () => {
		const fileId = fakeUuid("file_generic");
		const imageKind = "atelier_image";
		const instance = fileExtensionInstanceForKind(imageKind, fileId);
		const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
			URL,
			"createObjectURL",
		);
		const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
			URL,
			"revokeObjectURL",
		);
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: () => "blob:atelier-open-file-lifecycle",
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: () => {},
		});
		const initialState = {
			...DEFAULT_ATELIER_UI_STATE,
			focusedPanel: "right" as const,
			panels: {
				...DEFAULT_ATELIER_UI_STATE.panels,
				central: {
					views: [
						{
							instance,
							kind: imageKind,
							state: { fileId, filePath: "/photo.jpeg" },
						},
					],
					activeInstance: instance,
				},
			},
			layout: { sizes: { left: 10, central: 55, right: 35 } },
		};
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore(initialState);
		const preferencesStore = createMemoryPreferencesStore({
			version: 1,
			layout: initialState.layout,
		});
		const atelier = createAtelier({
			lix,
			sessionStateStore,
			preferencesStore,
		});
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/photo.jpeg",
				content: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<Suspense fallback={null}>
						<V2LayoutShell instance={atelier} />
					</Suspense>
				</LixProvider>,
			);
		});

		expect(
			await screen.findByRole(
				"img",
				{ name: "photo.jpeg" },
				{ timeout: 5_000 },
			),
		).toBeInTheDocument();

		await act(async () => {
			await qb(lix).deleteFrom("lix_file").where("id", "=", fileId).execute();
		});

		await waitFor(() => {
			expect(screen.getByTestId("central-panel-empty-state")).toBeVisible();
			expect(screen.queryByRole("img", { name: "photo.jpeg" })).toBeNull();
		});
		await waitFor(async () => {
			const state = sessionStateStore.getSnapshot();
			expect(state?.panels.central).toEqual({
				views: [],
				activeInstance: null,
			});
			expect((await preferencesStore.load())?.layout.sizes).toEqual({
				left: 10,
				central: 55,
				right: 35,
			});
		});

		await act(async () => {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fakeUuid("next-file"),
					path: "/next.md",
					content: new TextEncoder().encode("# Next\n"),
				})
				.execute();
		});
		fireEvent.click(await findFilesTreeItem("next.md"));
		expect(await screen.findByRole("heading", { name: "Next" })).toBeVisible();
		expect(screen.getByTestId("files-view-tree-scroll")).toBeInTheDocument();

		await act(async () => {
			utils?.unmount();
		});
		await lix.close();
		if (createObjectUrlDescriptor) {
			Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
		} else {
			Reflect.deleteProperty(URL, "createObjectURL");
		}
		if (revokeObjectUrlDescriptor) {
			Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
		} else {
			Reflect.deleteProperty(URL, "revokeObjectURL");
		}
	});
});

async function findFilesTreeItem(path: string): Promise<HTMLElement> {
	return waitFor(() => {
		// The compact pinned home tab is also labeled "Files"; the tree is the
		// shadow-DOM host.
		const host = screen
			.getAllByLabelText("Files")
			.find((candidate) => candidate.shadowRoot);
		const item = host?.shadowRoot?.querySelector(
			`[data-type='item'][data-item-path='${CSS.escape(path)}']`,
		);
		if (!(item instanceof HTMLElement)) {
			throw new Error(`file tree item not found: ${path}`);
		}
		return item;
	});
}

describe("agent turn review navigation", () => {
	test("auto-opens external reviews exactly once without reopening an active-file range", async () => {
		const lix = await openLix();
		const onEvent = vi.fn();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({
			lix,
			onEvent,
			sessionStateStore,
		});
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: fakeUuid("stable-file"),
						path: "/stable.md",
						content: new TextEncoder().encode("# Stable\n"),
					},
					{
						id: fakeUuid("changed-file"),
						path: "/changed.md",
						content: new TextEncoder().encode("# Before\n"),
					},
					{
						id: fakeUuid("later-file"),
						path: "/later.md",
						content: new TextEncoder().encode("# Later before\n"),
					},
				])
				.execute();
			const beforeCommitId = await activeCommitId(lix);

			await act(async () => {
				utils = render(
					<StrictMode>
						<LixProvider lix={lix}>
							<Suspense fallback={null}>
								<V2LayoutShell instance={atelier} onEvent={onEvent} />
							</Suspense>
						</LixProvider>
					</StrictMode>,
				);
			});
			fireEvent.click(await findFilesTreeItem("stable.md"));
			await waitFor(() => {
				expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
					expect.objectContaining({
						state: expect.objectContaining({ fileId: fakeUuid("stable-file") }),
					}),
				]);
			});

			await act(async () => {
				await qb(lix)
					.updateTable("lix_file")
					.set({ content: new TextEncoder().encode("# After\n") })
					.where("id", "=", fakeUuid("changed-file"))
					.execute();
			});
			const afterCommitId = await activeCommitId(lix);

			await act(async () => {
				await appendAgentTurnCommitRange(lix, {
					id: "external-edit",
					sourceId: "mcp",
					beforeCommitId,
					afterCommitId,
					startedAt: 1,
					completedAt: 2,
				});
			});

			await waitFor(() => {
				expect(
					sessionStateStore
						.getSnapshot()
						?.panels.central.views.some(
							(view) => view.state?.fileId === fakeUuid("changed-file"),
						),
				).toBe(true);
			});
			expect(await screen.findByRole("button", { name: "Keep" })).toBeVisible();
			await waitFor(() => {
				expect(
					onEvent.mock.calls.filter(
						([event]) =>
							event.type === "document_viewed" &&
							event.filePath === "/changed.md",
					),
				).toHaveLength(1);
			});
			await act(async () => {
				await appendAgentTurnCommitRange(lix, {
					id: "external-edit-follow-up",
					sourceId: "mcp",
					beforeCommitId,
					afterCommitId,
					startedAt: 3,
					completedAt: 4,
				});
			});
			await waitFor(async () => {
				expect(await readAgentTurnCommitRanges(lix)).toHaveLength(2);
			});
			await waitFor(() => {
				expect(
					onEvent.mock.calls
						.flatMap(([event]) =>
							event.type === "diff_opened" ? [event.reviewId] : [],
						)
						.some((reviewId) =>
							JSON.parse(reviewId)[1].includes("external-edit-follow-up"),
						),
				).toBe(true);
			});
			fireEvent.click(await findFilesTreeItem("stable.md"));
			await waitFor(() => {
				expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
					expect.objectContaining({
						state: expect.objectContaining({ fileId: fakeUuid("stable-file") }),
					}),
				]);
			});

			const beforeLaterCommitId = await activeCommitId(lix);
			await act(async () => {
				await qb(lix)
					.updateTable("lix_file")
					.set({ content: new TextEncoder().encode("# Later after\n") })
					.where("id", "=", fakeUuid("later-file"))
					.execute();
			});
			const afterLaterCommitId = await activeCommitId(lix);
			await act(async () => {
				await appendAgentTurnCommitRange(lix, {
					id: "later-range",
					sourceId: "mcp",
					beforeCommitId: beforeLaterCommitId,
					afterCommitId: afterLaterCommitId,
					startedAt: 5,
					completedAt: 6,
				});
			});
			await waitFor(() => {
				expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
					expect.objectContaining({
						state: expect.objectContaining({ fileId: fakeUuid("later-file") }),
					}),
				]);
			});
			await waitFor(() => {
				expect(
					onEvent.mock.calls
						.flatMap(([event]) =>
							event.type === "diff_opened" ? [event.reviewId] : [],
						)
						.some((reviewId) =>
							JSON.parse(reviewId)[1].includes("later-range"),
						),
				).toBe(true);
			});
			expect(
				onEvent.mock.calls.filter(
					([event]) =>
						event.type === "document_viewed" &&
						event.filePath === "/changed.md",
				),
			).toHaveLength(1);
			expect(
				onEvent.mock.calls.filter(
					([event]) =>
						event.type === "document_viewed" && event.filePath === "/later.md",
				),
			).toHaveLength(1);
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("opens checkpoint working changes without requiring agent-turn metadata", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const preferencesStore = createMemoryPreferencesStore({
			version: 1,
			layout: { sizes: { left: 20, central: 80, right: 0 } },
			review: { autoAcceptAgentChanges: true },
		});
		const atelier = createAtelier({
			lix,
			sessionStateStore,
			preferencesStore,
		});
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: fakeUuid("auto-stable-file"),
						path: "/auto-stable.md",
						content: new TextEncoder().encode("# Stable\n"),
					},
					{
						id: fakeUuid("auto-changed-file"),
						path: "/auto-changed.md",
						content: new TextEncoder().encode("# Before\n"),
					},
				])
				.execute();
			await lix.createCheckpoint();

			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			expect(
				await screen.findByRole("switch", {
					name: "Auto-accept agent changes",
				}),
			).toHaveAttribute("aria-checked", "true");
			fireEvent.click(await findFilesTreeItem("auto-changed.md"));
			await waitFor(() => {
				expect(
					sessionStateStore.getSnapshot()?.panels.central.views[0]?.state
						?.fileId,
				).toBe(fakeUuid("auto-changed-file"));
			});

			await act(async () => {
				await qb(lix)
					.updateTable("lix_file")
					.set({ content: new TextEncoder().encode("# After\n") })
					.where("id", "=", fakeUuid("auto-changed-file"))
					.execute();
			});
			await waitFor(() => {
				expect(
					screen.getByRole("button", {
						name: "1 file changed since checkpoint. Open changes review",
					}),
				).toBeVisible();
			});
			expect(
				sessionStateStore.getSnapshot()?.panels.central.views[0]?.state?.fileId,
			).toBe(fakeUuid("auto-changed-file"));
			await waitFor(() => {
				expect(
					screen.queryByRole("button", { name: /^Checkpoint/ }),
				).toBeNull();
			});
			expect(screen.queryByText("Reviewing auto-changed.md")).toBeNull();

			fireEvent.click(
				screen.getByRole("switch", {
					name: "Auto-accept agent changes",
				}),
			);
			await waitFor(() => {
				expect(
					screen.getByRole("switch", {
						name: "Auto-accept agent changes",
					}),
				).toHaveAttribute("aria-checked", "false");
			});
			await act(async () => {
				fireEvent.click(
					screen.getByRole("button", {
						name: "1 file changed since checkpoint. Open changes review",
					}),
				);
			});
			expect(
				await screen.findByRole("button", { name: /^Checkpoint/ }),
			).toBeVisible();
			const reviewFloat = document.querySelector(
				".external-write-review-actions",
			);
			expect(reviewFloat?.parentElement).toBe(
				document.querySelector("[data-review-mode='true']"),
			);
			expect(screen.queryByRole("button", { name: /^Keep/ })).toBeNull();

			fireEvent.click(
				screen.getByRole("switch", {
					name: "Auto-accept agent changes",
				}),
			);
			await waitFor(() => {
				expect(
					screen.getByRole("switch", {
						name: "Auto-accept agent changes",
					}),
				).toHaveAttribute("aria-checked", "true");
			});
			expect(
				await screen.findByRole("button", { name: /^Checkpoint/ }),
			).toBeVisible();
			expect(screen.queryByRole("button", { name: /^Keep/ })).toBeNull();

			fireEvent.keyDown(window, { key: "Escape" });
			await waitFor(() => {
				expect(
					screen.queryByRole("button", { name: /^Checkpoint/ }),
				).toBeNull();
			});
			expect(
				screen.getByRole("button", {
					name: "1 file changed since checkpoint. Open changes review",
				}),
			).toBeVisible();
			fireEvent.click(
				screen.getByRole("button", {
					name: "1 file changed since checkpoint. Open changes review",
				}),
			);
			expect(
				await screen.findByRole("button", { name: /^Checkpoint/ }),
			).toBeVisible();

			fireEvent.click(await findFilesTreeItem("auto-stable.md"));
			await waitFor(() => {
				expect(
					sessionStateStore.getSnapshot()?.panels.central.views[0]?.state
						?.fileId,
				).toBe(fakeUuid("auto-stable-file"));
			});
			expect(
				document.querySelector("[data-review-mode='true']"),
			).not.toBeNull();
			expect(screen.getByRole("button", { name: /^Checkpoint/ })).toBeVisible();

			await act(async () => {
				fireEvent.keyDown(window, { key: "Escape" });
			});
			await waitFor(() => {
				expect(document.querySelector("[data-review-mode='true']")).toBeNull();
			});
			await act(async () => {
				await atelier.views.open(HISTORY_EXTENSION_KIND, { panel: "left" });
			});
			let activeHistoryInstance: string | null = null;
			await waitFor(() => {
				const leftPanel = sessionStateStore.getSnapshot()?.panels.left;
				const activeView = leftPanel?.views.find(
					(view) => view.instance === leftPanel.activeInstance,
				);
				expect(activeView?.kind).toBe(HISTORY_EXTENSION_KIND);
				activeHistoryInstance = leftPanel?.activeInstance ?? null;
			});
			fireEvent.click(
				screen.getByRole("button", {
					name: "1 file changed since checkpoint. Open changes review",
				}),
			);
			expect(
				await screen.findByRole("button", { name: /^Checkpoint/ }),
			).toBeVisible();
			expect(
				sessionStateStore.getSnapshot()?.panels.central.views[0]?.state?.fileId,
			).toBe(fakeUuid("auto-stable-file"));
			expect(sessionStateStore.getSnapshot()?.panels.left.activeInstance).toBe(
				activeHistoryInstance,
			);
			const checkpointList = await screen.findByRole("list", {
				name: "Checkpoints",
			});
			fireEvent.click(
				within(checkpointList).getByRole("button", {
					name: /Latest checkpoint/,
				}),
			);
			expect(await screen.findByRole("button", { name: "Exit" })).toBeVisible();
			await waitFor(() => {
				expect(
					sessionStateStore.getSnapshot()?.panels.central.views[0]?.state
						?.beforeCommitId,
				).toEqual(expect.any(String));
				expect(
					sessionStateStore.getSnapshot()?.panels.central.views[0]?.state
						?.afterCommitId,
				).toEqual(expect.any(String));
			});
			expect(
				sessionStateStore.getSnapshot()?.panels.central.views[0]?.state
					?.beforeCommitId,
			).not.toBe(
				sessionStateStore.getSnapshot()?.panels.central.views[0]?.state
					?.afterCommitId,
			);
			expect(await screen.findByTestId("markdown-review-editor")).toBeVisible();
			expect(
				document.querySelector("[data-attr='historical-read-only-banner']"),
			).toBeNull();

			fireEvent.click(
				screen.getByRole("button", {
					name: "Working changes",
				}),
			);
			expect(
				await screen.findByRole("button", { name: /^Checkpoint/ }),
			).toBeVisible();
			expect(screen.getByRole("button", { name: "Exit" })).toBeVisible();
			await waitFor(() => {
				const activeView =
					sessionStateStore.getSnapshot()?.panels.central.views[0];
				expect(activeView?.state?.fileId).toBe(fakeUuid("auto-stable-file"));
				expect(activeView?.state?.afterCommitId).toBeUndefined();
				expect(activeView?.state?.beforeCommitId).toBeUndefined();
			});
			expect(sessionStateStore.getSnapshot()?.panels.left.activeInstance).toBe(
				activeHistoryInstance,
			);
			const execute = vi.spyOn(lix, "execute");
			fireEvent.click(screen.getByRole("button", { name: /^Checkpoint/ }));
			expect(
				await screen.findByRole("button", {
					name: "Latest checkpoint. Open checkpoint history",
				}),
			).toBeVisible();
			expect(
				execute.mock.calls.some(([statement]) =>
					String(statement).includes("lix_history('lix_file'"),
				),
			).toBe(false);
			await waitFor(() => {
				expect(screen.queryByText("Reviewing auto-changed.md")).toBeNull();
			});
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("creates a checkpoint and retires pre-resolved review state", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const reviewStatusStore = createMemoryReviewStatusStore();
		const atelier = createAtelier({
			lix,
			reviewStatusStore,
			sessionStateStore,
		});
		let utils: ReturnType<typeof render> | undefined;
		let releaseHistoryReads = () => {};
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fakeUuid("checkpoint-with-blocked-history"),
					path: "/checkpoint-with-blocked-history.md",
					content: new TextEncoder().encode("# Before\n"),
				})
				.execute();
			await lix.createCheckpoint();
			const beforeCommitId = await activeCommitId(lix);
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("# After\n") })
				.where("id", "=", fakeUuid("checkpoint-with-blocked-history"))
				.execute();
			const afterCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(lix, {
				id: "checkpoint-with-blocked-history",
				sourceId: "codex",
				beforeCommitId,
				afterCommitId,
				startedAt: 1,
				completedAt: 2,
			});
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			expect(await screen.findByRole("button", { name: "Keep" })).toBeVisible();
			fireEvent.click(
				await screen.findByRole("button", {
					name: "1 file changed since checkpoint. Open changes review",
				}),
			);
			expect(
				await screen.findByRole("button", { name: /^Checkpoint/ }),
			).toBeVisible();

			const originalExecute = lix.execute.bind(lix);
			const historyReadGate = new Promise<void>((resolve) => {
				releaseHistoryReads = resolve;
			});
			vi.spyOn(lix, "execute").mockImplementation(async (statement, params) => {
				if (String(statement).includes("lix_history('lix_file'")) {
					await historyReadGate;
				}
				return originalExecute(statement, params);
			});
			fireEvent.click(screen.getByRole("button", { name: /^Checkpoint/ }));
			await waitFor(() => {
				expect(
					screen.queryByRole("button", { name: /^Checkpoint/ }),
				).toBeNull();
			});
			await waitFor(async () => {
				const branchId = await lix.activeBranchId();
				expect(
					await reviewStatusStore.loadResolvedReviewIds(branchId),
				).toHaveLength(1);
			});
			// Zero eager history reads is ideal. If another mounted consumer does issue
			// one, the gate above proves it still is not an input to checkpoint creation.
			expect(screen.queryByRole("button", { name: /^Checkpoint/ })).toBeNull();
		} finally {
			releaseHistoryReads();
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("retires only selected partial-checkpoint reviews", async () => {
		const lix = await openLix();
		const reviewStatusStore = createMemoryReviewStatusStore();
		const atelier = createAtelier({ lix, reviewStatusStore });
		let utils: ReturnType<typeof render> | undefined;
		try {
			const selectedFileId = fakeUuid("partial-checkpoint-selected");
			const remainingFileId = fakeUuid("partial-checkpoint-remaining");
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: selectedFileId,
						path: "/partial-selected.md",
						content: new TextEncoder().encode("# Selected before\n"),
					},
					{
						id: remainingFileId,
						path: "/partial-remaining.md",
						content: new TextEncoder().encode("# Remaining before\n"),
					},
				])
				.execute();
			await lix.createCheckpoint();
			const beforeCommitId = await activeCommitId(lix);
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("# After\n") })
				.where("id", "in", [selectedFileId, remainingFileId])
				.execute();
			const afterCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(lix, {
				id: "partial-checkpoint-range",
				sourceId: "codex",
				beforeCommitId,
				afterCommitId,
				startedAt: 1,
				completedAt: 2,
			});

			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			expect(await screen.findByRole("button", { name: "Keep" })).toBeVisible();
			fireEvent.click(
				await screen.findByRole("button", {
					name: "2 files changed since checkpoint. Open changes review",
				}),
			);
			expect(
				await screen.findByRole("button", { name: /^Checkpoint/ }),
			).toBeVisible();
			fireEvent.click(
				await screen.findByRole("button", {
					name: "Working set: 2 of 2 files",
				}),
			);
			const workingSet = screen.getByRole("group", {
				name: "Files in the working set",
			});
			fireEvent.click(
				within(workingSet).getByRole("checkbox", {
					name: "partial-remaining.md",
				}),
			);
			expect(
				await screen.findByRole("button", {
					name: "Working set: 1 of 2 files",
				}),
			).toBeVisible();

			const execute = vi.spyOn(lix, "execute");

			fireEvent.click(screen.getByRole("button", { name: /^Checkpoint/ }));
			await waitFor(() => {
				expect(
					execute.mock.calls.some(([statement]) =>
						String(statement).includes("INSERT INTO lix_create_checkpoint"),
					),
				).toBe(true);
			});
			await waitFor(async () => {
				const branchId = await lix.activeBranchId();
				expect(
					await reviewStatusStore.loadResolvedReviewIds(branchId),
				).toHaveLength(1);
			});
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("lists changed files and opens the first one when working changes starts without an active document", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({ lix, sessionStateStore });
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: fakeUuid("empty-state-working-change-a"),
						path: "/a-empty-state-working-change.md",
						content: new TextEncoder().encode("# Before A\n"),
					},
					{
						id: fakeUuid("empty-state-working-change-z"),
						path: "/z-empty-state-working-change.md",
						content: new TextEncoder().encode("# Before Z\n"),
					},
				])
				.execute();
			await lix.createCheckpoint();

			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			await screen.findByRole("heading", { name: "Start writing" });
			const initialCentral = sessionStateStore.getSnapshot()?.panels.central;
			const initialActiveView = initialCentral?.views.find(
				(view) => view.instance === initialCentral.activeInstance,
			);
			expect(initialActiveView?.state?.fileId).toBeUndefined();

			await act(async () => {
				await qb(lix)
					.updateTable("lix_file")
					.set({ content: new TextEncoder().encode("# After\n") })
					.execute();
				await atelier.views.open(HISTORY_EXTENSION_KIND, { panel: "left" });
			});
			const workingChanges = await screen.findByRole("button", {
				name: "Working changes",
			});
			await waitFor(() => expect(workingChanges).toBeEnabled());
			fireEvent.click(workingChanges);

			await waitFor(() => {
				const central = sessionStateStore.getSnapshot()?.panels.central;
				const activeView = central?.views.find(
					(view) => view.instance === central.activeInstance,
				);
				expect(activeView?.state?.fileId).toBe(
					fakeUuid("empty-state-working-change-a"),
				);
			});
			const workingFiles = await screen.findByRole("list", {
				name: "Files in working changes",
			});
			const workingFileButtons = within(workingFiles).getAllByRole("button");
			expect(workingFileButtons.map((button) => button.textContent)).toEqual([
				"a-empty-state-working-change.md",
				"z-empty-state-working-change.md",
			]);
			expect(
				await screen.findByTestId(
					"tiptap-editor",
					{},
					{ timeout: ASYNC_UI_TIMEOUT },
				),
			).toHaveTextContent("After");
			await act(async () => {
				fireEvent.click(workingFileButtons[1]!);
			});
			await waitFor(() => {
				const central = sessionStateStore.getSnapshot()?.panels.central;
				const activeView = central?.views.find(
					(view) => view.instance === central.activeInstance,
				);
				expect(activeView?.state?.fileId).toBe(
					fakeUuid("empty-state-working-change-z"),
				);
			});
			expect(screen.getByRole("button", { name: /^Checkpoint/ })).toBeVisible();
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("opens a checkpoint file without collapsing the checkpoint", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const routeEchoes: Promise<unknown>[] = [];
		let atelier!: ReturnType<typeof createAtelier>;
		const onEvent = (event: AtelierEvent) => {
			if (
				event.type === "central_view_activated" &&
				event.filePath &&
				typeof event.state?.afterCommitId === "string"
			) {
				routeEchoes.push(atelier.documents.open(event.filePath));
			}
		};
		atelier = createAtelier({
			lix,
			sessionStateStore,
			onEvent,
		});
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: fakeUuid("checkpoint-file-a"),
						path: "/a-checkpoint.md",
						content: new TextEncoder().encode("# A before\n"),
					},
					{
						id: fakeUuid("checkpoint-file-z"),
						path: "/z-checkpoint.md",
						content: new TextEncoder().encode("# Z before\n"),
					},
				])
				.execute();
			await lix.createCheckpoint();
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("# After\n") })
				.execute();
			await lix.createCheckpoint();

			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} onEvent={onEvent} />
						</Suspense>
					</LixProvider>,
				);
			});
			await screen.findByRole("heading", { name: "Start writing" });
			await act(async () => {
				await atelier.views.open(HISTORY_EXTENSION_KIND, { panel: "left" });
			});

			const checkpointList = await screen.findByRole(
				"list",
				{ name: "Checkpoints" },
				{ timeout: ASYNC_UI_TIMEOUT },
			);
			const latestCheckpoint = within(checkpointList).getByRole("button", {
				name: /Latest checkpoint/,
			});
			expect(latestCheckpoint).toBeEnabled();
			const originalExecute = lix.execute.bind(lix);
			let activeCheckpointFileReads = 0;
			let maxActiveCheckpointFileReads = 0;
			const checkpointHistoryStatements: string[] = [];
			const execute = vi
				.spyOn(lix, "execute")
				.mockImplementation(async (statement, params) => {
					if (String(statement).includes("lix_history('lix_file'")) {
						checkpointHistoryStatements.push(String(statement));
						activeCheckpointFileReads += 1;
						maxActiveCheckpointFileReads = Math.max(
							maxActiveCheckpointFileReads,
							activeCheckpointFileReads,
						);
						await new Promise((resolve) => setTimeout(resolve, 5));
						try {
							return await originalExecute(statement, params);
						} finally {
							activeCheckpointFileReads -= 1;
						}
					}
					return originalExecute(statement, params);
				});
			await act(async () => {
				fireEvent.click(latestCheckpoint);
			});
			expect(
				await screen.findByRole(
					"button",
					{ name: "Exit" },
					{ timeout: ASYNC_UI_TIMEOUT },
				),
			).toBeVisible();
			const fileList = await screen.findByRole(
				"list",
				{ name: "Files at this checkpoint" },
				{ timeout: ASYNC_UI_TIMEOUT },
			);
			const fileButtons = within(fileList).getAllByRole("button");
			expect(fileButtons.map((button) => button.textContent)).toEqual([
				"a-checkpoint.md",
				"z-checkpoint.md",
			]);
			await waitFor(
				() => {
					const central = sessionStateStore.getSnapshot()?.panels.central;
					const activeView = central?.views.find(
						(view) => view.instance === central.activeInstance,
					);
					expect(activeView?.state?.afterCommitId).toEqual(expect.any(String));
					expect(activeView?.state?.filePath).toBe("/a-checkpoint.md");
				},
				{ timeout: ASYNC_UI_TIMEOUT },
			);
			await waitFor(() => expect(routeEchoes).toHaveLength(1));
			await act(async () => {
				await Promise.all(routeEchoes);
			});

			await act(async () => {
				fireEvent.click(fileButtons[1]!);
			});
			await waitFor(
				() => {
					const central = sessionStateStore.getSnapshot()?.panels.central;
					const activeView = central?.views.find(
						(view) => view.instance === central.activeInstance,
					);
					expect(activeView?.state?.filePath).toBe("/z-checkpoint.md");
					expect(activeView?.state?.afterCommitId).toEqual(expect.any(String));
				},
				{ timeout: ASYNC_UI_TIMEOUT },
			);
			expect(
				screen.getByRole("list", { name: "Files at this checkpoint" }),
			).toBeVisible();
			expect(screen.getByRole("button", { name: "Exit" })).toBeVisible();
			expect(
				within(checkpointList).getAllByRole("listitem")[0],
			).toHaveAttribute("aria-current", "true");
			const checkpointFileReads = execute.mock.calls
				.map(([statement]) => String(statement))
				.filter((statement) => statement.includes("FROM lix_diff($1, $2)"));
			expect(checkpointFileReads).toEqual([
				expect.stringContaining("FROM lix_diff($1, $2)"),
			]);
			expect(maxActiveCheckpointFileReads).toBe(1);
			const batchedCheckpointHistory = checkpointHistoryStatements.filter(
				(statement) => statement.includes(" UNION ALL "),
			);
			expect(batchedCheckpointHistory).toHaveLength(1);
			expect(batchedCheckpointHistory[0]?.match(/LIMIT 1/g)).toHaveLength(2);
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("does not query the absent before endpoint for a file added at a checkpoint", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({ lix, sessionStateStore });
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fakeUuid("checkpoint-added-baseline"),
					path: "/baseline.md",
					content: new TextEncoder().encode("# Baseline\n"),
				})
				.execute();
			const previous = await lix.createCheckpoint();
			const addedFileId = fakeUuid("checkpoint-added-file");
			await qb(lix)
				.deleteFrom("lix_file")
				.where("id", "=", fakeUuid("checkpoint-added-baseline"))
				.execute();
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: addedFileId,
					path: "/added.md",
					content: new TextEncoder().encode("# Added\n"),
				})
				.execute();
			const latest = await lix.createCheckpoint();
			expect(
				await selectCheckpointFiles(lix, previous.commitId, latest.commitId),
			).toEqual([
				{
					id: addedFileId,
					path: "/added.md",
					checkpointChangeKind: "added",
				},
				{
					id: fakeUuid("checkpoint-added-baseline"),
					path: "/baseline.md",
					checkpointChangeKind: "removed",
				},
			]);

			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			await screen.findByRole("heading", { name: "Start writing" });
			await act(async () => {
				await atelier.views.open(HISTORY_EXTENSION_KIND, { panel: "left" });
			});
			const originalExecute = lix.execute.bind(lix);
			const historyCalls: Array<{
				readonly statement: string;
				readonly params: unknown[];
			}> = [];
			vi.spyOn(lix, "execute").mockImplementation(async (statement, params) => {
				if (String(statement).includes("lix_history('lix_file'")) {
					historyCalls.push({
						statement: String(statement),
						params: [...(params ?? [])],
					});
				}
				return originalExecute(statement, params);
			});

			const checkpointList = await screen.findByRole("list", {
				name: "Checkpoints",
			});
			fireEvent.click(
				within(checkpointList).getByRole("button", {
					name: /Latest checkpoint/,
				}),
			);
			expect(await screen.findByRole("button", { name: "Exit" })).toBeVisible();
			await waitFor(() => {
				const central = sessionStateStore.getSnapshot()!.panels.central;
				const activeView = central.views.find(
					(view) => view.instance === central.activeInstance,
				);
				expect(activeView?.state).toMatchObject({
					fileId: addedFileId,
					beforeCommitId: previous.commitId,
					afterCommitId: latest.commitId,
					beforeExists: false,
					afterExists: true,
				});
			});
			const batchedHistoryCalls = historyCalls.filter(({ statement }) =>
				statement.includes(" UNION ALL "),
			);
			expect(batchedHistoryCalls).toHaveLength(1);
			expect(batchedHistoryCalls[0]?.statement.match(/LIMIT 1/g)).toHaveLength(
				2,
			);
			expect(batchedHistoryCalls[0]?.params).toEqual(
				expect.arrayContaining([
					previous.commitId,
					latest.commitId,
					addedFileId,
				]),
			);
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("opens a removed file when working changes contains only deletions", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({ lix, sessionStateStore });
		const fileId = fakeUuid("removed-working-change");
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fileId,
					path: "/removed-working-change.md",
					content: new TextEncoder().encode("# Removed\n"),
				})
				.execute();
			await lix.createCheckpoint();

			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			await screen.findByRole("heading", { name: "Start writing" });

			await act(async () => {
				await qb(lix).deleteFrom("lix_file").where("id", "=", fileId).execute();
				await atelier.views.open(HISTORY_EXTENSION_KIND, { panel: "left" });
			});
			const workingChanges = await screen.findByRole("button", {
				name: "Working changes",
			});
			await waitFor(() => expect(workingChanges).toBeEnabled());
			fireEvent.click(workingChanges);

			const workingFiles = await screen.findByRole("list", {
				name: "Files in working changes",
			});
			expect(within(workingFiles).getByRole("button")).toHaveTextContent(
				"removed-working-change.md",
			);
			await waitFor(() => {
				const central = sessionStateStore.getSnapshot()?.panels.central;
				const activeView = central?.views.find(
					(view) => view.instance === central.activeInstance,
				);
				expect(activeView?.state?.fileId).toBe(fileId);
				expect(activeView?.state?.beforeCommitId).toEqual(expect.any(String));
				expect(activeView?.state?.afterCommitId).toEqual(expect.any(String));
			});
			expect(
				await screen.findByTestId("markdown-review-editor"),
			).toHaveTextContent("Removed");
			expect(screen.getByRole("button", { name: /^Checkpoint/ })).toBeVisible();
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("opens the new range instead of an older non-active pending review", async () => {
		const lix = await openLix();
		const onEvent = vi.fn();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({ lix, onEvent, sessionStateStore });
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: fakeUuid("older-file"),
						path: "/a-older.md",
						content: new TextEncoder().encode("# Older before\n"),
					},
					{
						id: fakeUuid("stable-file"),
						path: "/middle.md",
						content: new TextEncoder().encode("# Stable\n"),
					},
					{
						id: fakeUuid("newer-file"),
						path: "/z-newer.md",
						content: new TextEncoder().encode("# Newer before\n"),
					},
				])
				.execute();
			const beforeOlder = await activeCommitId(lix);
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} onEvent={onEvent} />
						</Suspense>
					</LixProvider>,
				);
			});

			await act(async () => {
				await qb(lix)
					.updateTable("lix_file")
					.set({ content: new TextEncoder().encode("# Older after\n") })
					.where("id", "=", fakeUuid("older-file"))
					.execute();
			});
			const afterOlder = await activeCommitId(lix);
			await act(async () => {
				await appendAgentTurnCommitRange(lix, {
					id: "older-range",
					sourceId: "mcp",
					beforeCommitId: beforeOlder,
					afterCommitId: afterOlder,
					startedAt: 1,
					completedAt: 2,
				});
			});
			await waitFor(() => {
				expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
					expect.objectContaining({
						state: expect.objectContaining({ fileId: fakeUuid("older-file") }),
					}),
				]);
			});
			expect(await screen.findByRole("button", { name: "Keep" })).toBeVisible();

			fireEvent.click(await findFilesTreeItem("middle.md"));
			await waitFor(() => {
				expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
					expect.objectContaining({
						state: expect.objectContaining({ fileId: fakeUuid("stable-file") }),
					}),
				]);
			});

			const beforeNewer = await activeCommitId(lix);
			await act(async () => {
				await qb(lix)
					.updateTable("lix_file")
					.set({ content: new TextEncoder().encode("# Newer after\n") })
					.where("id", "=", fakeUuid("newer-file"))
					.execute();
			});
			const afterNewer = await activeCommitId(lix);
			await act(async () => {
				await appendAgentTurnCommitRange(lix, {
					id: "newer-range",
					sourceId: "mcp",
					beforeCommitId: beforeNewer,
					afterCommitId: afterNewer,
					startedAt: 3,
					completedAt: 4,
				});
			});

			await waitFor(() => {
				expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
					expect.objectContaining({
						state: expect.objectContaining({ fileId: fakeUuid("newer-file") }),
					}),
				]);
			});
			expect(await screen.findByRole("button", { name: "Keep" })).toBeVisible();
			expect(
				onEvent.mock.calls.filter(
					([event]) =>
						event.type === "document_viewed" &&
						event.filePath === "/z-newer.md",
				),
			).toHaveLength(1);
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("defers later and no-op ranges until the active review resolves", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({ lix, sessionStateStore });
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: fakeUuid("active-review-file"),
						path: "/active.md",
						content: new TextEncoder().encode("# Active before\n"),
					},
					{
						id: fakeUuid("queued-review-file"),
						path: "/queued.md",
						content: new TextEncoder().encode("# Queued before\n"),
					},
				])
				.execute();
			const beforeActive = await activeCommitId(lix);
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});

			await act(async () => {
				await qb(lix)
					.updateTable("lix_file")
					.set({ content: new TextEncoder().encode("# Active after\n") })
					.where("id", "=", fakeUuid("active-review-file"))
					.execute();
			});
			const afterActive = await activeCommitId(lix);
			await act(async () => {
				await appendAgentTurnCommitRange(lix, {
					id: "active-range",
					sourceId: "mcp",
					beforeCommitId: beforeActive,
					afterCommitId: afterActive,
					startedAt: 1,
					completedAt: 2,
				});
			});
			await waitFor(() => {
				expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
					expect.objectContaining({
						state: expect.objectContaining({
							fileId: fakeUuid("active-review-file"),
						}),
					}),
				]);
			});
			expect(await screen.findByRole("button", { name: "Keep" })).toBeVisible();

			const beforeQueued = await activeCommitId(lix);
			await act(async () => {
				await qb(lix)
					.updateTable("lix_file")
					.set({ content: new TextEncoder().encode("# Queued after\n") })
					.where("id", "=", fakeUuid("queued-review-file"))
					.execute();
			});
			const afterQueued = await activeCommitId(lix);
			await act(async () => {
				await appendAgentTurnCommitRange(lix, {
					id: "no-op-range",
					sourceId: "mcp",
					beforeCommitId: beforeQueued,
					afterCommitId: beforeQueued,
					startedAt: 3,
					completedAt: 4,
				});
				await appendAgentTurnCommitRange(lix, {
					id: "queued-range",
					sourceId: "mcp",
					beforeCommitId: beforeQueued,
					afterCommitId: afterQueued,
					startedAt: 5,
					completedAt: 6,
				});
			});
			const queuedFile = await findFilesTreeItem("queued.md");
			await waitFor(() => {
				expect(queuedFile).toHaveAttribute("data-item-git-status", "modified");
			});
			expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
				expect.objectContaining({
					state: expect.objectContaining({
						fileId: fakeUuid("active-review-file"),
					}),
				}),
			]);

			// S2: Keep accepts every pending review — the active one and the
			// deferred queued one — so review mode ends instead of advancing.
			const keepActiveReview = await screen.findByRole("button", {
				name: "Keep",
			});
			await act(async () => {
				fireEvent.click(keepActiveReview);
			});
			await waitFor(() => {
				expect(screen.queryByRole("button", { name: "Keep" })).toBeNull();
			});
			expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
				expect.objectContaining({
					state: expect.objectContaining({
						fileId: fakeUuid("active-review-file"),
					}),
				}),
			]);
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("hides ranges from a different configured review session", async () => {
		const lix = await openLix();
		const onEvent = vi.fn();
		const sessionStateStore = createMemorySessionStateStore();
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: fakeUuid("session-stable-file"),
						path: "/session-stable.md",
						content: new TextEncoder().encode("# Session stable\n"),
					},
					{
						id: fakeUuid("session-review-file"),
						path: "/session-review.md",
						content: new TextEncoder().encode("# Session before\n"),
					},
				])
				.execute();
			const beforeCommitId = await activeCommitId(lix);
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("# Session after\n") })
				.where("id", "=", fakeUuid("session-review-file"))
				.execute();
			const afterCommitId = await activeCommitId(lix);
			await appendAgentTurnCommitRange(lix, {
				id: "session-a-range",
				sourceId: "mcp",
				sessionId: "session-a",
				beforeCommitId,
				afterCommitId,
				startedAt: 1,
				completedAt: 2,
			});
			const atelier = createAtelier({
				lix,
				onEvent,
				sessionStateStore,
				reviewRangeSessionId: "session-b",
			});
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} onEvent={onEvent} />
						</Suspense>
					</LixProvider>,
				);
			});

			fireEvent.click(await findFilesTreeItem("session-review.md"));
			await waitFor(() => {
				expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
					expect.objectContaining({
						state: expect.objectContaining({
							fileId: fakeUuid("session-review-file"),
						}),
					}),
				]);
			});
			await act(async () => {
				await Promise.resolve();
			});
			expect(screen.queryByRole("button", { name: /^Keep/ })).toBeNull();

			fireEvent.click(await findFilesTreeItem("session-stable.md"));
			await waitFor(() => {
				expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
					expect.objectContaining({
						state: expect.objectContaining({
							fileId: fakeUuid("session-stable-file"),
						}),
					}),
				]);
			});
			await act(async () => {
				await appendAgentTurnCommitRange(lix, {
					id: "session-b-range",
					sourceId: "mcp",
					sessionId: "session-b",
					beforeCommitId,
					afterCommitId,
					startedAt: 3,
					completedAt: 4,
				});
			});

			await waitFor(() => {
				expect(sessionStateStore.getSnapshot()?.panels.central.views).toEqual([
					expect.objectContaining({
						state: expect.objectContaining({
							fileId: fakeUuid("session-review-file"),
						}),
					}),
				]);
			});
			expect(await screen.findByRole("button", { name: "Keep" })).toBeVisible();
			await waitFor(() => {
				const openedReviewIds = onEvent.mock.calls.flatMap(([event]) =>
					event.type === "diff_opened" ? [event.reviewId] : [],
				);
				expect(openedReviewIds).toHaveLength(1);
				expect(JSON.parse(openedReviewIds[0]!)[1]).toEqual(["session-b-range"]);
			});
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("diff.open immediately reviews a newly added file exactly once", async () => {
		const lix = await openLix();
		const onEvent = vi.fn();
		const atelier = createAtelier({ lix, onEvent });
		let utils: ReturnType<typeof render> | undefined;
		try {
			const beforeCommitId = await activeCommitId(lix);
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} onEvent={onEvent} />
						</Suspense>
					</LixProvider>,
				);
			});

			await act(async () => {
				await qb(lix)
					.insertInto("lix_file")
					.values({
						id: fakeUuid("agent-created-file"),
						path: "/agent-created.md",
						content: new TextEncoder().encode("# Created by agent\n"),
					})
					.execute();
			});
			const afterCommitId = await activeCommitId(lix);

			await act(async () => {
				await atelier.diff.open({
					beforeCommitId,
					afterCommitId,
					source: { id: "codex" },
				});
			});

			expect(await screen.findByRole("button", { name: "Undo" })).toBeVisible();
			expect(
				onEvent.mock.calls.filter(
					([event]) =>
						event.type === "document_viewed" &&
						event.filePath === "/agent-created.md",
				),
			).toHaveLength(1);

			// S2: Undo walks the whole working set back in one press.
			await act(async () => {
				fireEvent.click(screen.getByRole("button", { name: "Undo" }));
			});
			await waitFor(async () => {
				const file = await qb(lix)
					.selectFrom("lix_file")
					.select("id")
					.where("id", "=", fakeUuid("agent-created-file"))
					.executeTakeFirst();
				expect(file).toBeUndefined();
			});
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test.each([
		{
			name: "Keep wins if Undo is clicked while resolution is pending",
			action: "Keep",
			competingAction: "Undo",
			shouldExist: true,
		},
		{
			name: "Undo removes the file",
			action: "Undo",
			competingAction: undefined,
			shouldExist: false,
		},
	] as const)(
		"$name when resolving a newly added empty Markdown file",
		async ({ action, competingAction, shouldExist }) => {
			const lix = await openLix();
			const reviewStatusStore = createMemoryReviewStatusStore();
			const atelier = createAtelier({ lix, reviewStatusStore });
			let utils: ReturnType<typeof render> | undefined;
			try {
				const beforeCommitId = await activeCommitId(lix);
				await act(async () => {
					utils = render(
						<LixProvider lix={lix}>
							<Suspense fallback={null}>
								<V2LayoutShell instance={atelier} />
							</Suspense>
						</LixProvider>,
					);
				});

				await act(async () => {
					await qb(lix)
						.insertInto("lix_file")
						.values({
							id: fakeUuid("empty-agent-created-file"),
							path: "/empty-agent-created.md",
							content: new Uint8Array(),
						})
						.execute();
				});
				const afterCommitId = await activeCommitId(lix);

				await act(async () => {
					await atelier.diff.open({
						beforeCommitId,
						afterCommitId,
						source: { id: "codex" },
					});
				});

				const actionButton = await screen.findByRole("button", {
					name: new RegExp(`^${action}`),
				});
				const competingActionButton = competingAction
					? screen.getByRole("button", {
							name: new RegExp(`^${competingAction}`),
						})
					: null;
				fireEvent.click(actionButton);
				if (competingActionButton) fireEvent.click(competingActionButton);

				await waitFor(async () => {
					const file = await qb(lix)
						.selectFrom("lix_file")
						.select("id")
						.where("id", "=", fakeUuid("empty-agent-created-file"))
						.executeTakeFirst();
					expect(Boolean(file)).toBe(shouldExist);
					expect(
						screen.queryByRole("button", { name: new RegExp(`^${action}`) }),
					).toBeNull();
				});
				await waitFor(async () => {
					const branchId = await lix.activeBranchId();
					expect(branchId).not.toBeNull();
					expect(
						await reviewStatusStore.loadResolvedReviewIds(branchId!),
					).toHaveLength(1);
				});
			} finally {
				await act(async () => utils?.unmount());
				await lix.close();
			}
		},
	);
});

describe("installed extension lifecycle", () => {
	test("does not resurrect a stale tab when its extension is installed later", async () => {
		const extensionKind = "recovered_extension";
		const extensionInstance = "recovered-extension-1";
		const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
			URL,
			"createObjectURL",
		);
		const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
			URL,
			"revokeObjectURL",
		);
		const moduleSource = encodeURIComponent(
			"export default { mount({ element }) { element.textContent = 'Recovered extension content'; } }",
		);
		const createObjectUrl = vi.fn(() => `data:text/javascript,${moduleSource}`);
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectUrl,
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});

		const staleSessionState = {
			...DEFAULT_ATELIER_UI_STATE,
			panels: {
				...DEFAULT_ATELIER_UI_STATE.panels,
				left: {
					views: [{ instance: extensionInstance, kind: extensionKind }],
					activeInstance: extensionInstance,
				},
			},
		};
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore(staleSessionState);
		const atelier = createAtelier({ lix, sessionStateStore });
		let utils: ReturnType<typeof render> | undefined;
		try {
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});

			await waitFor(() => {
				const state = sessionStateStore.getSnapshot();
				expect(state?.panels.left.views).toEqual([]);
			});

			// A stale snapshot can also arrive after extension discovery has settled.
			// It must be pruned from canonical state, not only hidden while rendering.
			act(() => sessionStateStore.setSnapshot(staleSessionState));
			await waitFor(() => {
				const state = sessionStateStore.getSnapshot();
				expect(state?.panels.left.views).toEqual([]);
			});

			await act(async () => {
				await qb(lix)
					.insertInto("lix_file")
					.values([
						{
							path: "/.lix/app_data/atelier/extensions/recovered/manifest.json",
							content: new TextEncoder().encode(
								JSON.stringify({
									apiVersion: 1,
									id: extensionKind,
									name: "Recovered Extension",
									entry: "./index.js",
								}),
							),
						},
						{
							path: "/.lix/app_data/atelier/extensions/recovered/index.js",
							content: new TextEncoder().encode("export default {}"),
						},
					])
					.execute();
			});
			await waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(1));
			await act(async () => {
				await new Promise((resolve) => window.setTimeout(resolve, 50));
			});

			// No resurrected view: the empty-state chips may legitimately offer
			// the newly installed extension, but no view instance exists for it.
			expect(
				document.querySelector('[data-view-key="recovered_extension"]'),
			).toBeNull();
			expect(screen.queryByText("Recovered extension content")).toBeNull();

			const navigator = screen.getByRole("complementary", {
				name: "Navigator",
			});
			fireEvent.click(
				await within(navigator).findByRole("button", {
					name: "Recovered Extension",
				}),
			);

			expect(
				await screen.findByText("Recovered extension content"),
			).toBeInTheDocument();
			const restoredState = sessionStateStore.getSnapshot();
			const restoredEntry = restoredState?.panels.left.views.find(
				(entry) => entry.kind === extensionKind,
			);
			expect(restoredEntry?.instance).toBeDefined();
			expect(restoredEntry?.instance).not.toBe(extensionInstance);
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
			if (createObjectUrlDescriptor) {
				Object.defineProperty(
					URL,
					"createObjectURL",
					createObjectUrlDescriptor,
				);
			} else {
				Reflect.deleteProperty(URL, "createObjectURL");
			}
			if (revokeObjectUrlDescriptor) {
				Object.defineProperty(
					URL,
					"revokeObjectURL",
					revokeObjectUrlDescriptor,
				);
			} else {
				Reflect.deleteProperty(URL, "revokeObjectURL");
			}
		}
	});
});

describe("canonical UI state", () => {
	test("persists panel focus without rebuilding the rest of the snapshot", async () => {
		const fileId = fakeUuid("focus-file");
		const documentKind = "atelier_file";
		const documentInstance = fileExtensionInstanceForKind(documentKind, fileId);
		const initialState = {
			...DEFAULT_ATELIER_UI_STATE,
			focusedPanel: "central" as const,
			panels: {
				left: {
					views: [{ instance: "files-default", kind: FILES_EXTENSION_KIND }],
					activeInstance: "files-default",
				},
				central: {
					views: [
						{
							instance: documentInstance,
							kind: documentKind,
							state: { fileId, filePath: "/focus.md" },
						},
					],
					activeInstance: documentInstance,
				},
				right: { views: [], activeInstance: null },
			},
			layout: { sizes: { left: 20, central: 80, right: 0 } },
		};
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore(initialState);
		const preferencesStore = createMemoryPreferencesStore({
			version: 1,
			layout: initialState.layout,
		});
		const atelier = createAtelier({
			lix,
			sessionStateStore,
			preferencesStore,
		});
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/focus.md",
				content: new TextEncoder().encode("# Focus\n"),
			})
			.execute();
		let utils: ReturnType<typeof render> | undefined;
		try {
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});

			fireEvent.click(
				await screen.findByRole("button", {
					name: "Files panel view menu",
				}),
			);

			await waitFor(async () => {
				const state = sessionStateStore.getSnapshot();
				expect(state?.focusedPanel).toBe("left");
				expect(state?.panels).toEqual(initialState.panels);
				expect((await preferencesStore.load())?.layout.sizes).toEqual(
					initialState.layout.sizes,
				);
			});
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});
});

async function activeCommitId(
	lix: Awaited<ReturnType<typeof openLix>>,
): Promise<string> {
	const result = await lix.execute(
		"SELECT lix_active_branch_commit_id() AS commit_id",
	);
	const commitId = result.rows[0]?.get("commit_id");
	if (typeof commitId !== "string") {
		throw new Error("Missing active commit id");
	}
	return commitId;
}
