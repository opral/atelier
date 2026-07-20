import { Suspense } from "react";
import { describe, expect, test, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
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

const extensions = [homeRegistration, dirRegistration];

async function renderTabbedShell(
	options: { filesViewMode?: "landing" | "sidebar" } = {},
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
			mode: "tabs",
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
			'section button[data-view-instance]',
		),
	);

const centralTabLabels = () =>
	centralTabButtons().map(
		(button) =>
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

	test("newTab appends beside the active tab; open activates an existing tab", async () => {
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

	test("views.open rejects unknown extensions and the reserved home id", async () => {
		const shell = await renderTabbedShell();
		try {
			await expect(
				shell.atelier.views.open("nope_missing"),
			).rejects.toThrow(/Unknown Atelier extension/);
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
