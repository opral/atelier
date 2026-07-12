import { Suspense } from "react";
import { describe, expect, test, vi } from "vitest";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { qb } from "@/lib/lix-kysely";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import {
	resolveLixFileForOpen,
	syncPanelGroupLayout,
	V2LayoutShell,
} from "./layout-shell";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import {
	fileExtensionInstanceForKind,
	FILES_EXTENSION_KIND,
} from "@/extension-runtime/extension-instance-helpers";
import { DEFAULT_ATELIER_UI_STATE } from "./ui-state";
import { createAtelier } from "../atelier-instance";

describe("resolveLixFileForOpen", () => {
	test("resolves normalized paths from Lix", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "readme",
				path: "/docs/README.md",
				data: new TextEncoder().encode("# README\n"),
			})
			.execute();

		await expect(
			resolveLixFileForOpen({ lix, filePath: "docs/./README.md" }),
		).resolves.toEqual({ id: "readme", path: "/docs/README.md" });
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

describe("open file lifecycle", () => {
	test("moves the centered Files instance left when a document opens", async () => {
		const lix = await openLix();
		const onEvent = vi.fn();
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: "one",
					path: "/one.md",
					data: new TextEncoder().encode("# One\n"),
				},
				{
					id: "two",
					path: "/two.md",
					data: new TextEncoder().encode("# Two\n"),
				},
			])
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<V2LayoutShell onEvent={onEvent} />
						</Suspense>
					</KeyValueProvider>
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
		await waitFor(() => {
			expect(screen.queryByTestId("files-view-wide")).toBeNull();
			expect(screen.getAllByTestId("files-view-tree-scroll")).toHaveLength(1);
		});

		const fileTree = document.querySelector<HTMLElement>(
			'[aria-label="Files"]',
		);
		expect(fileTree).toBeTruthy();
		const secondFile = fileTree.shadowRoot?.querySelector<HTMLElement>(
			'[data-item-path="two.md"]',
		);
		expect(secondFile).toBeTruthy();
		fireEvent.click(secondFile!);
		expect(await screen.findByRole("heading", { name: "Two" })).toBeVisible();
		expect(screen.getAllByTestId("files-view-tree-scroll")).toHaveLength(1);

		await waitFor(async () => {
			const row = await qb(lix)
				.selectFrom("lix_key_value_by_branch")
				.select("value")
				.where("key", "=", "atelier_ui_state")
				.executeTakeFirst();
			const value = row?.value as
				| {
						panels?: {
							left?: { views?: Array<{ kind?: string }> };
							central?: {
								views?: Array<{
									kind?: string;
									state?: { fileId?: string };
								}>;
							};
						};
						layout?: { sizes?: { left?: number } };
				  }
				| undefined;
			expect(value?.panels?.left?.views).toEqual([
				expect.objectContaining({ kind: FILES_EXTENSION_KIND }),
			]);
			expect(
				value?.panels?.central?.views?.some(
					(view) => view.kind === FILES_EXTENSION_KIND,
				),
			).toBe(false);
			expect(value?.panels?.central?.views).toEqual([
				expect.objectContaining({
					state: expect.objectContaining({ fileId: "two" }),
				}),
			]);
			expect(value?.layout?.sizes?.left).toBeGreaterThan(0);
		});

		await act(async () => {
			await qb(lix).deleteFrom("lix_file").where("id", "=", "two").execute();
		});

		await waitFor(() => {
			expect(screen.getByTestId("files-view-wide")).toBeVisible();
			expect(
				screen.getByRole("button", { name: "Toggle left panel" }),
			).toHaveAttribute("aria-pressed", "false");
			expect(
				document.activeElement ===
					screen.getByRole("button", { name: "New file" }) ||
					document.activeElement?.getAttribute("aria-label") === "Files",
			).toBe(true);
		});
		await waitFor(async () => {
			const row = await qb(lix)
				.selectFrom("lix_key_value_by_branch")
				.select("value")
				.where("key", "=", "atelier_ui_state")
				.executeTakeFirst();
			const value = row?.value as
				| {
						panels?: {
							left?: { views?: Array<{ instance?: string; kind?: string }> };
							central?: {
								views?: Array<{ instance?: string; kind?: string }>;
							};
						};
						layout?: { sizes?: { left?: number } };
				  }
				| undefined;
			expect(value?.panels?.left?.views).toEqual([]);
			expect(value?.panels?.central?.views).toEqual([
				expect.objectContaining({
					instance: "files-default",
					kind: FILES_EXTENSION_KIND,
				}),
			]);
			expect(value?.layout?.sizes?.left).toBe(0);
		});

		const leftToggle = screen.getByRole("button", {
			name: "Toggle left panel",
		});
		fireEvent.click(leftToggle);
		await waitFor(() => {
			expect(leftToggle).toHaveAttribute("aria-pressed", "true");
		});
		fireEvent.click(leftToggle);

		await act(async () => utils?.unmount());
		await lix.close();
	});

	test("restores centered Files when the last open file is deleted", async () => {
		const fileId = "file_generic";
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
		const lix = await openLix({
			keyValues: [
				{
					key: "atelier_ui_state",
					value: {
						...DEFAULT_ATELIER_UI_STATE,
						focusedPanel: "right",
						panels: {
							...DEFAULT_ATELIER_UI_STATE.panels,
							central: {
								views: [
									{
										instance,
										kind: imageKind,
										state: {
											fileId,
											filePath: "/photo.jpeg",
										},
									},
								],
								activeInstance: instance,
							},
						},
						layout: { sizes: { left: 10, central: 55, right: 35 } },
					},
					lixcol_branch_id: "global",
					lixcol_global: true,
					lixcol_untracked: true,
				},
				{
					key: "atelier_active_file_id",
					value: fileId,
					lixcol_branch_id: "global",
					lixcol_global: true,
					lixcol_untracked: true,
				},
			],
		});
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/photo.jpeg",
				data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
			})
			.execute();

		let utils: ReturnType<typeof render> | undefined;
		await act(async () => {
			utils = render(
				<LixProvider lix={lix}>
					<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
						<Suspense fallback={null}>
							<V2LayoutShell />
						</Suspense>
					</KeyValueProvider>
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
			expect(screen.getByTestId("files-view-wide")).toBeInTheDocument();
			expect(screen.queryByTestId("central-panel-empty-state")).toBeNull();
			expect(screen.queryByRole("img", { name: "photo.jpeg" })).toBeNull();
		});
		await waitFor(async () => {
			const activeFile = await qb(lix)
				.selectFrom("lix_key_value_by_branch")
				.select("value")
				.where("key", "=", "atelier_active_file_id")
				.executeTakeFirst();
			expect(activeFile?.value ?? null).toBeNull();
		});
		await waitFor(async () => {
			const row = await qb(lix)
				.selectFrom("lix_key_value_by_branch")
				.select("value")
				.where("key", "=", "atelier_ui_state")
				.where("lixcol_branch_id", "=", "global")
				.executeTakeFirst();
			const state = row?.value as typeof DEFAULT_ATELIER_UI_STATE | undefined;
			expect(state?.panels.central).toEqual({
				views: [
					expect.objectContaining({
						instance: "files-default",
						kind: FILES_EXTENSION_KIND,
					}),
				],
				activeInstance: "files-default",
			});
			expect(state?.focusedPanel).toBe("central");
			expect(state?.layout?.sizes).toEqual({
				left: 10,
				central: 55,
				right: 35,
			});
		});

		await act(async () => {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: "next-file",
					path: "/next.md",
					data: new TextEncoder().encode("# Next\n"),
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
		const host = screen.getByLabelText("Files");
		const item = host.shadowRoot?.querySelector(
			`[data-type='item'][data-item-path='${CSS.escape(path)}']`,
		);
		if (!(item instanceof HTMLElement)) {
			throw new Error(`file tree item not found: ${path}`);
		}
		return item;
	});
}

describe("agent turn review reveal", () => {
	test("opens the first changed file once when a review range appears", async () => {
		const lix = await openLix();
		const onEvent = vi.fn();
		let utils: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values([
					{
						id: "stable-file",
						path: "/stable.md",
						data: new TextEncoder().encode("# Stable\n"),
					},
					{
						id: "changed-file",
						path: "/changed.md",
						data: new TextEncoder().encode("# Before\n"),
					},
				])
				.execute();
			const beforeCommitId = await activeCommitId(lix);

			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
							<Suspense fallback={null}>
								<V2LayoutShell onEvent={onEvent} />
							</Suspense>
						</KeyValueProvider>
					</LixProvider>,
				);
			});
			fireEvent.click(await findFilesTreeItem("stable.md"));
			expect(
				await screen.findByRole("heading", { name: "Stable" }),
			).toBeVisible();

			await act(async () => {
				await qb(lix)
					.updateTable("lix_file")
					.set({ data: new TextEncoder().encode("# After\n") })
					.where("id", "=", "changed-file")
					.execute();
			});
			const afterCommitId = await activeCommitId(lix);

			await act(async () => {
				await createAtelier({ lix }).diff.open({
					beforeCommitId,
					afterCommitId,
					source: { id: "claude" },
				});
			});

			expect(
				await screen.findByRole("button", { name: /^Keep/ }),
			).toBeVisible();
			expect(
				onEvent.mock.calls.filter(
					([event]) =>
						event.type === "document_viewed" &&
						event.filePath === "/changed.md",
				),
			).toHaveLength(1);

			fireEvent.click(screen.getByRole("button", { name: /^Keep/ }));
			await waitFor(() => {
				expect(screen.queryByRole("button", { name: /^Keep/ })).toBeNull();
			});

			const fileTree = document.querySelector<HTMLElement>(
				'[aria-label="Files"]',
			);
			const stableFile = fileTree?.shadowRoot?.querySelector<HTMLElement>(
				'[data-item-path="stable.md"]',
			);
			expect(stableFile).toBeTruthy();
			fireEvent.click(stableFile!);
			expect(
				await screen.findByRole("heading", { name: "Stable" }),
			).toBeVisible();
			expect(
				onEvent.mock.calls.filter(
					([event]) =>
						event.type === "document_viewed" &&
						event.filePath === "/changed.md",
				),
			).toHaveLength(1);
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

		const lix = await openLix({
			keyValues: [
				{
					key: "atelier_ui_state",
					value: {
						...DEFAULT_ATELIER_UI_STATE,
						panels: {
							...DEFAULT_ATELIER_UI_STATE.panels,
							left: {
								views: [{ instance: extensionInstance, kind: extensionKind }],
								activeInstance: extensionInstance,
							},
						},
					},
					lixcol_branch_id: "global",
					lixcol_global: true,
					lixcol_untracked: true,
				},
			],
		});
		let utils: ReturnType<typeof render> | undefined;
		try {
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
							<Suspense fallback={null}>
								<V2LayoutShell />
							</Suspense>
						</KeyValueProvider>
					</LixProvider>,
				);
			});

			await waitFor(async () => {
				const row = await qb(lix)
					.selectFrom("lix_key_value")
					.select("value")
					.where("key", "=", "atelier_ui_state")
					.executeTakeFirst();
				const state = row?.value as typeof DEFAULT_ATELIER_UI_STATE | undefined;
				expect(state?.panels.left.views).toEqual([]);
			});

			// A stale snapshot can also arrive after extension discovery has settled.
			// It must be pruned from canonical state, not only hidden while rendering.
			await act(async () => {
				await qb(lix)
					.updateTable("lix_key_value")
					.set({
						value: {
							...DEFAULT_ATELIER_UI_STATE,
							panels: {
								...DEFAULT_ATELIER_UI_STATE.panels,
								left: {
									views: [
										{
											instance: extensionInstance,
											kind: extensionKind,
										},
									],
									activeInstance: extensionInstance,
								},
							},
						},
					})
					.where("key", "=", "atelier_ui_state")
					.execute();
			});
			await waitFor(async () => {
				const row = await qb(lix)
					.selectFrom("lix_key_value")
					.select("value")
					.where("key", "=", "atelier_ui_state")
					.executeTakeFirst();
				const state = row?.value as typeof DEFAULT_ATELIER_UI_STATE | undefined;
				expect(state?.panels.left.views).toEqual([]);
			});

			await act(async () => {
				await qb(lix)
					.insertInto("lix_file")
					.values([
						{
							path: "/.lix/app_data/atelier/extensions/recovered/manifest.json",
							data: new TextEncoder().encode(
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
							data: new TextEncoder().encode("export default {}"),
						},
					])
					.execute();
			});
			await waitFor(() => expect(createObjectUrl).toHaveBeenCalledTimes(1));
			await act(async () => {
				await new Promise((resolve) => window.setTimeout(resolve, 50));
			});

			expect(screen.queryByText("Recovered Extension")).toBeNull();
			expect(screen.queryByText("Recovered extension content")).toBeNull();
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
		const fileId = "focus-file";
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
		const lix = await openLix({
			keyValues: [
				{
					key: "atelier_ui_state",
					value: initialState,
					lixcol_branch_id: "global",
					lixcol_global: true,
					lixcol_untracked: true,
				},
			],
		});
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: "/focus.md",
				data: new TextEncoder().encode("# Focus\n"),
			})
			.execute();
		let utils: ReturnType<typeof render> | undefined;
		try {
			await act(async () => {
				utils = render(
					<LixProvider lix={lix}>
						<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
							<Suspense fallback={null}>
								<V2LayoutShell />
							</Suspense>
						</KeyValueProvider>
					</LixProvider>,
				);
			});

			fireEvent.click(await screen.findByRole("button", { name: "Files" }));

			await waitFor(async () => {
				const row = await qb(lix)
					.selectFrom("lix_key_value_by_branch")
					.select("value")
					.where("key", "=", "atelier_ui_state")
					.where("lixcol_branch_id", "=", "global")
					.executeTakeFirst();
				const state = row?.value as typeof initialState | undefined;
				expect(state?.focusedPanel).toBe("left");
				expect(state?.panels).toEqual(initialState.panels);
				expect(state?.layout?.sizes).toEqual(initialState.layout.sizes);
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
