import { vi, describe, expect, test } from "vitest";
import React from "react";

vi.mock("@dnd-kit/core", async () => {
	const actual =
		await vi.importActual<typeof import("@dnd-kit/core")>("@dnd-kit/core");
	return {
		...actual,
		useDroppable: vi.fn().mockReturnValue({
			setNodeRef: vi.fn(),
			isOver: false,
		}),
	};
});

vi.mock("@dnd-kit/sortable", async () => {
	const actual = await vi.importActual<any>("@dnd-kit/sortable");
	return {
		...actual,
		useSortable: vi.fn().mockReturnValue({
			attributes: {},
			listeners: {},
			setNodeRef: vi.fn(),
			transform: null,
			transition: null,
			isDragging: false,
		}),
		SortableContext: ({ children }: { children: React.ReactNode }) => (
			<div>{children}</div>
		),
	};
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PanelV2 } from "./panel-v2";
import { ExtensionHostRegistryProvider } from "../extension-runtime/extension-host-registry";
import type {
	PanelState,
	ExtensionDefinition,
} from "../extension-runtime/types";
import type { Lix } from "@lix-js/sdk";
import { Search } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { createExtensionHostContext } from "@/test-utils/extension-host-context";

const TEST_SEARCH_EXTENSION_KIND = "test_search";

const emptyPanel: PanelState = { views: [], activeInstance: null };

const singleSearchPanel: PanelState = {
	views: [{ instance: "search-1", kind: TEST_SEARCH_EXTENSION_KIND }],
	activeInstance: "search-1",
};

const pendingSearchPanel: PanelState = {
	views: [
		{ instance: "search-1", kind: TEST_SEARCH_EXTENSION_KIND, isPending: true },
	],
	activeInstance: "search-1",
};

const mockLix = {} as Lix;

const createViewContext = () => createExtensionHostContext(mockLix);

const searchViewOverride: ExtensionDefinition = {
	kind: TEST_SEARCH_EXTENSION_KIND,
	label: "Search",
	description: "Test search view",
	icon: Search,
	mount: ({ element }) => {
		const input = document.createElement("input");
		input.setAttribute("placeholder", "Search project...");
		element.replaceChildren(input);
		return {
			dispose: () => element.replaceChildren(),
		};
	},
};

const renderWithinProvider = (ui: React.ReactNode) =>
	render(<ExtensionHostRegistryProvider>{ui}</ExtensionHostRegistryProvider>);

describe("PanelV2", () => {
	test("renders content container without padding or margin utilities", () => {
		renderWithinProvider(
			<PanelV2
				side="left"
				panel={emptyPanel}
				isFocused={false}
				onFocusPanel={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				viewContext={createViewContext()}
				emptyStatePlaceholder={<div data-testid="empty-placeholder">Empty</div>}
			/>,
		);

		const placeholder = screen.getByTestId("empty-placeholder");
		let contentElement: HTMLElement | null = placeholder.parentElement;
		while (
			contentElement &&
			!contentElement.className.includes("overflow-hidden")
		) {
			contentElement = contentElement.parentElement;
		}

		expect(contentElement).not.toBeNull();
		const classList = (contentElement?.className ?? "")
			.split(/\s+/)
			.filter(Boolean);

		const expectedClasses = [
			"flex",
			"min-h-0",
			"flex-1",
			"flex-col",
			"overflow-hidden",
		];
		expect(classList.sort()).toEqual([...expectedClasses].sort());
		// Keep the host padding-free so we don't assume what individual views render.
		expect(classList.some((token) => /^p[trblxy]?-/u.test(token))).toBe(false);
		expect(classList.some((token) => /^m[trblxy]?-/u.test(token))).toBe(false);
	});

	test("renders the active view content", async () => {
		renderWithinProvider(
			<PanelV2
				side="left"
				panel={singleSearchPanel}
				isFocused={false}
				onFocusPanel={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>,
		);

		const input = await screen.findByPlaceholderText("Search project...");
		expect(input).toBeInTheDocument();
	});

	test("registers the panel container as a droppable target", () => {
		const droppableMock = vi.mocked(useDroppable);
		droppableMock.mockClear();
		renderWithinProvider(
			<PanelV2
				side="left"
				panel={singleSearchPanel}
				isFocused={false}
				onFocusPanel={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>,
		);

		expect(droppableMock).toHaveBeenCalledWith({
			id: "left-panel",
			data: { panel: "left" },
		});
	});

	test("uses the tab label resolver when provided", () => {
		renderWithinProvider(
			<PanelV2
				side="left"
				panel={singleSearchPanel}
				isFocused={false}
				onFocusPanel={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				tabLabel={() => "Custom Search"}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Custom Search" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Custom Search" }),
		).not.toHaveAttribute("data-attr", "panel-tab-select");
		expect(screen.getByText("Custom Search")).toHaveAttribute(
			"data-attr",
			"panel-tab-select",
		);
		expect(
			screen
				.getByRole("button", { name: "Custom Search" })
				.querySelector("[data-attr='panel-tab-close']"),
		).toBeInTheDocument();
	});

	test("registers sortable handlers for tabs", () => {
		const sortableMock = vi.mocked(useSortable);
		sortableMock.mockClear();
		renderWithinProvider(
			<PanelV2
				side="left"
				panel={singleSearchPanel}
				isFocused={false}
				onFocusPanel={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>,
		);

		expect(sortableMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "search-1",
				data: expect.objectContaining({
					instance: "search-1",
					panel: "left",
					fromPanel: "left",
				}),
			}),
		);
	});

	test("renders the add-view button when onAddView is provided", () => {
		renderWithinProvider(
			<PanelV2
				side="left"
				panel={singleSearchPanel}
				isFocused={false}
				onFocusPanel={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				onAddView={vi.fn()}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>,
		);

		expect(screen.getByLabelText("Add view")).toHaveAttribute(
			"data-attr",
			"panel-add-view",
		);
	});

	test("invokes the pending finalizer when the active view is interacted with", async () => {
		const finalize = vi.fn();
		renderWithinProvider(
			<PanelV2
				side="left"
				panel={pendingSearchPanel}
				isFocused={false}
				onFocusPanel={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				onActiveViewInteraction={finalize}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>,
		);

		const input = await screen.findByPlaceholderText("Search project...");
		fireEvent.pointerDown(input);
		expect(finalize).toHaveBeenCalledWith("search-1");
	});

	test("renders the provided empty state placeholder when no views are open", () => {
		renderWithinProvider(
			<PanelV2
				side="left"
				panel={emptyPanel}
				isFocused={false}
				onFocusPanel={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				viewContext={createViewContext()}
				emptyStatePlaceholder={<div>No tabs</div>}
			/>,
		);

		expect(screen.getByText("No tabs")).toBeInTheDocument();
		expect(screen.queryByRole("button")).toBeNull();
	});

	test("passes the custom drop id and panel metadata to useDroppable", () => {
		const mocked = vi.mocked(useDroppable);
		mocked.mockClear();
		renderWithinProvider(
			<PanelV2
				side="left"
				panel={emptyPanel}
				isFocused={false}
				onFocusPanel={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				emptyStatePlaceholder={<div />}
				viewContext={createViewContext()}
				dropId="custom-drop"
			/>,
		);

		expect(mocked).toHaveBeenCalledWith({
			id: "custom-drop",
			data: { panel: "left" },
		});
	});

	test("mounts once, updates snapshots, and disposes with an aborted signal", async () => {
		const update = vi.fn();
		const dispose = vi.fn();
		let signal: AbortSignal | undefined;
		const lifecycleView: ExtensionDefinition = {
			kind: "lifecycle",
			label: "Lifecycle",
			description: "Lifecycle test",
			icon: Search,
			mount: (args) => {
				signal = args.signal;
				return { update, dispose };
			},
		};
		const panel: PanelState = {
			views: [{ instance: "lifecycle-1", kind: "lifecycle", state: { n: 1 } }],
			activeInstance: "lifecycle-1",
		};
		const rendered = renderWithinProvider(
			<PanelV2
				side="left"
				panel={panel}
				isFocused={true}
				onFocusPanel={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				viewContext={createViewContext()}
				viewOverrides={[lifecycleView]}
			/>,
		);

		await waitFor(() => expect(signal).toBeDefined());
		rendered.rerender(
			<ExtensionHostRegistryProvider>
				<PanelV2
					side="left"
					panel={{
						...panel,
						views: [
							{ instance: "lifecycle-1", kind: "lifecycle", state: { n: 2 } },
						],
					}}
					isFocused={true}
					onFocusPanel={vi.fn()}
					onSelectView={vi.fn()}
					onRemoveView={vi.fn()}
					viewContext={createViewContext()}
					viewOverrides={[lifecycleView]}
				/>
			</ExtensionHostRegistryProvider>,
		);

		await waitFor(() => expect(update).toHaveBeenCalled());
		rendered.unmount();
		expect(signal?.aborted).toBe(true);
		await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
	});
});
