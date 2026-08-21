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
import { fakeUuid } from "@/test-utils/fake-uuid";
import { V2LayoutShell } from "./layout-shell";
import { createAtelier } from "../atelier-instance";
import { createMemorySessionStateStore } from "../state-adapters";
import {
	CSV_EXTENSION_KIND,
	fileExtensionInstanceForKind,
} from "../extension-runtime/extension-instance-helpers";
import type {
	AtelierEvent,
	AtelierExtensionRegistration,
} from "../extension-api";

const HOME_EXTENSION_ID = "test_home";
const DIR_EXTENSION_ID = "test_dir";

const TabIcon = ({ className }: { className?: string }) => (
	<svg className={className} aria-hidden="true" />
);

const homeRegistration: AtelierExtensionRegistration = {
	manifest: {
		apiVersion: 1,
		id: HOME_EXTENSION_ID,
		name: "Home",
		placement: ["central"],
		hidden: true,
	},
	entry: {
		icon: TabIcon,
		mount: ({ element }) => {
			const view = document.createElement("div");
			view.dataset.testid = "test-home-view";
			view.textContent = "workspace home";
			element.appendChild(view);
		},
	},
};

const dirRegistration: AtelierExtensionRegistration = {
	manifest: {
		apiVersion: 1,
		id: DIR_EXTENSION_ID,
		name: "Folder",
		placement: ["central"],
		hidden: true,
		multiInstance: true,
	},
	entry: {
		icon: TabIcon,
		mount: ({ element, view }) => {
			const node = document.createElement("div");
			node.dataset.testid = "test-dir-view";
			node.textContent = `folder:${String(view.state.path ?? "")}`;
			element.appendChild(node);
			return {
				update: ({ view: nextView }) => {
					node.textContent = `folder:${String(nextView.state.path ?? "")}`;
				},
			};
		},
	},
};

const SIDE_EXTENSION_ID = "test_side_tool";

const sideToolExtension: AtelierExtensionRegistration = {
	manifest: {
		apiVersion: 1,
		id: SIDE_EXTENSION_ID,
		name: "Side Tool",
		description: "A removable side-panel view.",
		placement: ["left", "right"],
	},
	entry: {
		icon: TabIcon,
		mount: ({ element }) => {
			const view = document.createElement("div");
			view.dataset.testid = "test-side-tool";
			view.textContent = "side tool";
			element.appendChild(view);
			return {};
		},
	},
};

const extensions = [homeRegistration, dirRegistration, sideToolExtension];

async function renderTabbedShell(
	options: {
		slots?: import("../create-atelier").AtelierSlots;
	} = {},
) {
	const lix = await openLix();
	const events: AtelierEvent[] = [];
	const onEvent = vi.fn((event: AtelierEvent) => {
		events.push(event);
	});
	const sessionStateStore = createMemorySessionStateStore();
	const atelier = createAtelier({
		lix,
		onEvent,
		extensions,
		sessionStateStore,
		centralPanel: {
			home: { extensionId: HOME_EXTENSION_ID },
		},
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
			{
				id: fakeUuid("three"),
				path: "/three.md",
				content: new TextEncoder().encode("# Three\n"),
			},
		])
		.execute();
	let utils: ReturnType<typeof render> | undefined;
	await act(async () => {
		utils = render(
			<LixProvider lix={lix}>
				<Suspense fallback={null}>
					<V2LayoutShell
						instance={atelier}
						extensions={extensions}
						onEvent={onEvent}
						slots={options.slots}
					/>
				</Suspense>
			</LixProvider>,
		);
	});
	// The shell mounts (and binds the documents runtime) asynchronously;
	// wait for the pinned home before driving the instance APIs.
	await screen.findByTestId("test-home-view");
	return {
		lix,
		atelier,
		events,
		sessionStateStore,
		cleanup: async () => {
			await act(async () => utils?.unmount());
			await lix.close();
		},
	};
}

const centralTabButtons = () =>
	Array.from(
		document.querySelectorAll<HTMLButtonElement>(
			'header [data-slot="central-tab-strip"] button[data-view-instance]',
		),
	);

const centralTabLabels = () =>
	centralTabButtons().map((button) =>
		button.dataset.viewKey === HOME_EXTENSION_ID
			? "«home»"
			: (button.textContent ?? ""),
	);

describe("central tabs with a pinned home", () => {
	test("mounts the pinned home as the only tab and shows its view", async () => {
		const shell = await renderTabbedShell();
		try {
			expect(await screen.findByTestId("test-home-view")).toBeVisible();
			const tabs = centralTabButtons();
			expect(tabs).toHaveLength(1);
			expect(tabs[0]?.dataset.viewKey).toBe(HOME_EXTENSION_ID);
			expect(tabs[0]?.dataset.pinned).toBe("true");
			// The pinned tab exposes no close affordance.
			expect(
				tabs[0]?.querySelector('[data-attr="panel-tab-close"]'),
			).toBeNull();
		} finally {
			await shell.cleanup();
		}
	});

	test("documents.open navigates the single content tab in place", async () => {
		const shell = await renderTabbedShell();
		try {
			await act(async () => {
				await shell.atelier.documents.open("/one.md");
			});
			expect(await screen.findByRole("heading", { name: "One" })).toBeVisible();
			expect(centralTabLabels()).toEqual(["«home»", "one.md"]);

			await act(async () => {
				await shell.atelier.documents.open("/two.md");
			});
			expect(await screen.findByRole("heading", { name: "Two" })).toBeVisible();
			// Still one content tab: the label followed the location.
			expect(centralTabLabels()).toEqual(["«home»", "two.md"]);
		} finally {
			await shell.cleanup();
		}
	});

	test("observed file renames update the tab and notify host routing", async () => {
		const shell = await renderTabbedShell();
		try {
			await act(async () => {
				await shell.atelier.documents.open("/one.md");
			});
			expect(centralTabLabels()).toEqual(["«home»", "one.md"]);

			await act(async () => {
				await qb(shell.lix)
					.updateTable("lix_file")
					.set({ path: "/renamed.md" })
					.where("id", "=", fakeUuid("one"))
					.execute();
			});

			await waitFor(() => {
				expect(centralTabLabels()).toEqual(["«home»", "renamed.md"]);
			});
			await waitFor(() => {
				expect(
					shell.events
						.filter((event) => event.type === "central_view_activated")
						.at(-1),
				).toMatchObject({
					filePath: "/renamed.md",
				});
			});
			expect(
				shell.sessionStateStore.getSnapshot()?.panels.central.views[1]?.state,
			).toMatchObject({
				fileId: fakeUuid("one"),
				filePath: "/renamed.md",
				atelier: { label: "renamed.md" },
			});

			await act(async () => {
				await qb(shell.lix)
					.updateTable("lix_file")
					.set({ path: "/renamed.csv" })
					.where("id", "=", fakeUuid("one"))
					.execute();
			});
			await waitFor(() => {
				expect(centralTabLabels()).toEqual(["«home»", "renamed.csv"]);
				const central = shell.sessionStateStore.getSnapshot()?.panels.central;
				const instance = fileExtensionInstanceForKind(
					CSV_EXTENSION_KIND,
					fakeUuid("one"),
				);
				expect(central?.views[1]).toMatchObject({
					kind: CSV_EXTENSION_KIND,
					instance,
					state: { filePath: "/renamed.csv" },
				});
				expect(central?.activeInstance).toBe(instance);
			});
		} finally {
			await shell.cleanup();
		}
	});

	test("animates the pinned home label between expanded and compact states", async () => {
		const shell = await renderTabbedShell();
		try {
			const homeTab = () =>
				document.querySelector<HTMLButtonElement>(
					'header [data-slot="central-tab-strip"] button[data-pinned="true"]',
				);
			const homeLabel = () =>
				homeTab()?.querySelector<HTMLElement>(
					'[data-attr="panel-tab-select"] + [data-attr="panel-tab-select"]',
				);

			expect(homeLabel()?.className).toContain("max-w-[10rem]");
			expect(homeLabel()?.className).toContain(
				"transition-[max-width,opacity,margin-left]",
			);

			await act(async () => {
				await shell.atelier.documents.open("/one.md");
			});
			expect(homeTab()).toHaveAttribute("aria-label", "Home");
			expect(homeLabel()).toHaveAttribute("aria-hidden", "true");
			expect(homeLabel()?.className).toContain("max-w-0");

			await act(async () => {
				homeTab()?.click();
			});
			expect(homeTab()).not.toHaveAttribute("aria-label");
			expect(homeLabel()).not.toHaveAttribute("aria-hidden");
			expect(homeLabel()?.className).toContain("max-w-[10rem]");
		} finally {
			await shell.cleanup();
		}
	});

	test("keeps active close inline and discloses inactive close on hover", async () => {
		const shell = await renderTabbedShell();
		try {
			await act(async () => {
				await shell.atelier.documents.open("/one.md");
				await shell.atelier.documents.open("/two.md", { newTab: true });
			});

			const inactiveTab = screen.getByRole("button", { name: "one.md" });
			const activeTab = screen.getByRole("button", { name: "two.md" });
			const inactiveClose = inactiveTab.querySelector(
				'[data-attr="panel-tab-close"]',
			);
			expect(inactiveClose).toBeInTheDocument();
			expect(inactiveClose?.parentElement?.className).toContain("opacity-0");
			expect(inactiveClose?.parentElement?.className).toContain(
				"group-hover:opacity-100",
			);
			expect(inactiveClose?.parentElement?.className).toContain(
				"bg-[var(--color-bg-hover-canvas)]",
			);
			const closeFade = inactiveTab.querySelector(
				'[data-attr="panel-tab-close-fade"]',
			);
			expect(closeFade).toBeInTheDocument();
			expect(closeFade?.className).toContain("w-12");
			expect(closeFade?.className).toContain("var(--color-bg-hover-canvas)");
			const activeClose = activeTab.querySelector(
				'[data-attr="panel-tab-close"]',
			);
			expect(activeClose).toBeInTheDocument();
			expect(activeClose?.parentElement?.className).toContain("flex-none");
			expect(activeClose?.parentElement?.className).toContain("size-4");
			expect(activeClose?.parentElement?.className).not.toContain("absolute");
			expect(activeClose?.parentElement?.className).not.toContain("opacity-0");
			const activeCloseFade = activeTab.querySelector(
				'[data-attr="panel-tab-close-fade"]',
			);
			expect(activeCloseFade).not.toBeInTheDocument();
		} finally {
			await shell.cleanup();
		}
	});

	test("newTab appends at the end of the strip; open activates an existing tab", async () => {
		const shell = await renderTabbedShell();
		try {
			await act(async () => {
				await shell.atelier.documents.open("/one.md");
			});
			await act(async () => {
				await shell.atelier.documents.open("/two.md", { newTab: true });
			});
			expect(centralTabLabels()).toEqual(["«home»", "one.md", "two.md"]);

			// Reopening an already-open path activates its tab instead of
			// replacing the active one.
			await act(async () => {
				await shell.atelier.documents.open("/one.md");
			});
			expect(centralTabLabels()).toEqual(["«home»", "one.md", "two.md"]);
			expect(await screen.findByRole("heading", { name: "One" })).toBeVisible();

			// With an EARLIER tab active, a new tab still joins at the END —
			// A | B | + with A active yields A | B | C, not A | C | B.
			await act(async () => {
				await shell.atelier.documents.open("/three.md", { newTab: true });
			});
			expect(centralTabLabels()).toEqual([
				"«home»",
				"one.md",
				"two.md",
				"three.md",
			]);
		} finally {
			await shell.cleanup();
		}
	});

	test("closing the last content tab lands on the pinned home", async () => {
		const shell = await renderTabbedShell();
		try {
			await act(async () => {
				await shell.atelier.documents.open("/one.md");
			});
			expect(centralTabLabels()).toEqual(["«home»", "one.md"]);
			await act(async () => {
				await shell.atelier.documents.closeActive();
			});
			expect(centralTabLabels()).toEqual(["«home»"]);
			expect(await screen.findByTestId("test-home-view")).toBeVisible();
		} finally {
			await shell.cleanup();
		}
	});

	test("views.open places host views as content tabs with in-place navigation", async () => {
		const shell = await renderTabbedShell();
		try {
			await act(async () => {
				await shell.atelier.views.open(DIR_EXTENSION_ID, {
					state: { path: "/assets", atelier: { label: "assets" } },
					instanceId: `${DIR_EXTENSION_ID}:/assets`,
				});
			});
			expect(await screen.findByTestId("test-dir-view")).toBeVisible();
			expect(centralTabLabels()).toEqual(["«home»", "assets"]);

			// A document opened from the folder replaces it in place.
			await act(async () => {
				await shell.atelier.documents.open("/one.md");
			});
			expect(centralTabLabels()).toEqual(["«home»", "one.md"]);

			// Navigating back to the folder (same identity) replaces in place.
			await act(async () => {
				await shell.atelier.views.open(DIR_EXTENSION_ID, {
					state: { path: "/assets", atelier: { label: "assets" } },
					instanceId: `${DIR_EXTENSION_ID}:/assets`,
				});
			});
			expect(centralTabLabels()).toEqual(["«home»", "assets"]);
		} finally {
			await shell.cleanup();
		}
	});

	test("closing a middle tab activates its right neighbor and reports it", async () => {
		const shell = await renderTabbedShell();
		try {
			await act(async () => {
				await shell.atelier.documents.open("/one.md");
			});
			await act(async () => {
				await shell.atelier.documents.open("/two.md", { newTab: true });
			});
			expect(centralTabLabels()).toEqual(["«home»", "one.md", "two.md"]);
			// Activate the middle tab, then close it.
			await act(async () => {
				await shell.atelier.documents.open("/one.md");
			});
			await act(async () => {
				await shell.atelier.documents.closeActive();
			});
			expect(centralTabLabels()).toEqual(["«home»", "two.md"]);
			expect(await screen.findByRole("heading", { name: "Two" })).toBeVisible();
			const closedEvents = shell.events.filter(
				(event) => event.type === "document_closed",
			);
			expect(closedEvents.at(-1)).toMatchObject({
				filePath: "/one.md",
				nextFilePath: "/two.md",
			});
		} finally {
			await shell.cleanup();
		}
	});

	test("side views use section pickers instead of tab chips", async () => {
		const shell = await renderTabbedShell();
		try {
			await act(async () => {
				await shell.atelier.views.open(SIDE_EXTENSION_ID, { panel: "right" });
			});
			expect(await screen.findByTestId("test-side-tool")).toBeInTheDocument();

			expect(
				document.querySelector(
					`aside button[aria-label="Side Tool panel view menu"]`,
				),
			).toBeTruthy();
			expect(
				document.querySelector(
					`aside button[data-view-key="${SIDE_EXTENSION_ID}"]`,
				),
			).toBeNull();
		} finally {
			await shell.cleanup();
		}
	});

	test("views.open rejects unknown extensions and the reserved home id", async () => {
		const shell = await renderTabbedShell();
		try {
			await expect(shell.atelier.views.open("nope_missing")).rejects.toThrow(
				/Unknown Atelier extension/,
			);
			await expect(
				shell.atelier.views.open(DIR_EXTENSION_ID, {
					instanceId: "central-home",
				}),
			).rejects.toThrow(/reserved/);
		} finally {
			await shell.cleanup();
		}
	});

	test("a pinned home keeps Files in the sidebar instead of dropping it", async () => {
		const shell = await renderTabbedShell();
		try {
			// A pinned home owns the central landing; the Files view must
			// survive in the left panel rather than vanish.
			await waitFor(() => {
				const snapshot = shell.sessionStateStore.getSnapshot();
				expect(
					snapshot?.panels.left.views.some(
						(view) => view.kind === "atelier_files",
					),
				).toBe(true);
				expect(
					snapshot?.panels.central.views.some(
						(view) => view.kind === "atelier_files",
					),
				).toBe(false);
			});
		} finally {
			await shell.cleanup();
		}
	});

	test("the built-in strip's + opens the shared view menu, gated by placement", async () => {
		const shell = await renderTabbedShell();
		try {
			await screen.findByTestId("test-home-view");
			const addView = screen.getByRole("button", { name: "Add view" });
			expect(addView).toHaveAttribute("data-attr", "panel-add-view");
			fireEvent.pointerDown(addView, { button: 0, ctrlKey: false });

			// The + is the shared view menu: built-in repository views with
			// central placement are offered; side-panel-only views are not.
			const filesItem = await screen.findByRole("menuitem", { name: "Files" });
			expect(
				screen.getByRole("menuitem", { name: "SQL Explorer" }),
			).toBeInTheDocument();
			expect(
				screen.getByRole("menuitem", { name: "History" }),
			).toBeInTheDocument();
			expect(screen.queryByRole("menuitem", { name: "Side Tool" })).toBeNull();

			fireEvent.click(filesItem);
			await waitFor(() => {
				expect(
					centralTabButtons().some(
						(tab) => tab.dataset.viewKey === "atelier_files",
					),
				).toBe(true);
			});
			// Close-focus lands on the new tab, not back on the "+" (which would
			// paint a stray focus ring there).
			const addedTab = centralTabButtons().find(
				(tab) => tab.dataset.viewKey === "atelier_files",
			);
			await waitFor(() => expect(addedTab).toHaveFocus());
		} finally {
			await shell.cleanup();
		}
	});

	test("host identity slots render, divided from the document tabs", async () => {
		const shell = await renderTabbedShell({
			slots: {
				navbarBrand: <span data-testid="host-brand">mark</span>,
				navbarRepository: <span data-testid="host-repo">peter-parker</span>,
			},
		});
		try {
			expect(await screen.findByTestId("host-brand")).toBeVisible();
			expect(screen.getByTestId("host-repo")).toBeVisible();
			expect(
				document.querySelector('[data-atelier-part="top-bar-divider"]'),
			).toBeTruthy();
		} finally {
			await shell.cleanup();
		}
	});

	test("omits the top-bar divider when the host claims no identity slots", async () => {
		const shell = await renderTabbedShell();
		try {
			await screen.findByTestId("test-home-view");
			expect(
				document.querySelector('[data-atelier-part="top-bar-divider"]'),
			).toBeNull();
		} finally {
			await shell.cleanup();
		}
	});

	test("a host-rendered tab strip drives the same tab rules", async () => {
		let newTab: (() => void) | undefined;
		const shell = await renderTabbedShell({
			slots: {
				centralTabStrip: (context) => {
					newTab = context.newTab;
					return (
						<div data-testid="host-strip">
							{context.tabs.map((tab) => (
								<button
									key={tab.instanceId}
									type="button"
									data-testid={`host-tab-${tab.isPinned ? "home" : tab.label}`}
									data-active={tab.isActive ? "true" : undefined}
									onClick={tab.select}
								>
									{tab.label}
								</button>
							))}
							{context.tabs.map((tab) =>
								tab.close ? (
									<button
										key={`close-${tab.instanceId}`}
										type="button"
										aria-label={`Close ${tab.label}`}
										data-testid={`host-close-${tab.label}`}
										onClick={tab.close}
									/>
								) : null,
							)}
						</div>
					);
				},
			},
		});
		try {
			expect(await screen.findByTestId("host-strip")).toBeVisible();
			expect(newTab).toEqual(expect.any(Function));
			// The pinned home has no close affordance; the built-in strip is gone.
			expect(screen.getByTestId("host-tab-home")).toBeVisible();
			expect(screen.queryByTestId("host-close-Home")).toBeNull();
			expect(
				document.querySelector("section button[data-view-instance]"),
			).toBeNull();

			await act(async () => {
				await shell.atelier.documents.open("/one.md");
			});
			expect(await screen.findByTestId("host-tab-one.md")).toBeVisible();

			// Host chips drive selection and closing through Atelier's rules.
			await act(async () => {
				screen.getByTestId("host-tab-home").click();
			});
			expect(screen.getByTestId("host-tab-home").dataset.active).toBe("true");
			await act(async () => {
				screen.getByTestId("host-close-one.md").click();
			});
			await waitFor(() => {
				expect(screen.queryByTestId("host-tab-one.md")).toBeNull();
			});
		} finally {
			await shell.cleanup();
		}
	});

	test("emits central_view_activated for every active-view change", async () => {
		const shell = await renderTabbedShell();
		try {
			await waitFor(() => {
				expect(
					shell.events.some(
						(event) =>
							event.type === "central_view_activated" &&
							event.viewKind === HOME_EXTENSION_ID,
					),
				).toBe(true);
			});
			await act(async () => {
				await shell.atelier.documents.open("/one.md");
			});
			await waitFor(() => {
				expect(
					shell.events.some(
						(event) =>
							event.type === "central_view_activated" &&
							event.filePath === "/one.md",
					),
				).toBe(true);
			});
			await act(async () => {
				await shell.atelier.documents.closeActive();
			});
			await waitFor(() => {
				const activations = shell.events.filter(
					(event) => event.type === "central_view_activated",
				);
				expect(activations.at(-1)).toMatchObject({
					viewKind: HOME_EXTENSION_ID,
				});
			});
		} finally {
			await shell.cleanup();
		}
	});
});
