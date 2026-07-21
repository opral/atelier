import { Suspense } from "react";
import { describe, expect, test, vi } from "vitest";
import {
	act,
	render,
	screen,
	waitFor,
	fireEvent,
} from "@testing-library/react";
import { qb } from "@/lib/lix-kysely";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { V2LayoutShell } from "./layout-shell";
import { createAtelier } from "../atelier-instance";
import { createMemorySessionStateStore } from "../state-adapters";
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
		filesViewMode?: "landing" | "sidebar";
		slots?: import("../create-atelier").AtelierSlots;
	} = {},
) {
	const filesViewMode = options.filesViewMode ?? "sidebar";
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
		filesViewMode,
		centralPanel: {
			home: { extensionId: HOME_EXTENSION_ID },
		},
	});
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
			{
				id: "three",
				path: "/three.md",
				data: new TextEncoder().encode("# Three\n"),
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
						filesViewMode={filesViewMode}
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
			"section button[data-view-instance]",
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

	test("side chips remove views; Files is removable and left-only", async () => {
		const shell = await renderTabbedShell();
		try {
			await act(async () => {
				await shell.atelier.views.open(SIDE_EXTENSION_ID, { panel: "right" });
			});
			expect(await screen.findByTestId("test-side-tool")).toBeInTheDocument();

			// Closing the only removable view removes it (and closes the island).
			const sideClose = document.querySelector<HTMLElement>(
				`aside button[data-view-key="${SIDE_EXTENSION_ID}"] [data-attr="panel-tab-close"]`,
			);
			expect(sideClose).toBeTruthy();
			fireEvent.click(sideClose!);
			await waitFor(() => {
				expect(
					document.querySelector(
						`aside button[data-view-key="${SIDE_EXTENSION_ID}"]`,
					),
				).toBeNull();
			});

			// The seeded Files view is a normal view now: its ✕ removes it for
			// real — no canonicalization resurrection.
			const filesClose = document.querySelector<HTMLElement>(
				'aside button[data-view-key="atelier_files"] [data-attr="panel-tab-close"]',
			);
			expect(filesClose).toBeTruthy();
			fireEvent.click(filesClose!);
			await waitFor(() => {
				expect(
					document.querySelector('aside button[data-view-key="atelier_files"]'),
				).toBeNull();
			});

			// The left add-view menu offers Files again once it is closed; the
			// right panel's menu never offers it (left-only placement).
			const addButtons = [
				...document.querySelectorAll<HTMLElement>(
					'aside button[aria-label="Add view"]',
				),
			];
			expect(addButtons.length).toBeGreaterThan(0);
			fireEvent.pointerDown(addButtons[0]!, { button: 0 });
			await screen.findByRole("menu");
			expect(
				screen.getByRole("menuitem", { name: "Files" }),
			).toBeInTheDocument();
			fireEvent.keyDown(document.body, { key: "Escape" });
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

	test("landing files mode keeps Files in the sidebar instead of dropping it", async () => {
		const shell = await renderTabbedShell({ filesViewMode: "landing" });
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

	test("a host-rendered tab strip drives the same tab rules", async () => {
		const shell = await renderTabbedShell({
			slots: {
				centralTabStrip: (context) => (
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
				),
			},
		});
		try {
			expect(await screen.findByTestId("host-strip")).toBeVisible();
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
