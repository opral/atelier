import { Suspense, act, type ReactNode } from "react";
import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { MainArea } from "./main-panel";
import type { AreaState } from "../extension-runtime/types";
import { openLix } from "@/test-utils/node-lix-sdk";
import { ExtensionHostRegistryProvider } from "../extension-runtime/extension-host-registry";
import { createExtensionHostContext } from "@/test-utils/extension-host-context";

const TEST_SEARCH_EXTENSION_KIND = "test_search";

vi.mock("../extension-runtime/extension-registry", () => {
	const definitions = [
		{
			kind: "test_search" as const,
			label: "Search",
			description: "Search view",
			icon: () => <svg></svg>,
			mount: ({ element }: { element: HTMLElement }) => {
				const input = document.createElement("input");
				input.setAttribute("data-testid", "search-view-input");
				input.setAttribute("placeholder", "Search project...");
				element.replaceChildren(input);
				return {
					dispose: () => element.replaceChildren(),
				};
			},
		},
	];
	return {
		EXTENSION_DEFINITIONS: definitions,
		EXTENSION_MAP: new Map(definitions.map((def) => [def.kind, def])),
		useExtensionRegistry: () => ({
			visibleExtensions: definitions,
			extensionMap: new Map(definitions.map((def) => [def.kind, def])),
			replaceInstalledExtensions: () => {},
		}),
	};
});

let lix: Awaited<ReturnType<typeof openLix>> | null = null;

beforeAll(async () => {
	lix = await openLix();
});

afterAll(async () => {
	await lix?.close();
	lix = null;
});

const renderWithProviders = async (ui: ReactNode) => {
	let result: ReturnType<typeof render> | undefined;
	await act(async () => {
		result = render(
			<ExtensionHostRegistryProvider>
				<Suspense fallback={<div data-testid="loading-state" />}>{ui}</Suspense>
			</ExtensionHostRegistryProvider>,
		);
	});
	return result!;
};

const createViewContext = () =>
	createExtensionHostContext(
		lix ??
			(() => {
				throw new Error("Lix instance not initialized");
			})(),
	);

describe("MainArea", () => {
	test("renders the document action without desktop agent controls", async () => {
		const panelState: AreaState = {
			views: [],
			activeInstance: null,
		};

		await renderWithProviders(
			<DndContext>
				<MainArea
					area={panelState}
					onSelectView={() => {}}
					onRemoveView={() => {}}
					viewContext={createViewContext()}
					isFocused={true}
					onFocusArea={vi.fn()}
					onCreateNewFile={vi.fn()}
				/>
			</DndContext>,
		);

		expect(
			screen.getByRole("button", { name: /new document/i }),
		).toHaveAttribute("data-attr", "main-empty-new-document");
		expect(
			screen.queryByRole("button", { name: /ask your agent/i }),
		).toBeNull();
		expect(
			screen.getByRole("heading", { name: "Start writing" }),
		).toBeVisible();
	});

	test("a host that takes no writing does not promise a new document", async () => {
		const panelState: AreaState = {
			views: [],
			activeInstance: null,
		};

		await renderWithProviders(
			<DndContext>
				<MainArea
					area={panelState}
					onSelectView={() => {}}
					onRemoveView={() => {}}
					viewContext={createViewContext()}
					isFocused={true}
					onFocusArea={vi.fn()}
				/>
			</DndContext>,
		);

		expect(screen.getByRole("heading", { name: "Nothing open" })).toBeVisible();
		expect(
			screen.getByText("Open a file from the left to read it."),
		).toBeVisible();
		expect(screen.queryByText(/create a new document/i)).toBeNull();
		expect(screen.queryByRole("button", { name: /new document/i })).toBeNull();
	});

	test("renders the shared add-view action in the tab strip", async () => {
		const onAddView = vi.fn();
		const panelState: AreaState = {
			views: [],
			activeInstance: null,
		};

		await renderWithProviders(
			<DndContext>
				<MainArea
					area={panelState}
					onSelectView={() => {}}
					onRemoveView={() => {}}
					viewContext={createViewContext()}
					isFocused={true}
					onFocusArea={vi.fn()}
					onAddView={onAddView}
					showTabBar
				/>
			</DndContext>,
		);

		fireEvent.pointerDown(screen.getByRole("button", { name: "Add view" }), {
			button: 0,
			ctrlKey: false,
		});
		fireEvent.click(await screen.findByRole("menuitem", { name: "Search" }));
		expect(onAddView).toHaveBeenCalledWith(TEST_SEARCH_EXTENSION_KIND);
	});

	test("does not render an add-view action when view creation is unavailable", async () => {
		const panelState: AreaState = {
			views: [{ instance: "search-1", kind: TEST_SEARCH_EXTENSION_KIND }],
			activeInstance: "search-1",
		};

		await renderWithProviders(
			<DndContext>
				<MainArea
					area={panelState}
					onSelectView={() => {}}
					onRemoveView={() => {}}
					viewContext={createViewContext()}
					isFocused={true}
					onFocusArea={vi.fn()}
					showTabBar
				/>
			</DndContext>,
		);

		expect(screen.queryByRole("button", { name: "Add view" })).toBeNull();
	});

	test("renders the active view without a tab strip", async () => {
		// The main editor hides tabs; files are switched from the left list.
		const panelState: AreaState = {
			views: [{ instance: "search-1", kind: TEST_SEARCH_EXTENSION_KIND }],
			activeInstance: "search-1",
		};

		await renderWithProviders(
			<DndContext>
				<MainArea
					area={panelState}
					onSelectView={() => {}}
					onRemoveView={() => {}}
					viewContext={createViewContext()}
					isFocused={true}
					onFocusArea={vi.fn()}
				/>
			</DndContext>,
		);

		expect(await screen.findByTestId("search-view-input")).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
	});

	test("finalizes pending view when interacting with content", async () => {
		const panelState: AreaState = {
			views: [
				{
					instance: "search-1",
					kind: TEST_SEARCH_EXTENSION_KIND,
					isPending: true,
				},
			],
			activeInstance: "search-1",
		};
		const handleFinalize = vi.fn();

		await renderWithProviders(
			<DndContext>
				<MainArea
					area={panelState}
					onSelectView={() => {}}
					onRemoveView={() => {}}
					viewContext={createViewContext()}
					isFocused={true}
					onFocusArea={vi.fn()}
					onFinalizePendingView={handleFinalize}
				/>
			</DndContext>,
		);

		const input = await screen.findByTestId("search-view-input");
		fireEvent.pointerDown(input);

		expect(handleFinalize).toHaveBeenCalledWith("search-1");
	});
});
