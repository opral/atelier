import { Suspense } from "react";
import { describe, expect, test } from "vitest";
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
import { resolveLixFileForOpen, V2LayoutShell } from "./layout-shell";
import { KeyValueProvider } from "@/hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "@/hooks/key-value/schema";
import {
	fileExtensionInstanceForKind,
	FILES_EXTENSION_KIND,
} from "@/extension-runtime/extension-instance-helpers";
import { DEFAULT_ATELIER_UI_STATE } from "./ui-state";

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

describe("open file lifecycle", () => {
	test("moves the centered Files instance left when a document opens", async () => {
		const lix = await openLix();
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
							<V2LayoutShell />
						</Suspense>
					</KeyValueProvider>
				</LixProvider>,
			);
		});

		fireEvent.click(
			await screen.findByRole("button", { name: "Open /one.md" }),
		);
		expect(await screen.findByRole("heading", { name: "One" })).toBeVisible();
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
							central?: { views?: Array<{ kind?: string }> };
						};
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
		});

		await act(async () => {
			await qb(lix).deleteFrom("lix_file").where("id", "=", "two").execute();
		});

		await waitFor(() => {
			expect(screen.getByTestId("files-view-wide")).toBeVisible();
			expect(
				screen.getByRole("button", { name: "Toggle left panel" }),
			).toHaveAttribute("aria-pressed", "false");
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
				  }
				| undefined;
			expect(value?.panels?.left?.views).toEqual([]);
			expect(value?.panels?.central?.views).toEqual([
				expect.objectContaining({
					instance: "files-default",
					kind: FILES_EXTENSION_KIND,
				}),
			]);
		});

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
			await screen.findByRole("img", { name: "photo.jpeg" }),
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
