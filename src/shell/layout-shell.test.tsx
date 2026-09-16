import { Suspense } from "react";
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
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	isPanelShortcutBlockedTarget,
	resolveLixFileForOpen,
	selectCheckpointFiles,
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
	createMemoryPreferencesStore,
	createMemoryReviewStatusStore,
	createMemorySessionStateStore,
} from "../state-adapters";
import { fakeUuid } from "@/test-utils/fake-uuid";
import type {
	AtelierEvent,
	AtelierExtensionRegistration,
	AtelierExtensionRuntime,
} from "@/extension-api";

// History scopes itself to the active file; these flows exercise the
// repository timeline, so switch back when a file is on screen.
async function showRepositoryHistory() {
	await screen.findAllByLabelText("Checkpoint history");
	// Every History instance shares the extension preference, so one press
	// switches them all; the store updates asynchronously.
	const [scopeSwitch] = screen.queryAllByRole("button", {
		name: /Showing this file/,
	});
	if (!scopeSwitch) return;
	await act(async () => {
		fireEvent.click(scopeSwitch);
	});
	await waitFor(() =>
		expect(
			screen.queryAllByRole("button", { name: /Showing this file/ }),
		).toHaveLength(0),
	);
}

async function openWorkingChangesFromHistory() {
	fireEvent.click(
		await screen.findByRole("button", {
			name: /files? changed since checkpoint\. Review working changes/,
		}),
	);
}

const ASYNC_UI_TIMEOUT = 10_000;

describe("panel shortcut target guard", () => {
	test("blocks shortcuts in form controls nested inside the editor", () => {
		const editor = document.createElement("div");
		editor.className = "ProseMirror";
		const input = document.createElement("input");
		const textarea = document.createElement("textarea");
		editor.append(input, textarea);
		document.body.append(editor);

		try {
			expect(isPanelShortcutBlockedTarget(input)).toBe(true);
			expect(isPanelShortcutBlockedTarget(textarea)).toBe(true);
			expect(isPanelShortcutBlockedTarget(editor)).toBe(false);
		} finally {
			editor.remove();
		}
	});
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
			getLayout: vi.fn(() => ({ left: 20, main: 60, right: 20 })),
			setLayout: vi.fn((layout: Record<string, number>) => layout),
		};

		expect(syncPanelGroupLayout(group, { left: 20, main: 60, right: 20 })).toBe(
			false,
		);
		expect(group.setLayout).not.toHaveBeenCalled();

		group.getLayout.mockReturnValue({ left: 0, main: 100, right: 0 });
		const remoteLayout = { left: 25, main: 50, right: 25 };
		expect(syncPanelGroupLayout(group, remoteLayout)).toBe(true);
		expect(group.setLayout).toHaveBeenCalledWith(remoteLayout);
	});
});

describe("extension menu preferences", () => {
	test("shares the Files hidden-file toggle between the sidebar and main tab", async () => {
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
					area: "main",
					newTab: true,
				});
			});
			const filesTab = await waitFor(() => {
				const tab = document.querySelector<HTMLButtonElement>(
					'header [data-slot="main-tab-strip"] button[data-view-key="atelier_files"]',
				);
				if (!tab) throw new Error("main Files tab not found");
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
	test("opens documents as main tabs beside the sidebar Files view", async () => {
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
		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "One" })).toBeVisible();
		});
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
		// Files stays in the sidebar; the document is the only main view.
		await waitFor(() => {
			const value = sessionStateStore.getSnapshot();
			expect(value?.areas?.left?.views).toEqual([
				expect.objectContaining({ kind: FILES_EXTENSION_KIND }),
			]);
			expect(value?.areas?.main?.views).toEqual([
				expect.objectContaining({
					state: expect.objectContaining({ fileId: fakeUuid("one") }),
				}),
			]);
		});

		// A plain click navigates the active tab in place.
		fireEvent.click(await findFilesTreeItem("two.md"));
		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Two" })).toBeVisible();
		});
		await waitFor(() => {
			const value = sessionStateStore.getSnapshot();
			expect(value?.areas?.main?.views).toEqual([
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
			expect(sessionStateStore.getSnapshot()?.areas?.main?.views).toHaveLength(
				2,
			);
		});

		// Deleting every open file leaves the main empty state.
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
			expect(screen.getByTestId("main-panel-empty-state")).toBeVisible();
			expect(sessionStateStore.getSnapshot()?.areas?.main?.views).toEqual([]);
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
			focusedArea: "right" as const,
			areas: {
				...DEFAULT_ATELIER_UI_STATE.areas,
				main: {
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
			layout: { sizes: { left: 10, main: 55, right: 35 } },
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
			expect(screen.getByTestId("main-panel-empty-state")).toBeVisible();
			expect(screen.queryByRole("img", { name: "photo.jpeg" })).toBeNull();
		});
		await waitFor(async () => {
			const state = sessionStateStore.getSnapshot();
			expect(state?.areas.main).toEqual({
				views: [],
				activeInstance: null,
			});
			expect((await preferencesStore.load())?.layout.sizes).toEqual({
				left: 10,
				main: 55,
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
		await waitFor(() => {
			expect(screen.getByRole("heading", { name: "Next" })).toBeVisible();
		});
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

describe("diff review navigation", () => {
	test("opens checkpoint working changes without requiring agent-turn metadata", async () => {
		const lix = await openLix();
		await createCheckpoint(lix);
		const sessionStateStore = createMemorySessionStateStore();
		const preferencesStore = createMemoryPreferencesStore({
			version: 1,
			layout: { sizes: { left: 20, main: 80, right: 0 } },
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
			await createCheckpoint(lix);

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
					sessionStateStore.getSnapshot()?.areas.main.views[0]?.state?.fileId,
				).toBe(fakeUuid("auto-changed-file"));
			});

			await act(async () => {
				await qb(lix)
					.updateTable("lix_file")
					.where("path", "not like", "/.lix/%")
					.set({ content: new TextEncoder().encode("# After\n") })
					.where("id", "=", fakeUuid("auto-changed-file"))
					.execute();
			});
			await waitFor(() => {
				expect(
					screen.getByRole("button", {
						name: "1 file changed since checkpoint. Review working changes",
					}),
				).toBeVisible();
			});
			expect(
				sessionStateStore.getSnapshot()?.areas.main.views[0]?.state?.fileId,
			).toBe(fakeUuid("auto-changed-file"));
			await waitFor(() => {
				expect(
					screen.queryByRole("button", { name: /^Checkpoint(ing…)?$/ }),
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
			const reviewOpenExecute = vi.spyOn(lix, "execute");
			await act(async () => {
				await openWorkingChangesFromHistory();
			});
			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			// One statement resolves the epoch and diffs exactly those two
			// commits, so the files can never belong to a different span than
			// the one reported beside them.
			const reviewQuery = reviewOpenExecute.mock.calls
				.map(([sql]) => String(sql))
				.find(
					(sql) =>
						sql.includes("working_base_commit_id AS before_commit_id") &&
						sql.includes("lix_diff("),
				);
			expect(reviewQuery).toContain("(SELECT before_commit_id FROM epoch)");
			expect(reviewQuery).toContain("(SELECT after_commit_id FROM epoch)");
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
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			expect(screen.queryByRole("button", { name: /^Keep/ })).toBeNull();

			// An editor-level details popover consumes Escape before shell review
			// shortcuts. Neither the float nor the shell fallback may exit here.
			const consumeNestedEscape = (event: KeyboardEvent) => {
				if (event.key === "Escape") event.preventDefault();
			};
			document.addEventListener("keydown", consumeNestedEscape);
			try {
				await act(async () => {
					fireEvent.keyDown(document.body, { key: "Escape" });
				});
				expect(
					document.querySelector("[data-review-mode='true']"),
				).not.toBeNull();
				expect(
					screen.getByRole("button", { name: /^Checkpoint(ing…)?$/ }),
				).toBeVisible();
			} finally {
				document.removeEventListener("keydown", consumeNestedEscape);
			}

			fireEvent.keyDown(window, { key: "Escape" });
			await waitFor(() => {
				expect(
					screen.queryByRole("button", { name: /^Checkpoint(ing…)?$/ }),
				).toBeNull();
			});
			expect(
				screen.getByRole("button", {
					name: "1 file changed since checkpoint. Review working changes",
				}),
			).toBeVisible();

			// The pill opens and closes the same review. Pressed twice with no
			// pause, the second press has to close what the first started — the
			// state it reads has not flipped yet, because the open is still
			// reading the repository.
			const reviewPill = screen.getByRole("button", {
				name: "1 file changed since checkpoint. Review working changes",
			});
			await act(async () => {
				fireEvent.click(reviewPill);
				fireEvent.click(reviewPill);
			});
			// Asserting that nothing opens means giving it the chance to: the
			// read of the repository resolves after the close that called it off.
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 100));
			});
			expect(
				screen.queryByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeNull();
			expect(document.querySelector("[data-review-mode='true']")).toBeNull();

			// A called-off open leaves nothing behind: the next press opens.
			await openWorkingChangesFromHistory();
			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();

			fireEvent.click(await findFilesTreeItem("auto-stable.md"));
			await waitFor(() => {
				expect(
					sessionStateStore.getSnapshot()?.areas.main.views[0]?.state?.fileId,
				).toBe(fakeUuid("auto-stable-file"));
			});
			expect(
				document.querySelector("[data-review-mode='true']"),
			).not.toBeNull();
			expect(
				screen.getByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();

			await act(async () => {
				fireEvent.keyDown(window, { key: "Escape" });
			});
			await waitFor(() => {
				expect(document.querySelector("[data-review-mode='true']")).toBeNull();
			});
			await act(async () => {
				await atelier.views.open(HISTORY_EXTENSION_KIND, { area: "left" });
				await showRepositoryHistory();
			});
			let activeHistoryInstance: string | null = null;
			await waitFor(() => {
				const leftPanel = sessionStateStore.getSnapshot()?.areas.left;
				const activeView = leftPanel?.views.find(
					(view) => view.instance === leftPanel.activeInstance,
				);
				expect(activeView?.kind).toBe(HISTORY_EXTENSION_KIND);
				activeHistoryInstance = leftPanel?.activeInstance ?? null;
			});
			await openWorkingChangesFromHistory();
			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			// A working review shows live documents, never a historical diff.
			await waitFor(() => {
				const main = sessionStateStore.getSnapshot()?.areas.main;
				const activeView = main?.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(activeView?.state?.afterCommitId).toBeUndefined();
				expect(activeView?.state?.beforeCommitId).toBeUndefined();
			});
			expect(sessionStateStore.getSnapshot()?.areas.left.activeInstance).toBe(
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
			const historicalFiles = await screen.findByRole("list", {
				name: "Files at this checkpoint",
			});
			await act(async () => {
				fireEvent.click(within(historicalFiles).getAllByRole("button")[0]!);
			});
			await waitFor(() => {
				expect(
					sessionStateStore.getSnapshot()?.areas.main.views[0]?.state
						?.beforeCommitId,
				).toEqual(expect.any(String));
				expect(
					sessionStateStore.getSnapshot()?.areas.main.views[0]?.state
						?.afterCommitId,
				).toEqual(expect.any(String));
			});
			expect(
				sessionStateStore.getSnapshot()?.areas.main.views[0]?.state
					?.beforeCommitId,
			).not.toBe(
				sessionStateStore.getSnapshot()?.areas.main.views[0]?.state
					?.afterCommitId,
			);
			await waitFor(() => {
				expect(screen.getByTestId("markdown-review-editor")).toBeVisible();
			});
			expect(
				document.querySelector("[data-attr='historical-read-only-banner']"),
			).toBeNull();

			fireEvent.click(
				screen.getByRole("button", {
					name: "Working changes",
				}),
			);
			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			expect(screen.getByRole("button", { name: "Exit" })).toBeVisible();
			// Returning to "now" releases the snapshot view and restores the live
			// document it replaced. Opening review is not a navigation, so the
			// unchanged file stays on screen and the changed one waits in the
			// float.
			await waitFor(() => {
				const main = sessionStateStore.getSnapshot()?.areas.main;
				const activeView = main?.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(activeView?.state?.fileId).toBe(fakeUuid("auto-stable-file"));
				expect(activeView?.state?.afterCommitId).toBeUndefined();
				expect(activeView?.state?.beforeCommitId).toBeUndefined();
			});
			expect(sessionStateStore.getSnapshot()?.areas.left.activeInstance).toBe(
				activeHistoryInstance,
			);
			// › opens the changed file, which makes it the checkpoint's scope.
			await act(async () => {
				fireEvent.click(
					screen.getByRole("button", { name: "Next changed file" }),
				);
			});
			await waitFor(() => {
				const main = sessionStateStore.getSnapshot()?.areas.main;
				const activeView = main?.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(activeView?.state?.fileId).toBe(fakeUuid("auto-changed-file"));
				expect(activeView?.state?.afterCommitId).toBeUndefined();
			});
			const execute = vi.spyOn(lix, "execute");
			execute.mockClear();
			fireEvent.click(
				screen.getByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			);
			const idlePill = await screen.findByRole("button", {
				name: "Latest checkpoint. Review latest checkpoint",
			});
			expect(idlePill).toBeVisible();
			expect(
				execute.mock.calls.some(([statement]) =>
					String(statement).includes("lix_as_of('lix_file'"),
				),
			).toBe(false);
			await waitFor(() => {
				expect(screen.queryByText("Reviewing auto-changed.md")).toBeNull();
			});
			// The idle pill reviews the checkpoint it names, as the History
			// view would, without switching the side panel to History.
			const leftBefore = sessionStateStore.getSnapshot()?.areas.left;
			fireEvent.click(idlePill);
			expect(await screen.findByRole("button", { name: "Exit" })).toBeVisible();
			expect(
				await screen.findByRole("list", { name: "Files at this checkpoint" }),
			).toBeVisible();
			expect(sessionStateStore.getSnapshot()?.areas.left).toEqual(leftBefore);
			const closePill = await screen.findByRole("button", {
				name: "Latest checkpoint. Close review",
			});
			fireEvent.click(closePill);
			await waitFor(() => {
				expect(screen.queryByRole("button", { name: "Exit" })).toBeNull();
			});
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("creates a checkpoint from the working-changes review", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const reviewStatusStore = createMemoryReviewStatusStore();
		const atelier = createAtelier({
			lix,
			reviewStatusStore,
			sessionStateStore,
		});
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fakeUuid("checkpoint-with-blocked-history"),
					path: "/checkpoint-with-blocked-history.md",
					content: new TextEncoder().encode("# Before\n"),
				})
				.execute();
			await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.where("path", "not like", "/.lix/%")
				.set({ content: new TextEncoder().encode("# After\n") })
				.where("id", "=", fakeUuid("checkpoint-with-blocked-history"))
				.execute();
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			await openWorkingChangesFromHistory();
			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			const execute = vi.spyOn(lix, "execute");
			fireEvent.click(
				screen.getByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			);
			await waitFor(() => {
				expect(
					execute.mock.calls.some(([statement]) =>
						String(statement).includes("FROM lix_create_checkpoint("),
					),
				).toBe(true);
			});
			await waitFor(() => {
				expect(
					screen.queryByRole("button", { name: /^Checkpoint(ing…)?$/ }),
				).toBeNull();
			});
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("checkpoints an added active file without reading its absent history", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({ lix, sessionStateStore });
		const fileId = fakeUuid("checkpoint-added-active-file");
		let utils: ReturnType<typeof render> | undefined;
		let releaseHistoryReads = () => {};
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fakeUuid("checkpoint-added-baseline"),
					path: "/baseline.md",
					content: new TextEncoder().encode("# Baseline\n"),
				})
				.execute();
			await createCheckpoint(lix);
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fileId,
					path: "/added-active.md",
					content: new TextEncoder().encode("# Added\n"),
				})
				.execute();

			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			fireEvent.click(await findFilesTreeItem("added-active.md"));
			await waitFor(() => {
				expect(
					sessionStateStore.getSnapshot()?.areas.main.views[0]?.state?.fileId,
				).toBe(fileId);
			});

			const originalExecute = lix.execute.bind(lix);
			const historyReadGate = new Promise<void>((resolve) => {
				releaseHistoryReads = resolve;
			});
			let blockedHistoryReadCount = 0;
			vi.spyOn(lix, "execute").mockImplementation(async (statement, params) => {
				if (String(statement).includes("lix_as_of('lix_file'")) {
					blockedHistoryReadCount += 1;
					await historyReadGate;
				}
				return originalExecute(statement, params);
			});
			await openWorkingChangesFromHistory();
			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			expect(blockedHistoryReadCount).toBe(0);

			fireEvent.click(
				screen.getByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			);
			await waitFor(() => {
				expect(
					screen.queryByRole("button", { name: /^Checkpoint(ing…)?$/ }),
				).toBeNull();
			});
			expect(blockedHistoryReadCount).toBe(0);
		} finally {
			releaseHistoryReads();
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("checkpointing the viewed file keeps the review on it, and the unticked one under review", async () => {
		const lix = await openLix();
		const reviewStatusStore = createMemoryReviewStatusStore();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({
			lix,
			reviewStatusStore,
			sessionStateStore,
		});
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
			await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.where("path", "not like", "/.lix/%")
				.set({ content: new TextEncoder().encode("# After\n") })
				.where("id", "in", [selectedFileId, remainingFileId])
				.execute();
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			await openWorkingChangesFromHistory();
			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			// Nothing is viewed yet; › steps through the files, and every file
			// it shows stays ticked. Two steps reach /partial-selected.md with
			// both ticked, so the pass-through file is unticked by hand.
			for (let step = 0; step < 2; step += 1) {
				await act(async () => {
					fireEvent.click(
						screen.getByRole("button", { name: "Next changed file" }),
					);
				});
			}
			await waitFor(() => {
				const main = sessionStateStore.getSnapshot()?.areas.main;
				const activeView = main?.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(activeView?.state?.fileId).toBe(selectedFileId);
			});
			await act(async () => {
				fireEvent.click(
					await screen.findByRole("button", {
						name: "Working set: 2 of 2 files",
					}),
				);
			});
			await act(async () => {
				fireEvent.click(
					await screen.findByTestId(`diff-scope-file:${remainingFileId}`),
				);
			});
			expect(
				await screen.findByRole("button", {
					name: "Working set: 1 of 2 files",
				}),
			).toBeVisible();
			await act(async () => {
				fireEvent.click(
					screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
				);
			});

			const execute = vi.spyOn(lix, "execute");

			fireEvent.click(
				screen.getByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			);
			await waitFor(() => {
				expect(
					execute.mock.calls.some(([statement]) =>
						String(statement).includes("FROM lix_create_checkpoint("),
					),
				).toBe(true);
			});
			// Sealing the ticked file does not conclude the review, and it is
			// not a navigation either: the reader stays on the file they
			// sealed, the session still lists both files with this one marked
			// done, and the workspace counts the one still changed.
			expect(
				await screen.findByRole(
					"button",
					{ name: "1 file changed since checkpoint. Close review" },
					{ timeout: ASYNC_UI_TIMEOUT },
				),
			).toBeVisible();
			expect(
				await screen.findByRole(
					"button",
					{ name: "Checkpointed" },
					{ timeout: ASYNC_UI_TIMEOUT },
				),
			).toBeDisabled();
			expect(screen.getByRole("button", { name: "Exit" })).toBeVisible();
			const activeFileId = () => {
				const main = sessionStateStore.getSnapshot()?.areas.main;
				return main?.views.find((view) => view.instance === main.activeInstance)
					?.state?.fileId;
			};
			expect(activeFileId()).toBe(selectedFileId);
			expect(screen.getByLabelText("File 2 of 2")).toBeVisible();
			expect(
				screen.getByRole("button", { name: "Working set: 0 of 2 files" }),
			).toBeVisible();
			// › walks on to the file still open, and the verb is Checkpoint again.
			await act(async () => {
				fireEvent.click(
					screen.getByRole("button", { name: "Next changed file" }),
				);
			});
			await waitFor(() => expect(activeFileId()).toBe(remainingFileId), {
				timeout: ASYNC_UI_TIMEOUT,
			});
			expect(
				await screen.findByRole("button", { name: "Checkpoint" }),
			).toBeEnabled();
			expect(
				screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
			).toBeVisible();
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("undoing one of three files keeps the other two under review", async () => {
		const lix = await openLix();
		const reviewStatusStore = createMemoryReviewStatusStore();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({
			lix,
			reviewStatusStore,
			sessionStateStore,
		});
		let utils: ReturnType<typeof render> | undefined;
		try {
			const ids = ["a", "b", "c"].map((name) => fakeUuid(`undo-three-${name}`));
			await qb(lix)
				.insertInto("lix_file")
				.values(
					ids.map((id, index) => ({
						id,
						path: `/undo-three-${"abc"[index]}.md`,
						content: new TextEncoder().encode(`# Before ${index}\n`),
					})),
				)
				.execute();
			await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.where("path", "not like", "/.lix/%")
				.set({ content: new TextEncoder().encode("# After\n") })
				.where("id", "in", ids)
				.execute();
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			await openWorkingChangesFromHistory();
			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			// Nothing is viewed on entry; › steps to the first changed file.
			await act(async () => {
				fireEvent.click(
					screen.getByRole("button", { name: "Next changed file" }),
				);
			});
			await waitFor(() => {
				const main = sessionStateStore.getSnapshot()?.areas.main;
				const activeView = main?.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(activeView?.state?.fileId).toBe(ids[0]);
			});
			expect(
				await screen.findByRole("button", {
					name: "Working set: 1 of 3 files",
				}),
			).toBeVisible();

			fireEvent.click(screen.getByRole("button", { name: "Undo" }));

			// One file handled, two to go: the review stays open, the handled
			// file leaves the list, and the next one takes its place on screen.
			expect(
				await screen.findByRole("button", {
					name: "Working set: 1 of 2 files",
				}),
			).toBeVisible();
			expect(
				screen.getByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			await waitFor(() => {
				const main = sessionStateStore.getSnapshot()?.areas.main;
				const activeView = main?.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(activeView?.state?.fileId).toBe(ids[1]);
			});
			// The handled file is gone from the working set; the other two remain.
			await act(async () => {
				fireEvent.click(
					screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
				);
			});
			const rows = await screen.findAllByTestId(/^diff-scope-file:/);
			expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
				`diff-scope-file:${ids[1]}`,
				`diff-scope-file:${ids[2]}`,
			]);
			// Escape on the picker closes the picker only. The session — and
			// with it the working set the picker is showing — stays.
			await act(async () => {
				fireEvent.keyDown(window, { key: "Escape" });
			});
			expect(screen.queryAllByTestId(/^diff-scope-file:/)).toHaveLength(0);
			expect(
				screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
			).toBeVisible();
			expect(
				document.querySelector("[data-review-mode='true']"),
			).not.toBeNull();
			await act(async () => {
				fireEvent.click(
					screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
				);
			});
			await screen.findAllByTestId(/^diff-scope-file:/);
			await act(async () => {
				fireEvent.click(
					screen.getByRole("button", { name: "Working set: 1 of 2 files" }),
				);
			});

			// Undo again. The first revert moved the head, so the session must
			// be reading a fresh epoch by now — this is where the review used
			// to fail with "the working diff changed while it was being reviewed".
			fireEvent.click(screen.getByRole("button", { name: "Undo" }));
			expect(
				await screen.findByRole(
					"button",
					{ name: "1 file changed since checkpoint. Close review" },
					{ timeout: ASYNC_UI_TIMEOUT },
				),
			).toBeVisible();
			expect(
				screen.queryByText(
					/The working diff changed while it was being reviewed/,
				),
			).toBeNull();
			await waitFor(
				() => {
					const main = sessionStateStore.getSnapshot()?.areas.main;
					const activeView = main?.views.find(
						(view) => view.instance === main.activeInstance,
					);
					expect(activeView?.state?.fileId).toBe(ids[2]);
				},
				{ timeout: ASYNC_UI_TIMEOUT },
			);
			expect(
				await screen.findByRole(
					"button",
					{ name: "Undo" },
					{ timeout: ASYNC_UI_TIMEOUT },
				),
			).toBeVisible();
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("enters review mode without opening a file; files open on explicit selection", async () => {
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
			await createCheckpoint(lix);

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
			const initialCentral = sessionStateStore.getSnapshot()?.areas.main;
			const initialActiveView = initialCentral?.views.find(
				(view) => view.instance === initialCentral.activeInstance,
			);
			expect(initialActiveView?.state?.fileId).toBeUndefined();

			await act(async () => {
				await qb(lix)
					.updateTable("lix_file")
					.where("path", "not like", "/.lix/%")
					.set({ content: new TextEncoder().encode("# After\n") })
					.execute();
				await atelier.views.open(HISTORY_EXTENSION_KIND, { area: "left" });
				await showRepositoryHistory();
			});
			const workingChanges = await screen.findByRole("button", {
				name: "Working changes",
			});
			await waitFor(() => expect(workingChanges).toBeEnabled());
			fireEvent.click(workingChanges);

			// Review mode is entered, and nothing is opened for the user: the
			// changed files wait in the float, to be stepped through or chosen.
			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			const stillEmpty = sessionStateStore.getSnapshot()?.areas.main;
			const stillEmptyView = stillEmpty?.views.find(
				(view) => view.instance === stillEmpty.activeInstance,
			);
			expect(stillEmptyView?.state?.fileId).toBeUndefined();
			const workingFiles = await screen.findByRole("list", {
				name: "Files in working changes",
			});
			const workingFileButtons = within(workingFiles).getAllByRole("button");
			expect(workingFileButtons.map((button) => button.textContent)).toEqual([
				"a-empty-state-working-change.md",
				"z-empty-state-working-change.md",
			]);
			await act(async () => {
				fireEvent.click(workingFileButtons[1]!);
			});
			expect(
				await screen.findByTestId(
					"tiptap-editor",
					{},
					{ timeout: ASYNC_UI_TIMEOUT },
				),
			).toHaveTextContent("After");
			await waitFor(() => {
				const main = sessionStateStore.getSnapshot()?.areas.main;
				const activeView = main?.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(activeView?.state?.fileId).toBe(
					fakeUuid("empty-state-working-change-z"),
				);
			});
			expect(
				screen.getByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
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
				event.type === "main_view_activated" &&
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
			await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.where("path", "not like", "/.lix/%")
				.set({ content: new TextEncoder().encode("# After\n") })
				.execute();
			await createCheckpoint(lix);

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
				await atelier.views.open(HISTORY_EXTENSION_KIND, { area: "left" });
				await showRepositoryHistory();
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
					if (String(statement).includes("lix_as_of('lix_file'")) {
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
			// Entering the checkpoint opens nothing: the changed files wait in
			// the list until one is chosen, so no route is echoed yet.
			{
				const main = sessionStateStore.getSnapshot()?.areas.main;
				const activeView = main?.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(activeView?.state?.afterCommitId).toBeUndefined();
			}
			expect(routeEchoes).toHaveLength(0);

			await act(async () => {
				fireEvent.click(fileButtons[1]!);
			});
			await waitFor(() => expect(routeEchoes).toHaveLength(1));
			await act(async () => {
				await Promise.all(routeEchoes);
			});
			await waitFor(
				() => {
					const main = sessionStateStore.getSnapshot()?.areas.main;
					const activeView = main?.views.find(
						(view) => view.instance === main.activeInstance,
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
				.filter((statement) =>
					statement.includes("FROM lix_diff('lix_file', $1, $2)"),
				);
			expect(checkpointFileReads).toEqual([
				expect.stringContaining("FROM lix_diff('lix_file', $1, $2)"),
			]);
			expect(maxActiveCheckpointFileReads).toBe(1);
			expect(checkpointHistoryStatements.length).toBeGreaterThan(0);
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	// The History row chains openFile onto open(). open() resolves before React
	// commits the session it just set, so the chained call used to reach the
	// span the click was leaving and re-pin the file to it: the list highlighted
	// the checkpoint clicked while the pane kept rendering the previous one's
	// diff. Driving the runtime outside act() keeps that ordering; a fireEvent
	// click inside act() lets React commit in between and hides it.
	test("switching checkpoints shows the span that was clicked", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		let runtime: AtelierExtensionRuntime | null = null;
		const extensions = [
			{
				id: "atelier.test.diff-probe",
				name: "Diff probe",
				placement: ["left"] as const,
				Component: ({
					atelier,
				}: {
					readonly atelier: AtelierExtensionRuntime;
				}) => {
					runtime = atelier;
					return <div data-testid="diff-probe" />;
				},
			},
		] as unknown as readonly AtelierExtensionRegistration[];
		const atelier = createAtelier({ lix, sessionStateStore, extensions });
		let utils: ReturnType<typeof render> | undefined;
		const fileId = fakeUuid("checkpoint-switch");
		const write = async (text: string) =>
			qb(lix)
				.updateTable("lix_file")
				.where("id", "=", fileId)
				.set({ content: new TextEncoder().encode(text) })
				.execute();
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fileId,
					path: "/switch.md",
					content: new TextEncoder().encode("# one\n"),
				})
				.execute();
			const first = await createCheckpoint(lix);
			await write("# two\n");
			const second = await createCheckpoint(lix);
			await write("# three\n");
			const third = await createCheckpoint(lix);

			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} extensions={extensions} />
						</Suspense>
					</LixProvider>,
				);
			});
			await screen.findByRole("heading", { name: "Start writing" });
			await act(async () => {
				await atelier.documents.open("/switch.md");
				await atelier.views.open("atelier.test.diff-probe", { area: "left" });
			});
			await screen.findByTestId("diff-probe");

			const activeState = () => {
				const main = sessionStateStore.getSnapshot()?.areas.main;
				return main?.views.find((view) => view.instance === main.activeInstance)
					?.state;
			};
			// Exactly what the History row does, and outside act() so the
			// chained openFile runs before React commits, as it does in a browser.
			const viewCheckpoint = async (base: string, target: string) => {
				const diff = runtime?.diff;
				if (!diff) throw new Error("the probe view never received a runtime");
				await diff
					.open({ base: { commitId: base }, target: { commitId: target } })
					.then(() => diff.openFile("/switch.md"));
				await act(async () => {});
				await waitFor(
					() => {
						expect(activeState()?.afterCommitId).toBe(target);
						expect(activeState()?.beforeCommitId).toBe(base);
					},
					{ timeout: ASYNC_UI_TIMEOUT },
				);
			};

			await viewCheckpoint(second.commitId, third.commitId);
			// The switch that used to lag.
			await viewCheckpoint(first.commitId, second.commitId);
			await viewCheckpoint(second.commitId, third.commitId);
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("resolves a large modified checkpoint without file history fan-out", async () => {
		const lix = await openLix();
		try {
			const files = Array.from({ length: 100 }, (_, index) => ({
				id: fakeUuid(`checkpoint-scale-${index}`),
				path: `/scale-${index}.md`,
				content: new TextEncoder().encode(`# Before ${index}\n`),
			}));
			await qb(lix).insertInto("lix_file").values(files).execute();
			const previous = await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.where("path", "not like", "/.lix/%")
				.set({ content: new TextEncoder().encode("# After\n") })
				.execute();
			const latest = await createCheckpoint(lix);
			const execute = vi.spyOn(lix, "execute");

			const selected = await selectCheckpointFiles(
				lix,
				previous.commitId,
				latest.commitId,
			);

			expect(selected).toHaveLength(files.length);
			expect(
				execute.mock.calls.filter(([statement]) =>
					String(statement).includes("lix_as_of('lix_file'"),
				),
			).toEqual([]);
		} finally {
			await lix.close();
		}
	});

	test("resolves historical paths only when renamed or missing files are opened", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({ lix, sessionStateStore });
		const renamedId = fakeUuid("checkpoint-later-renamed");
		const deletedId = fakeUuid("checkpoint-later-deleted");
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: renamedId,
						path: "/historical-name.md",
						content: new TextEncoder().encode("# Before rename\n"),
					},
					{
						id: deletedId,
						path: "/historical-delete.md",
						content: new TextEncoder().encode("# Before delete\n"),
					},
				])
				.execute();
			await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.where("path", "not like", "/.lix/%")
				.set({ content: new TextEncoder().encode("# At checkpoint\n") })
				.execute();
			await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.where("path", "not like", "/.lix/%")
				.set({ path: "/current-name.csv" })
				.where("id", "=", renamedId)
				.execute();
			await qb(lix)
				.deleteFrom("lix_file")
				.where("id", "=", deletedId)
				.execute();

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
				await atelier.views.open(HISTORY_EXTENSION_KIND, { area: "left" });
				await showRepositoryHistory();
			});
			const checkpointList = await screen.findByRole("list", {
				name: "Checkpoints",
			});
			fireEvent.click(
				within(checkpointList).getByRole("button", {
					name: /Latest checkpoint/,
				}),
			);
			const historicalFiles = await screen.findByRole("list", {
				name: "Files at this checkpoint",
			});
			// The relation-scoped diff resolves paths as of the checkpoint: a
			// later rename or deletion no longer leaks the live name or a raw
			// file-id placeholder into the historical list.
			expect(
				within(historicalFiles).getByText("historical-name.md"),
			).toBeVisible();
			expect(
				within(historicalFiles).getByText("historical-delete.md"),
			).toBeVisible();

			await act(async () => {
				fireEvent.click(
					within(historicalFiles).getByRole("button", {
						name: /^historical-name\.md/,
					}),
				);
			});
			await waitFor(() => {
				const main = sessionStateStore.getSnapshot()!.areas.main;
				const active = main.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(active?.state?.filePath).toBe("/historical-name.md");
			});

			await act(async () => {
				fireEvent.click(
					within(historicalFiles).getByRole("button", {
						name: /^historical-delete\.md/,
					}),
				);
			});
			await waitFor(() => {
				const main = sessionStateStore.getSnapshot()!.areas.main;
				const active = main.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(active?.state?.filePath).toBe("/historical-delete.md");
			});
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("does not reopen a historical file when its lazy path read finishes after Exit", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({ lix, sessionStateStore });
		const fileId = fakeUuid("checkpoint-exit-pending-history");
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fileId,
					path: "/pending-history.md",
					content: new TextEncoder().encode("# Before\n"),
				})
				.execute();
			await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.where("path", "not like", "/.lix/%")
				.set({ content: new TextEncoder().encode("# After\n") })
				.where("id", "=", fileId)
				.execute();
			await createCheckpoint(lix);

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
				await atelier.views.open(HISTORY_EXTENSION_KIND, { area: "left" });
				await showRepositoryHistory();
			});
			const checkpointList = await screen.findByRole("list", {
				name: "Checkpoints",
			});
			fireEvent.click(
				within(checkpointList).getByRole("button", {
					name: /Latest checkpoint/,
				}),
			);
			const historicalFiles = await screen.findByRole("list", {
				name: "Files at this checkpoint",
			});

			const originalExecute = lix.execute.bind(lix);
			let releaseHistory!: () => void;
			const historyBlocked = new Promise<void>((resolve) => {
				releaseHistory = resolve;
			});
			let markHistoryStarted!: () => void;
			const historyStarted = new Promise<void>((resolve) => {
				markHistoryStarted = resolve;
			});
			vi.spyOn(lix, "execute").mockImplementation(async (statement, params) => {
				if (String(statement).includes("lix_as_of('lix_file'")) {
					markHistoryStarted();
					await historyBlocked;
				}
				return originalExecute(statement, params);
			});

			fireEvent.click(
				within(historicalFiles).getByRole("button", {
					name: /^pending-history\.md/,
				}),
			);
			await historyStarted;
			fireEvent.click(screen.getByRole("button", { name: "Exit" }));
			await act(async () => {
				releaseHistory();
				await historyBlocked;
				await Promise.resolve();
			});

			await waitFor(() => {
				expect(screen.queryByRole("button", { name: "Exit" })).toBeNull();
				expect(
					sessionStateStore
						.getSnapshot()
						?.areas.main.views.some(
							(view) =>
								typeof view.state?.afterCommitId === "string" ||
								typeof view.state?.beforeCommitId === "string",
						),
				).toBe(false);
			});
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
			const previous = await createCheckpoint(lix);
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
			const latest = await createCheckpoint(lix);
			const selectedCheckpointFiles = await selectCheckpointFiles(
				lix,
				previous.commitId,
				latest.commitId,
			);
			expect(selectedCheckpointFiles).toEqual(
				expect.arrayContaining([
					{
						id: addedFileId,
						path: "/added.md",
						checkpointChangeKind: "added",
					},
					{
						id: fakeUuid("checkpoint-added-baseline"),
						// The relation-scoped diff resolves the removed file's path
						// from the base side instead of a raw file-id placeholder.
						path: "/baseline.md",
						checkpointChangeKind: "removed",
					},
				]),
			);

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
				await atelier.views.open(HISTORY_EXTENSION_KIND, { area: "left" });
				await showRepositoryHistory();
			});
			const originalExecute = lix.execute.bind(lix);
			const historyCalls: Array<{
				readonly statement: string;
				readonly params: unknown[];
			}> = [];
			vi.spyOn(lix, "execute").mockImplementation(async (statement, params) => {
				if (String(statement).includes("lix_as_of('lix_file'")) {
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
			const checkpointFiles = await screen.findByRole("list", {
				name: "Files at this checkpoint",
			});
			await act(async () => {
				fireEvent.click(
					within(checkpointFiles).getByRole("button", { name: /^added\.md/ }),
				);
			});
			await waitFor(() => {
				const main = sessionStateStore.getSnapshot()!.areas.main;
				const activeView = main.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(activeView?.state).toMatchObject({
					fileId: addedFileId,
					beforeCommitId: previous.commitId,
					afterCommitId: latest.commitId,
					beforeExists: false,
					afterExists: true,
				});
			});
			const absentBeforeReads = historyCalls.filter(
				({ params }) =>
					params.includes(previous.commitId) && params.includes(addedFileId),
			);
			expect(absentBeforeReads).toEqual([]);
			expect(
				historyCalls.some(
					({ params }) =>
						params.includes(latest.commitId) && params.includes(addedFileId),
				),
			).toBe(true);
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("a deletions-only review opens the removed file only when it is chosen", async () => {
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
			await createCheckpoint(lix);

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
				await atelier.views.open(HISTORY_EXTENSION_KIND, { area: "left" });
				await showRepositoryHistory();
			});
			const workingChanges = await screen.findByRole("button", {
				name: "Working changes",
			});
			await waitFor(() => expect(workingChanges).toBeEnabled());
			fireEvent.click(workingChanges);

			const workingFiles = await screen.findByRole("list", {
				name: "Files in working changes",
			});
			const removedFileButton = within(workingFiles).getByRole("button");
			expect(removedFileButton).toHaveTextContent("removed-working-change.md");
			// Entering review opened nothing; choosing the removed file opens
			// its diff from history.
			{
				const main = sessionStateStore.getSnapshot()?.areas.main;
				const activeView = main?.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(activeView?.state?.fileId).toBeUndefined();
			}
			await act(async () => {
				fireEvent.click(removedFileButton);
			});
			await waitFor(() => {
				const main = sessionStateStore.getSnapshot()?.areas.main;
				const activeView = main?.views.find(
					(view) => view.instance === main.activeInstance,
				);
				expect(activeView?.state?.fileId).toBe(fileId);
				expect(activeView?.state?.beforeCommitId).toEqual(expect.any(String));
				expect(activeView?.state?.afterCommitId).toEqual(expect.any(String));
			});
			expect(
				await screen.findByTestId("markdown-review-editor"),
			).toHaveTextContent("Removed");
			expect(
				screen.getByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});

	test("Undo removes a newly added empty Markdown file from the review", async () => {
		const lix = await openLix();
		const reviewStatusStore = createMemoryReviewStatusStore();
		const atelier = createAtelier({ lix, reviewStatusStore });
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fakeUuid("seed-file"),
					path: "/seed.md",
					content: new TextEncoder().encode("# Seed\n"),
				})
				.execute();
			await createCheckpoint(lix);
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

			await openWorkingChangesFromHistory();
			const undoButton = await screen.findByRole("button", {
				name: /^Undo/,
			});
			fireEvent.click(undoButton);

			await waitFor(async () => {
				const file = await qb(lix)
					.selectFrom("lix_file")
					.select("id")
					.where("id", "=", fakeUuid("empty-agent-created-file"))
					.executeTakeFirst();
				expect(file).toBeUndefined();
			});
			await waitFor(() => {
				expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
			});
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});
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
			areas: {
				...DEFAULT_ATELIER_UI_STATE.areas,
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
				expect(state?.areas.left.views).toEqual([]);
			});

			// A stale snapshot can also arrive after extension discovery has settled.
			// It must be pruned from canonical state, not only hidden while rendering.
			act(() => sessionStateStore.setSnapshot(staleSessionState));
			await waitFor(() => {
				const state = sessionStateStore.getSnapshot();
				expect(state?.areas.left.views).toEqual([]);
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
			const restoredEntry = restoredState?.areas.left.views.find(
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
			focusedArea: "main" as const,
			areas: {
				left: {
					views: [{ instance: "files-default", kind: FILES_EXTENSION_KIND }],
					activeInstance: "files-default",
				},
				main: {
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
			layout: { sizes: { left: 20, main: 80, right: 0 } },
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
				expect(state?.focusedArea).toBe("left");
				// The empty right panel gains its History default at coerce time;
				// everything else persists exactly as it was.
				expect(state?.areas).toEqual({
					...initialState.areas,
					right: {
						views: [{ instance: "history-default", kind: "atelier_history" }],
						activeInstance: "history-default",
					},
				});
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

describe("a file the view cannot diff in place", () => {
	test("shows the checkpoint beside the working file", async () => {
		const lix = await openLix();
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: vi.fn(() => "blob:atelier-image"),
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: vi.fn(),
		});
		const atelier = createAtelier({
			lix,
			reviewStatusStore: createMemoryReviewStatusStore(),
			sessionStateStore: createMemorySessionStateStore(),
		});
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fakeUuid("review-shot"),
					path: "/shot.png",
					content: new Uint8Array([137, 80, 78, 71, 1]),
				})
				.execute();
			await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.where("id", "=", fakeUuid("review-shot"))
				.set({ content: new Uint8Array([137, 80, 78, 71, 2]) })
				.execute();
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<Suspense fallback={null}>
							<V2LayoutShell instance={atelier} />
						</Suspense>
					</LixProvider>,
				);
			});
			await openWorkingChangesFromHistory();
			await act(async () => {
				fireEvent.click(
					await screen.findByRole("button", { name: "Next changed file" }),
				);
			});

			// The image view draws both revisions itself: checkpoint left,
			// working file right.
			await waitFor(
				() =>
					expect(
						utils!.container.querySelectorAll("[data-diff-side]"),
					).toHaveLength(2),
				{ timeout: ASYNC_UI_TIMEOUT },
			);
			await waitFor(() => {
				expect(
					utils!.container.querySelector("[data-diff-side='before'] img"),
				).not.toBeNull();
				expect(
					utils!.container.querySelector("[data-diff-side='after'] img"),
				).not.toBeNull();
			});
			// The review keeps its verbs while the comparison is on screen.
			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
		} finally {
			await act(async () => utils?.unmount());
			await lix.close();
		}
	});
});
