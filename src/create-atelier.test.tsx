import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { createAtelier } from "./atelier-instance";
import { Atelier } from "./create-atelier";
import {
	fileExtensionInstanceForKind,
	FILES_EXTENSION_KIND,
} from "./extension-runtime/extension-instance-helpers";
import {
	createMemoryPreferencesStore,
	createMemorySessionStateStore,
} from "./state-adapters";

describe("Atelier instance file controller", () => {
	test("keeps sidebar-mode panels collapsed when the host does not open them by default", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: "focused-file",
				path: "/focused.md",
				data: new TextEncoder().encode("# Focused\n"),
			})
			.execute();
		const atelier = createAtelier({
			lix,
			filesViewMode: "sidebar",
			defaultOpenPanels: [],
		});
		const queuedOpen = atelier.documents.open("/focused.md");
		let rendered: ReturnType<typeof render> | undefined;

		try {
			await act(async () => {
				rendered = render(<Atelier instance={atelier} />);
			});
			await waitFor(() => {
				expect(
					rendered?.container.querySelector(".atelier-panel-group"),
				).toBeTruthy();
			});
			await act(async () => queuedOpen);

			expect(
				await screen.findByRole("heading", { name: "Focused" }),
			).toBeVisible();
			expect(
				screen.getByRole("button", { name: "Toggle left panel" }),
			).toHaveAttribute("aria-pressed", "false");
			expect(
				screen.getByRole("button", { name: "Toggle right panel" }),
			).toHaveAttribute("aria-pressed", "false");
		} finally {
			await act(async () => rendered?.unmount());
			await lix.close();
		}
	});

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
		const queuedOpen = atelier.documents.open("/docs/queued.md");
		let rendered: ReturnType<typeof render> | undefined;

		try {
			await act(async () => {
				rendered = render(<Atelier instance={atelier} />);
			});
			await waitFor(() => {
				expect(
					rendered?.container.querySelector(".atelier-panel-group"),
				).toBeTruthy();
			});
			await act(async () => queuedOpen);

			expect(
				await screen.findByRole("heading", { name: "Queued" }),
			).toBeVisible();
			await act(async () => atelier.documents.startNew());
			const container = rendered?.container;
			if (!container) throw new Error("Atelier test container is unavailable");
			const input = await findFilesViewRenameInput(container);
			await waitFor(() => {
				expect(input.value).toBe(".md");
				expect(input.selectionStart).toBe(0);
				expect(input.selectionEnd).toBe(0);
			});
			await waitFor(() => {
				expect((input.getRootNode() as ShadowRoot).activeElement).toBe(input);
			});
			fireEvent.input(input, { target: { value: "follow-up.md" } });
			fireEvent.keyDown(input, { key: "Enter" });

			await waitFor(async () => {
				const created = await qb(lix)
					.selectFrom("lix_file")
					.select("path")
					.where("path", "=", "/docs/follow-up.md")
					.executeTakeFirst();
				expect(created).toEqual({ path: "/docs/follow-up.md" });
			});
			await expect(
				qb(lix)
					.selectFrom("lix_file")
					.select("path")
					.where("path", "=", "/follow-up.md")
					.executeTakeFirst(),
			).resolves.toBeUndefined();

			await act(async () => atelier.documents.closeActive());
		} finally {
			await act(async () => rendered?.unmount());
			await lix.close();
		}
	});

	test("falls back to direct creation when the Files view is collapsed", async () => {
		const fileId = "active-file";
		const filePath = "/active.md";
		const documentKind = "atelier_file";
		const documentInstance = fileExtensionInstanceForKind(documentKind, fileId);
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore({
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
		});
		const preferencesStore = createMemoryPreferencesStore({
			version: 1,
			layout: { sizes: { left: 0, central: 100, right: 0 } },
		});
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fileId,
				path: filePath,
				data: new TextEncoder().encode("# Active\n"),
			})
			.execute();
		const atelier = createAtelier({
			lix,
			sessionStateStore,
			preferencesStore,
		});
		let rendered: ReturnType<typeof render> | undefined;

		try {
			await act(async () => {
				rendered = render(<Atelier instance={atelier} />);
			});
			expect(
				await screen.findByRole("heading", { name: "Active" }),
			).toBeVisible();
			await act(async () => atelier.documents.startNew());

			await waitFor(async () => {
				const created = await qb(lix)
					.selectFrom("lix_file")
					.select("path")
					.where("path", "=", "/new-file.md")
					.executeTakeFirst();
				expect(created).toEqual({ path: "/new-file.md" });
			});
		} finally {
			await act(async () => rendered?.unmount());
			await lix.close();
		}
	});

	test("closes every central document when the workspace root takes control", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: "root-first",
					path: "/first.md",
					data: new TextEncoder().encode("# First\n"),
				},
				{
					id: "root-second",
					path: "/second.md",
					data: new TextEncoder().encode("# Second\n"),
				},
			])
			.execute();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({ lix, sessionStateStore });
		let rendered: ReturnType<typeof render> | undefined;

		try {
			await act(async () => {
				rendered = render(<Atelier instance={atelier} />);
			});
			await waitFor(() => {
				expect(
					rendered?.container.querySelector(".atelier-panel-group"),
				).toBeTruthy();
			});
			await act(async () => atelier.documents.open("/first.md"));
			await act(async () => atelier.documents.open("/second.md"));
			await act(async () => atelier.documents.closeAll());

			await waitFor(() => {
				const centralViews =
					sessionStateStore.getSnapshot()?.panels.central.views ?? [];
				expect(
					centralViews.filter((view) => typeof view.state?.fileId === "string"),
				).toEqual([]);
			});
		} finally {
			await act(async () => rendered?.unmount());
			await lix.close();
		}
	});

	test("closes a background document by path without touching the active one", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: "path-first",
					path: "/first.md",
					data: new TextEncoder().encode("# First\n"),
				},
				{
					id: "path-second",
					path: "/second.md",
					data: new TextEncoder().encode("# Second\n"),
				},
			])
			.execute();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({ lix, sessionStateStore });
		let rendered: ReturnType<typeof render> | undefined;

		try {
			await act(async () => {
				rendered = render(<Atelier instance={atelier} />);
			});
			await waitFor(() => {
				expect(
					rendered?.container.querySelector(".atelier-panel-group"),
				).toBeTruthy();
			});
			await act(async () => atelier.documents.open("/first.md"));
			await act(async () => atelier.documents.open("/second.md"));
			await act(async () => atelier.documents.close("/first.md"));

			await waitFor(() => {
				const centralViews =
					sessionStateStore.getSnapshot()?.panels.central.views ?? [];
				const documentPaths = centralViews
					.map((view) => view.state?.filePath)
					.filter((path): path is string => typeof path === "string");
				expect(documentPaths).toEqual(["/second.md"]);
			});
			expect(
				await screen.findByRole("heading", { name: "Second" }),
			).toBeVisible();

			// Closing a path with no open views resolves as a no-op.
			await act(async () => atelier.documents.close("/missing.md"));
		} finally {
			await act(async () => rendered?.unmount());
			await lix.close();
		}
	});
});

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
