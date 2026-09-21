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

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { PanelV2, availableExtensionsForPanel } from "./panel-v2";
import { ExtensionHostRegistryProvider } from "../extension-runtime/extension-host-registry";
import { ExtensionRegistryProvider } from "../extension-runtime/extension-registry";
import type {
	AreaState,
	ExtensionDefinition,
} from "../extension-runtime/types";
import type { Lix } from "@lix-js/sdk";
import type { AtelierDiffSession } from "@/extension-api";
import { Search } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { createExtensionHostContext } from "@/test-utils/extension-host-context";
import { openLix } from "@/test-utils/node-lix-sdk";

const TEST_SEARCH_EXTENSION_KIND = "test_search";

const emptyPanel: AreaState = { views: [], activeInstance: null };

const singleSearchPanel: AreaState = {
	views: [{ instance: "search-1", kind: TEST_SEARCH_EXTENSION_KIND }],
	activeInstance: "search-1",
};

const pendingSearchPanel: AreaState = {
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

const multiInstanceSearchView: ExtensionDefinition = {
	...searchViewOverride,
	multiInstance: true,
};

function StatefulMultiInstancePanel() {
	const [area, setPanel] = React.useState(singleSearchPanel);
	const nextInstance = React.useRef(2);
	return (
		<PanelV2
			side="main"
			area={area}
			isFocused={true}
			onFocusArea={vi.fn()}
			onSelectView={(instance) =>
				setPanel((current) => ({ ...current, activeInstance: instance }))
			}
			onRemoveView={vi.fn()}
			onAddView={(kind) => {
				const instance = `search-${nextInstance.current}`;
				nextInstance.current += 1;
				setPanel((current) => ({
					views: [...current.views, { instance, kind }],
					activeInstance: instance,
				}));
			}}
			viewContext={createViewContext()}
		/>
	);
}

/** A working review over two files, as the shell hands it to every view. */
const reviewSession: AtelierDiffSession = {
	base: { commitId: "commit_before" },
	target: { working: true },
	files: [],
	activePath: null,
	capabilities: { checkpoint: true, undo: true, restore: false },
};

const renderWithinProvider = (ui: React.ReactNode) =>
	render(<ExtensionHostRegistryProvider>{ui}</ExtensionHostRegistryProvider>);

describe("PanelV2", () => {
	test("keeps singleton and multi-instance availability consistent", () => {
		expect(
			availableExtensionsForPanel([searchViewOverride], singleSearchPanel),
		).toEqual([]);
		expect(
			availableExtensionsForPanel([multiInstanceSearchView], singleSearchPanel),
		).toEqual([multiInstanceSearchView]);
	});

	test("adds and focuses a new instance of a multi-instance view", async () => {
		render(
			<ExtensionRegistryProvider hostExtensions={[multiInstanceSearchView]}>
				<ExtensionHostRegistryProvider>
					<StatefulMultiInstancePanel />
				</ExtensionHostRegistryProvider>
			</ExtensionRegistryProvider>,
		);

		const addView = screen.getByRole("button", { name: "Add view" });
		fireEvent.keyDown(addView, { key: "ArrowDown", code: "ArrowDown" });
		const searchItem = await screen.findByRole("menuitem", { name: "Search" });
		searchItem.focus();
		fireEvent.keyDown(searchItem, { key: "Enter", code: "Enter" });

		await waitFor(() =>
			expect(screen.getAllByRole("button", { name: "Search" })).toHaveLength(2),
		);
		const searchTabs = screen.getAllByRole("button", { name: "Search" });
		expect(searchTabs[0]).toHaveAttribute("data-view-instance", "search-1");
		expect(searchTabs[1]).toHaveAttribute("data-view-instance", "search-2");
		await waitFor(() => expect(searchTabs[1]).toHaveFocus());
	});

	test("renders content container without padding or margin utilities", () => {
		renderWithinProvider(
			<PanelV2
				side="left"
				area={emptyPanel}
				isFocused={false}
				onFocusArea={vi.fn()}
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
			"relative",
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

	test("a review stepping to another file of the same extension keeps the mounted view", async () => {
		const reads = new Map<string, (data: string) => void>();
		const documentView: ExtensionDefinition = {
			kind: "test_document",
			label: "Document",
			description: "Test document view",
			icon: Search,
			load: ({ location }) =>
				new Promise<string>((resolve) => {
					reads.set("path" in location ? location.path : "", resolve);
				}),
			Component: ({ data, view }) => (
				<article data-testid="document">
					{String(data)} ({String(view.state.filePath)})
				</article>
			),
		};
		const area = (fileId: string, filePath: string): AreaState => ({
			views: [
				{
					instance: `test_document:${fileId}`,
					kind: "test_document",
					state: { fileId, filePath },
				},
			],
			activeInstance: `test_document:${fileId}`,
		});
		const lix = await openLix();
		const viewContext = createExtensionHostContext(lix);
		const inReview = {
			...viewContext,
			atelier: {
				...viewContext.atelier,
				diff: { ...viewContext.atelier.diff, session: reviewSession },
			},
		};
		const tree = (state: AreaState) => (
			<ExtensionHostRegistryProvider>
				<PanelV2
					side="main"
					area={state}
					isFocused
					onFocusArea={vi.fn()}
					onSelectView={vi.fn()}
					onRemoveView={vi.fn()}
					viewContext={inReview}
					viewOverrides={[documentView]}
				/>
			</ExtensionHostRegistryProvider>
		);
		const rendered = render(tree(area("a", "/a.md")));
		try {
			await waitFor(() => expect(reads.has("/a.md")).toBe(true));
			await act(async () => reads.get("/a.md")!("Document A"));
			const root = screen.getByTestId("atelier-view:test_document:a");
			expect(screen.getByTestId("document")).toHaveTextContent(
				"Document A (/a.md)",
			);

			rendered.rerender(tree(area("b", "/b.md")));
			await waitFor(() => expect(reads.has("/b.md")).toBe(true));
			// Same node, same document on it, no loading state: the view waits
			// for the next document with the last one still on screen.
			expect(screen.getByTestId("atelier-view:test_document:b")).toBe(root);
			expect(screen.getByTestId("document")).toHaveTextContent(
				"Document A (/a.md)",
			);
			expect(screen.queryByRole("status")).toBeNull();

			await act(async () => reads.get("/b.md")!("Document B"));
			expect(screen.getByTestId("atelier-view:test_document:b")).toBe(root);
			expect(screen.getByTestId("document")).toHaveTextContent(
				"Document B (/b.md)",
			);
		} finally {
			await act(async () => rendered.unmount());
			await lix.close();
		}
	});

	test("a review stepping to a file of another extension keeps the leaving view until the arriving one shows", async () => {
		const reads = new Map<string, (data: string) => void>();
		const documentView = (kind: string): ExtensionDefinition => ({
			kind,
			label: kind,
			description: `Test ${kind} view`,
			icon: Search,
			load: ({ location }) =>
				new Promise<string>((resolve) => {
					reads.set("path" in location ? location.path : "", resolve);
				}),
			Component: ({ data }) => (
				<article data-testid={`document-${kind}`}>{String(data)}</article>
			),
		});
		const area = (kind: string, fileId: string, filePath: string) => ({
			views: [
				{ instance: `${kind}:${fileId}`, kind, state: { fileId, filePath } },
			],
			activeInstance: `${kind}:${fileId}`,
		});
		const lix = await openLix();
		const viewContext = createExtensionHostContext(lix);
		const inReview = {
			...viewContext,
			atelier: {
				...viewContext.atelier,
				diff: { ...viewContext.atelier.diff, session: reviewSession },
			},
		};
		const tree = (state: AreaState) => (
			<ExtensionHostRegistryProvider>
				<PanelV2
					side="main"
					area={state}
					isFocused
					onFocusArea={vi.fn()}
					onSelectView={vi.fn()}
					onRemoveView={vi.fn()}
					viewContext={inReview}
					viewOverrides={[
						documentView("test_html"),
						documentView("test_image"),
					]}
				/>
			</ExtensionHostRegistryProvider>
		);
		const rendered = render(tree(area("test_html", "a", "/a.html")));
		try {
			await waitFor(() => expect(reads.has("/a.html")).toBe(true));
			await act(async () => reads.get("/a.html")!("Artifact A"));
			expect(screen.getByTestId("document-test_html")).toHaveTextContent(
				"Artifact A",
			);

			rendered.rerender(tree(area("test_image", "b", "/b.png")));
			await waitFor(() => expect(reads.has("/b.png")).toBe(true));
			// The artifact stays on screen; the image view reads its file out
			// of sight. Nothing the shell shows in between is a loading state.
			expect(screen.getByTestId("document-test_html")).toHaveTextContent(
				"Artifact A",
			);
			expect(screen.getByTestId("document-test_html")).toBeVisible();
			expect(screen.queryByRole("status")).toBeNull();
			expect(
				screen
					.getByTestId("atelier-view:test_image:b")
					.closest("[data-atelier-view-arriving]"),
			).toHaveAttribute("aria-hidden", "true");

			await act(async () => reads.get("/b.png")!("Image B"));
			expect(screen.queryByTestId("document-test_html")).toBeNull();
			expect(screen.getByTestId("document-test_image")).toHaveTextContent(
				"Image B",
			);
			expect(
				screen
					.getByTestId("atelier-view:test_image:b")
					.closest("[data-atelier-view-arriving]"),
			).toBeNull();
		} finally {
			await act(async () => rendered.unmount());
			await lix.close();
		}
	});

	test("outside a review, navigating a tab to another document mounts it fresh", async () => {
		const documentView: ExtensionDefinition = {
			kind: "test_document",
			label: "Document",
			description: "Test document view",
			icon: Search,
			load: async ({ location }) =>
				`Document at ${"path" in location ? location.path : ""}`,
			Component: ({ data }) => (
				<article data-testid="document">{String(data)}</article>
			),
		};
		const area = (fileId: string, filePath: string): AreaState => ({
			views: [
				{
					instance: `test_document:${fileId}`,
					kind: "test_document",
					state: { fileId, filePath },
				},
			],
			activeInstance: `test_document:${fileId}`,
		});
		const lix = await openLix();
		const viewContext = createExtensionHostContext(lix);
		const tree = (state: AreaState) => (
			<ExtensionHostRegistryProvider>
				<PanelV2
					side="main"
					area={state}
					isFocused
					onFocusArea={vi.fn()}
					onSelectView={vi.fn()}
					onRemoveView={vi.fn()}
					viewContext={viewContext}
					viewOverrides={[documentView]}
				/>
			</ExtensionHostRegistryProvider>
		);
		const rendered = render(tree(area("a", "/a.md")));
		try {
			await screen.findByText("Document at /a.md");
			const root = screen.getByTestId("atelier-view:test_document:a");
			rendered.rerender(tree(area("b", "/b.md")));
			expect(screen.getByTestId("atelier-view:test_document:b")).not.toBe(root);
			await screen.findByText("Document at /b.md");
		} finally {
			await act(async () => rendered.unmount());
			await lix.close();
		}
	});

	test("renders the active view content", async () => {
		renderWithinProvider(
			<PanelV2
				side="left"
				area={singleSearchPanel}
				isFocused={false}
				onFocusArea={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>,
		);

		const input = await screen.findByPlaceholderText("Search project...");
		expect(input).toBeInTheDocument();
		expect(screen.getByTestId("atelier-view:search-1")).toHaveAttribute(
			"data-active",
			"true",
		);
	});

	test("defers persisted panel views until the panel becomes visible and active", async () => {
		const mount = vi.fn(searchViewOverride.mount);
		const lazyView: ExtensionDefinition = { ...searchViewOverride, mount };
		const area: AreaState = {
			views: [
				{ instance: "search-1", kind: TEST_SEARCH_EXTENSION_KIND },
				{ instance: "search-2", kind: TEST_SEARCH_EXTENSION_KIND },
			],
			activeInstance: "search-1",
		};
		const rendered = renderWithinProvider(
			<PanelV2
				side="left"
				area={area}
				contentVisible={false}
				isFocused={false}
				onFocusArea={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				viewContext={createViewContext()}
				viewOverrides={[lazyView]}
			/>,
		);
		expect(mount).not.toHaveBeenCalled();

		rendered.rerender(
			<ExtensionHostRegistryProvider>
				<PanelV2
					side="left"
					area={area}
					contentVisible
					isFocused={false}
					onFocusArea={vi.fn()}
					onSelectView={vi.fn()}
					onRemoveView={vi.fn()}
					viewContext={createViewContext()}
					viewOverrides={[lazyView]}
				/>
			</ExtensionHostRegistryProvider>,
		);
		await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
		expect(screen.getAllByPlaceholderText("Search project...")).toHaveLength(1);
	});

	test("a collapsed panel keeps its section header out of the tab ring", () => {
		const area: AreaState = {
			views: [{ instance: "search-1", kind: TEST_SEARCH_EXTENSION_KIND }],
			activeInstance: "search-1",
		};
		const panel = (contentVisible: boolean) => (
			<PanelV2
				side="left"
				area={area}
				contentVisible={contentVisible}
				isFocused={false}
				onFocusArea={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				onHidePanel={vi.fn()}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>
		);
		const rendered = renderWithinProvider(panel(false));
		// Collapsed: nothing of the header is focusable or announced, so the
		// picker cannot float a menu — "Hide sidebar" included — over a
		// sidebar that is not on screen.
		expect(
			document.querySelector('[data-attr="panel-section-picker"]'),
		).toBeNull();
		expect(
			document.querySelector('[data-atelier-part="section-header"]'),
		).toBeNull();

		rendered.rerender(
			<ExtensionHostRegistryProvider>
				{panel(true)}
			</ExtensionHostRegistryProvider>,
		);
		expect(
			screen.getByRole("button", { name: /panel view menu$/ }),
		).toBeVisible();

		rendered.rerender(
			<ExtensionHostRegistryProvider>
				{panel(false)}
			</ExtensionHostRegistryProvider>,
		);
		// Collapsed again with a view mounted in it: the view stays, because a
		// sidebar that comes back keeps its state, and Tab must not walk into
		// it while it is off screen.
		const view = document.querySelector(
			'[data-testid="atelier-view:search-1"]',
		);
		expect(view).not.toBeNull();
		expect(view?.closest("[inert]")).not.toBeNull();
	});

	test("a refused rename keeps the keyboard in the field", async () => {
		let settleRename: ((renamed: boolean) => void) | null = null;
		const area: AreaState = {
			views: [
				{
					instance: "search-1",
					kind: TEST_SEARCH_EXTENSION_KIND,
					state: { filePath: "/one.md" },
				},
			],
			activeInstance: "search-1",
		};
		renderWithinProvider(
			<PanelV2
				side="main"
				area={area}
				isFocused={true}
				onFocusArea={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				onRenameTab={() =>
					new Promise<boolean>((resolve) => {
						settleRename = resolve;
					})
				}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>,
		);

		// Stands in for wherever a browser sends the keyboard when the field
		// disables itself mid-rename: anywhere but the field.
		const elsewhere = document.createElement("button");
		document.body.append(elsewhere);

		const tab = screen.getByRole("button", { name: "Search" });
		tab.focus();
		fireEvent.keyDown(tab, { key: "F2" });
		const field = () =>
			document.querySelector<HTMLInputElement>(
				"[data-attr='panel-tab-rename-input']",
			);
		await waitFor(() => expect(field()).toHaveFocus());

		// The field disables itself while the workspace answers, and a browser
		// blurs a disabled input and refuses to focus one. The test DOM does
		// neither, so both are staged here.
		const input = field()!;
		const focusInput = input.focus.bind(input);
		const selectInput = input.select.bind(input);
		input.focus = () => {
			if (!input.disabled) focusInput();
		};
		input.select = () => {
			if (!input.disabled) selectInput();
		};
		fireEvent.change(input, { target: { value: "taken.md" } });
		fireEvent.keyDown(input, { key: "Enter" });
		await waitFor(() => expect(field()).toBeDisabled());
		elsewhere.focus();
		await act(async () => settleRename?.(false));

		// The field stays open on the name that was refused, so it is the field
		// the reader carries on typing in. Left blurred, the tab was a field
		// that answered neither what was typed into it nor the Escape meant to
		// leave it.
		await waitFor(() => expect(field()).toHaveFocus());
		expect(field()).toHaveAttribute("aria-invalid", "true");
		fireEvent.keyDown(field()!, { key: "Escape" });
		await waitFor(() => expect(field()).toBeNull());
		expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
		elsewhere.remove();
	});

	test("registers the panel container as a droppable target", () => {
		const droppableMock = vi.mocked(useDroppable);
		droppableMock.mockClear();
		renderWithinProvider(
			<PanelV2
				side="left"
				area={singleSearchPanel}
				isFocused={false}
				onFocusArea={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>,
		);

		expect(droppableMock).toHaveBeenCalledWith({
			id: "left-panel",
			data: { area: "left" },
		});
	});

	test("uses the tab label resolver when provided", () => {
		renderWithinProvider(
			<PanelV2
				side="left"
				area={singleSearchPanel}
				isFocused={false}
				onFocusArea={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				tabLabel={() => "Custom Search"}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Custom Search panel view menu" }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Custom Search panel view menu" }),
		).toHaveAttribute("data-attr", "panel-section-picker");
	});

	test("registers sortable handlers for tabs", () => {
		const sortableMock = vi.mocked(useSortable);
		sortableMock.mockClear();
		renderWithinProvider(
			<PanelV2
				side="main"
				area={singleSearchPanel}
				isFocused={false}
				onFocusArea={vi.fn()}
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
					area: "main",
					fromPanel: "main",
				}),
			}),
		);
	});

	test("renders the add-view button when onAddView is provided", () => {
		renderWithinProvider(
			<PanelV2
				side="main"
				area={singleSearchPanel}
				isFocused={false}
				onFocusArea={vi.fn()}
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
				area={pendingSearchPanel}
				isFocused={false}
				onFocusArea={vi.fn()}
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
				area={emptyPanel}
				isFocused={false}
				onFocusArea={vi.fn()}
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
				area={emptyPanel}
				isFocused={false}
				onFocusArea={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				emptyStatePlaceholder={<div />}
				viewContext={createViewContext()}
				dropId="custom-drop"
			/>,
		);

		expect(mocked).toHaveBeenCalledWith({
			id: "custom-drop",
			data: { area: "left" },
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
		const area: AreaState = {
			views: [{ instance: "lifecycle-1", kind: "lifecycle", state: { n: 1 } }],
			activeInstance: "lifecycle-1",
		};
		const rendered = renderWithinProvider(
			<PanelV2
				side="left"
				area={area}
				isFocused={true}
				onFocusArea={vi.fn()}
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
					area={{
						...area,
						views: [
							{ instance: "lifecycle-1", kind: "lifecycle", state: { n: 2 } },
						],
					}}
					isFocused={true}
					onFocusArea={vi.fn()}
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

	test("preserves focused extension DOM while its runtime snapshot updates", async () => {
		const area: AreaState = {
			views: [{ instance: "search-1", kind: TEST_SEARCH_EXTENSION_KIND }],
			activeInstance: "search-1",
		};
		const rendered = renderWithinProvider(
			<PanelV2
				side="left"
				area={area}
				isFocused={true}
				onFocusArea={vi.fn()}
				onSelectView={vi.fn()}
				onRemoveView={vi.fn()}
				viewContext={createViewContext()}
				viewOverrides={[searchViewOverride]}
			/>,
		);
		const input = await screen.findByPlaceholderText("Search project...");
		input.focus();
		expect(document.activeElement).toBe(input);

		rendered.rerender(
			<ExtensionHostRegistryProvider>
				<PanelV2
					side="left"
					area={area}
					isFocused={false}
					onFocusArea={vi.fn()}
					onSelectView={vi.fn()}
					onRemoveView={vi.fn()}
					viewContext={createViewContext()}
					viewOverrides={[searchViewOverride]}
				/>
			</ExtensionHostRegistryProvider>,
		);

		expect(await screen.findByPlaceholderText("Search project...")).toBe(input);
		expect(document.activeElement).toBe(input);
	});
});
