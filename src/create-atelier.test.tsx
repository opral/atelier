import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { qb } from "@/lib/lix-kysely";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { createAtelier } from "./atelier-instance";
import { Atelier } from "./create-atelier";
import type { AtelierExtensionRegistration } from "./extension-api";
import {
	fileExtensionInstanceForKind,
	FILES_EXTENSION_KIND,
} from "./extension-runtime/extension-instance-helpers";
import {
	createMemoryPreferencesStore,
	createMemorySessionStateStore,
} from "./state-adapters";

describe("Atelier instance file controller", () => {
	test("shows a visible fallback when the Atelier shell throws", async () => {
		const onError = vi.fn();
		let rendered: ReturnType<typeof render> | undefined;

		try {
			await act(async () => {
				rendered = render(
					<Atelier
						instance={{} as Parameters<typeof Atelier>[0]["instance"]}
						onError={onError}
					/>,
				);
			});

			expect(await screen.findByRole("alert")).toHaveTextContent(
				"Unable to render Atelier",
			);
			expect(onError).toHaveBeenCalledWith(
				expect.any(TypeError),
				expect.objectContaining({ componentStack: expect.any(String) }),
			);
		} finally {
			await act(async () => rendered?.unmount());
		}
	});

	test("opens working changes from the checkpoint pill", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({
			lix,
			sessionStateStore,
			defaultOpenPanels: ["left"],
		});
		let rendered: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fakeUuid("working-file"),
					path: "/working.md",
					content: new TextEncoder().encode("# Before\n"),
				})
				.execute();
			await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("# After\n") })
				.where("id", "=", fakeUuid("working-file"))
				.execute();

			await act(async () => {
				rendered = render(<Atelier instance={atelier} />);
			});
			const pill = await screen.findByRole("button", {
				name: "1 file changed since checkpoint. Review working changes",
			});
			await act(async () => {
				fireEvent.click(pill);
			});

			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			expect(screen.queryByText("Unable to render Atelier")).toBeNull();

			// The same pill closes the review it opened.
			const closePill = await screen.findByRole("button", {
				name: "1 file changed since checkpoint. Close review",
			});
			expect(closePill).toHaveAttribute("aria-pressed", "true");
			await act(async () => {
				fireEvent.click(closePill);
			});
			await waitFor(() => {
				expect(
					screen.queryByRole("button", { name: /^Checkpoint(ing…)?$/ }),
				).toBeNull();
			});
			expect(
				await screen.findByRole("button", {
					name: "1 file changed since checkpoint. Review working changes",
				}),
			).toHaveAttribute("aria-pressed", "false");
		} finally {
			await act(async () => rendered?.unmount());
			await lix.close();
		}
	});

	test("keeps the host home on screen when the pill opens review", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const HOME_EXTENSION_ID = "test_pill_home";
		const homeRegistration: AtelierExtensionRegistration = {
			id: HOME_EXTENSION_ID,
			name: "Home",
			placement: ["central"],
			hidden: true,
			icon: ({ className }: { className?: string }) => (
				<svg className={className} aria-hidden="true" />
			),
			Component: () => <div data-testid="test-pill-home">home</div>,
		};
		const atelier = createAtelier({
			lix,
			sessionStateStore,
			extensions: [homeRegistration],
			centralPanel: { home: { extensionId: HOME_EXTENSION_ID } },
		});
		let rendered: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fakeUuid("home-pill-working-file"),
					path: "/home-pill-working.md",
					content: new TextEncoder().encode("# Before\n"),
				})
				.execute();
			await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("# After\n") })
				.where("id", "=", fakeUuid("home-pill-working-file"))
				.execute();

			await act(async () => {
				rendered = render(<Atelier instance={atelier} />);
			});
			await screen.findByTestId("test-pill-home");
			const pill = await screen.findByRole("button", {
				name: "1 file changed since checkpoint. Review working changes",
			});
			await act(async () => {
				fireEvent.click(pill);
			});

			// Review mode is on, but the home listing stays the active view:
			// the user picks the file from it instead of being navigated away.
			expect(
				await screen.findByRole("button", { name: /^Checkpoint(ing…)?$/ }),
			).toBeVisible();
			expect(screen.getByTestId("test-pill-home")).toBeVisible();
			const central = sessionStateStore.getSnapshot()?.panels.central;
			expect(central?.views.map((view) => view.kind)).toEqual([
				HOME_EXTENSION_ID,
			]);
			expect(screen.queryByText("Reviewing home-pill-working.md")).toBeNull();

			await act(async () => {
				fireEvent.click(
					screen.getByRole("button", {
						name: "1 file changed since checkpoint. Close review",
					}),
				);
			});
			await waitFor(() => {
				expect(
					screen.queryByRole("button", { name: /^Checkpoint(ing…)?$/ }),
				).toBeNull();
			});
			expect(screen.getByTestId("test-pill-home")).toBeVisible();
		} finally {
			await act(async () => rendered?.unmount());
			await lix.close();
		}
	});

	test("opens a read-only working-changes review from the checkpoint pill", async () => {
		const lix = await openLix();
		const sessionStateStore = createMemorySessionStateStore();
		const atelier = createAtelier({
			lix,
			readOnly: true,
			sessionStateStore,
			defaultOpenPanels: ["left"],
		});
		let rendered: ReturnType<typeof render> | undefined;
		try {
			await qb(lix)
				.insertInto("lix_file")
				.values({
					id: fakeUuid("readonly-working-file"),
					path: "/readonly-working.md",
					content: new TextEncoder().encode("# Before\n"),
				})
				.execute();
			await createCheckpoint(lix);
			await qb(lix)
				.updateTable("lix_file")
				.set({ content: new TextEncoder().encode("# After\n") })
				.where("id", "=", fakeUuid("readonly-working-file"))
				.execute();

			await act(async () => {
				rendered = render(<Atelier instance={atelier} />);
			});
			const pill = await screen.findByRole("button", {
				name: "1 file changed since checkpoint. Review working changes",
			});
			await act(async () => {
				fireEvent.click(pill);
			});

			expect(
				await screen.findByRole("region", { name: "Checkpoint history" }),
			).toBeVisible();
			expect(
				await screen.findByRole("button", { name: "Working changes" }),
			).toBeEnabled();
			expect(await screen.findByRole("button", { name: "Exit" })).toBeVisible();
			expect(screen.queryByRole("button", { name: /^Checkpoint$/ })).toBeNull();
			expect(screen.queryByRole("button", { name: /^Keep$/ })).toBeNull();
			expect(screen.queryByText("Unable to render Atelier")).toBeNull();
		} finally {
			await act(async () => rendered?.unmount());
			await lix.close();
		}
	});

	test("keeps panels collapsed when the host does not open them by default", async () => {
		const lix = await openLix();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("focused-file"),
				path: "/focused.md",
				content: new TextEncoder().encode("# Focused\n"),
			})
			.execute();
		const atelier = createAtelier({
			lix,
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

			await waitFor(() => {
				expect(screen.getByRole("heading", { name: "Focused" })).toBeVisible();
			});
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
			.values({ path: "/docs" } as any)
			.execute();
		await qb(lix)
			.insertInto("lix_file")
			.values({
				id: fakeUuid("queued-file"),
				path: "/docs/queued.md",
				content: new TextEncoder().encode("# Queued\n"),
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

			await waitFor(() => {
				expect(screen.getByRole("heading", { name: "Queued" })).toBeVisible();
			});
			await waitFor(() => {
				expect(
					rendered?.container.querySelector("file-tree-container"),
				).toBeTruthy();
			});
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
		const fileId = fakeUuid("active-file");
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
				content: new TextEncoder().encode("# Active\n"),
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
			await waitFor(() => {
				expect(screen.getByRole("heading", { name: "Active" })).toBeVisible();
			});
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
					id: fakeUuid("root-first"),
					path: "/first.md",
					content: new TextEncoder().encode("# First\n"),
				},
				{
					id: fakeUuid("root-second"),
					path: "/second.md",
					content: new TextEncoder().encode("# Second\n"),
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
					id: fakeUuid("path-first"),
					path: "/first.md",
					content: new TextEncoder().encode("# First\n"),
				},
				{
					id: fakeUuid("path-second"),
					path: "/second.md",
					content: new TextEncoder().encode("# Second\n"),
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
			await waitFor(() => {
				expect(screen.getByRole("heading", { name: "Second" })).toBeVisible();
			});

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
