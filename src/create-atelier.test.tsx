import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { SqlParam } from "@lix-js/sdk";
import { FolderClock } from "lucide-react";
import { describe, expect, test } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import type {
	AtelierExtensionRegistration,
	AtelierExtensionRuntime,
} from "./extension-api";
import { createAtelier } from "./atelier-instance";
import { Atelier } from "./create-atelier";
import {
	fileExtensionInstanceForKind,
	FILES_EXTENSION_KIND,
} from "./extension-runtime/extension-instance-helpers";
import { DEFAULT_ATELIER_UI_STATE } from "./shell/ui-state";

describe("Atelier instance file controller", () => {
	test("drains pre-mount commands and starts a folder-relative Files draft", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_directory")
			.values({ path: "/docs/" } as any)
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "queued-file",
				path: "/docs/queued.md",
				data: new TextEncoder().encode("# Queued\n"),
			})
			.execute();
		const atelier = createAtelier({ lix });
		const queuedOpen = atelier.files.open("/docs/queued.md");
		const snapshots: unknown[] = [];
		const unsubscribe = atelier.files.subscribe(() => {
			snapshots.push(atelier.files.getSnapshot());
		});
		let rendered: ReturnType<typeof render> | undefined;

		try {
			expect(atelier.files.getSnapshot()).toEqual({
				ready: false,
				active: null,
				open: [],
			});
			await act(async () => {
				rendered = render(<Atelier instance={atelier} />);
			});
			await waitFor(() => {
				expect(atelier.files.getSnapshot().ready).toBe(true);
			});
			await act(async () => queuedOpen);

			expect(
				await screen.findByRole("heading", { name: "Queued" }),
			).toBeVisible();
			await waitFor(() => {
				expect(atelier.files.getSnapshot()).toEqual({
					ready: true,
					active: "/docs/queued.md",
					open: ["/docs/queued.md"],
				});
			});

			await act(async () => atelier.files.create());
			const container = rendered?.container;
			if (!container) throw new Error("Atelier test container is unavailable");
			const input = await findFilesViewRenameInput(container);
			expect(input.value).toBe("new-file");
			await waitFor(() => {
				expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
			});
			fireEvent.input(input, { target: { value: "follow-up" } });
			fireEvent.keyDown(input, { key: "Enter" });

			await waitFor(async () => {
				const created = await qb(lix)
					.selectFrom("lix_file")
					.select("path")
					.where("path", "=", "/docs/follow-up.md")
					.executeTakeFirst();
				expect(created).toEqual({ path: "/docs/follow-up.md" });
			});
			await waitFor(() => {
				expect(atelier.files.getSnapshot()).toEqual({
					ready: true,
					active: "/docs/follow-up.md",
					open: ["/docs/follow-up.md"],
				});
			});
			await expect(
				qb(lix)
					.selectFrom("lix_file")
					.select("path")
					.where("path", "=", "/follow-up.md")
					.executeTakeFirst(),
			).resolves.toBeUndefined();

			await act(async () => atelier.files.closeActive());
			await waitFor(() => {
				expect(atelier.files.getSnapshot()).toEqual({
					ready: true,
					active: null,
					open: [],
				});
			});
			expect(snapshots.length).toBeGreaterThan(2);
		} finally {
			unsubscribe();
			await act(async () => rendered?.unmount());
			expect(atelier.files.getSnapshot().ready).toBe(false);
			await lix.close();
		}
	});

	test("falls back to direct creation when the Files view is collapsed", async () => {
		const fileId = "active-file";
		const filePath = "/active.md";
		const documentKind = "atelier_file";
		const documentInstance = fileExtensionInstanceForKind(documentKind, fileId);
		const lix = await openLix({
			keyValues: [
				atelierUiStateKeyValue({
					...DEFAULT_ATELIER_UI_STATE,
					focusedPanel: "central",
					panels: {
						left: {
							views: [{ instance: "files-left", kind: FILES_EXTENSION_KIND }],
							activeInstance: "files-left",
						},
						central: {
							views: [
								{
									instance: documentInstance,
									kind: documentKind,
									state: { fileId, filePath },
								},
							],
							activeInstance: documentInstance,
						},
						right: { views: [], activeInstance: null },
					},
					layout: { sizes: { left: 0, central: 100, right: 0 } },
				}),
			],
		});
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: filePath,
				data: new TextEncoder().encode("# Active\n"),
			})
			.execute();
		const atelier = createAtelier({ lix });
		let rendered: ReturnType<typeof render> | undefined;

		try {
			await act(async () => {
				rendered = render(<Atelier instance={atelier} />);
			});
			await waitFor(() => expect(atelier.files.getSnapshot().ready).toBe(true));
			await act(async () => atelier.files.create());

			await waitFor(() => {
				expect(atelier.files.getSnapshot()).toEqual({
					ready: true,
					active: "/new-file.md",
					open: ["/new-file.md"],
				});
			});
		} finally {
			await act(async () => rendered?.unmount());
			await lix.close();
		}
	});
});

describe("host built-in overrides", () => {
	test("mounts an exact-id History override with public revision controls", async () => {
		const historyInstance = "host-history";
		const lix = await openLix({
			keyValues: [
				atelierUiStateKeyValue({
					...DEFAULT_ATELIER_UI_STATE,
					panels: {
						...DEFAULT_ATELIER_UI_STATE.panels,
						left: {
							views: [
								{
									instance: historyInstance,
									kind: "atelier_history",
								},
							],
							activeInstance: historyInstance,
						},
					},
					layout: { sizes: { left: 20, central: 80, right: 0 } },
				}),
			],
		});
		let mountedRuntime: AtelierExtensionRuntime | null = null;
		const historyOverride: AtelierExtensionRegistration = {
			manifest: {
				apiVersion: 1,
				id: "atelier_history",
				name: "FlashType History",
				entry: "./history.js",
			},
			runtime: {
				icon: FolderClock,
				mount: ({ atelier, element }) => {
					mountedRuntime = atelier;
					element.textContent = "FlashType history mounted";
				},
			},
		};
		const atelier = createAtelier({
			lix,
			extensions: [historyOverride],
		});
		let rendered: ReturnType<typeof render> | undefined;

		try {
			await act(async () => {
				rendered = render(<Atelier instance={atelier} />);
			});
			await waitFor(() => expect(mountedRuntime).not.toBeNull());
			const revisions = (mountedRuntime as unknown as AtelierExtensionRuntime)
				.revisions;
			expect(revisions.current).toBeNull();
			expect(revisions.show).toEqual(expect.any(Function));
			expect(revisions.clear).toEqual(expect.any(Function));
		} finally {
			await act(async () => rendered?.unmount());
			await lix.close();
		}
	});
});

function atelierUiStateKeyValue(value: unknown) {
	return {
		key: "atelier_ui_state",
		value: value as SqlParam,
		lixcol_branch_id: "global",
		lixcol_global: true,
		lixcol_untracked: true,
	};
}

async function findFilesViewRenameInput(
	container: HTMLElement,
): Promise<HTMLInputElement> {
	return waitFor(() => {
		for (const host of container.querySelectorAll<HTMLElement>(
			"file-tree-container",
		)) {
			const input = host.shadowRoot?.querySelector("[data-item-rename-input]");
			if (input instanceof HTMLInputElement) return input;
		}
		throw new Error("Files view rename input not found");
	});
}
