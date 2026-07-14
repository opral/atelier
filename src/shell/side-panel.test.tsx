import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import type { FilesystemEntryRow } from "@/queries";
import { SidePanel } from "./side-panel";
import { ExtensionHostRegistryProvider } from "../extension-runtime/extension-host-registry";
import type { PanelState } from "../extension-runtime/types";
import { FILES_EXTENSION_KIND } from "../extension-runtime/extension-instance-helpers";
import type { Lix } from "@lix-js/sdk";
import { createExtensionHostContext } from "@/test-utils/extension-host-context";

const mockEntries: FilesystemEntryRow[] = [
	{
		id: "dir_root",
		parent_id: null,
		path: "/",
		display_name: "/",
		kind: "directory",
	},
	{
		id: "dir_docs",
		parent_id: "dir_root",
		path: "/docs/",
		display_name: "docs",
		kind: "directory",
	},
	{
		id: "dir_guides",
		parent_id: "dir_docs",
		path: "/docs/guides/",
		display_name: "guides",
		kind: "directory",
	},
	{
		id: "file_writing",
		parent_id: "dir_guides",
		path: "/docs/guides/writing-style.md",
		display_name: "writing-style.md",
		kind: "file",
	},
	{
		id: "file_readme",
		parent_id: "dir_docs",
		path: "/docs/README.md",
		display_name: "README.md",
		kind: "file",
	},
];

vi.mock("@/lib/lix-react", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/lix-react")>("@/lib/lix-react");
	return {
		...actual,
		useQuery: () => mockEntries,
		useLix: () => ({}) as any,
	};
});

vi.mock("../extension-runtime/extension-registry", async () => {
	const definitions = [
		{
			kind: "atelier_files" as const,
			label: "Files",
			description: "Browse and pin project documents.",
			icon: () => <svg></svg>,
			mount: ({
				atelier,
				element,
			}: {
				atelier: ReturnType<typeof createExtensionHostContext>["atelier"];
				element: HTMLElement;
			}) => {
				const button = document.createElement("button");
				button.type = "button";
				button.textContent = "writing-style.md";
				button.addEventListener("click", () => {
					void atelier.documents.open("/docs/guides/writing-style.md", {
						state: {
							atelier: { label: "writing-style.md" },
						},
						focus: false,
					});
				});
				element.replaceChildren(button);
				return {
					dispose: () => element.replaceChildren(),
				};
			},
		},
		{
			kind: "atelier_history" as const,
			label: "History",
			description: "Review and restore checkpoints.",
			icon: () => <svg></svg>,
			mount: ({ element }: { element: HTMLElement }) => {
				element.textContent = "History content";
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

const mockLix = {} as Lix;

const createViewContext = (
	openDocument?: ReturnType<
		typeof createExtensionHostContext
	>["atelier"]["documents"]["open"],
) => createExtensionHostContext(mockLix, { openDocument });

function StatefulSidePanel() {
	const [panel, setPanel] = useState<PanelState>({
		views: [],
		activeInstance: null,
	});
	return (
		<SidePanel
			side="left"
			title="Navigator"
			panel={panel}
			onSelectView={(instance) =>
				setPanel((current) => ({ ...current, activeInstance: instance }))
			}
			onAddView={(kind) =>
				setPanel({
					views: [{ instance: `${kind}-1`, kind }],
					activeInstance: `${kind}-1`,
				})
			}
			onRemoveView={() => setPanel({ views: [], activeInstance: null })}
			viewContext={createViewContext()}
			isFocused={true}
			onFocusPanel={() => {}}
		/>
	);
}

describe("SidePanel", () => {
	test("renders the empty state CTA and opens its view picker", async () => {
		const emptyPanel: PanelState = { views: [], activeInstance: null };
		const handleAdd = vi.fn();

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						panel={emptyPanel}
						onSelectView={() => {}}
						onAddView={handleAdd}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusPanel={vi.fn()}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		expect(
			screen.getByRole("heading", { name: "This is a panel." }),
		).toBeInTheDocument();
		expect(screen.getByText("It can open views.")).toBeInTheDocument();
		expect(
			screen.getByRole("complementary", { name: "Navigator" }),
		).toBeInTheDocument();
		const openView = screen.getByRole("button", { name: "Open a view" });
		expect(openView).toHaveAttribute("data-attr", "panel-empty-open-view");
		expect(openView).toHaveAttribute("data-ui", "atelier-action-button");
		expect(openView).toHaveAttribute("data-variant", "secondary");
		expect(
			screen.queryByRole("button", { name: "Open Files view" }),
		).toBeNull();
		fireEvent.pointerDown(openView, { button: 0 });

		const filesItem = await screen.findByRole("menuitem", { name: "Files" });
		expect(
			screen.getByRole("menuitem", { name: "History" }),
		).toBeInTheDocument();
		fireEvent.click(filesItem);
		expect(handleAdd).toHaveBeenCalledWith(FILES_EXTENSION_KIND);
		await waitFor(() => expect(openView).toHaveFocus());
		expect(screen.getByLabelText("Add view")).toBeInTheDocument();
		expect(screen.queryByText("No view open")).toBeNull();
	});

	test("moves focus into an opened view and back to the picker on close", async () => {
		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<StatefulSidePanel />
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		const openView = screen.getByRole("button", { name: "Open a view" });
		openView.focus();
		fireEvent.keyDown(openView, { key: "ArrowDown", code: "ArrowDown" });
		const filesItem = await screen.findByRole("menuitem", { name: "Files" });
		await waitFor(() => expect(filesItem).toHaveFocus());
		fireEvent.keyDown(filesItem, { key: "Enter", code: "Enter" });

		const filesTab = await screen.findByRole("button", { name: "Files" });
		await waitFor(() => expect(filesTab).toHaveFocus());
		const closeControl = filesTab.querySelector<SVGElement>(
			'[data-attr="panel-tab-close"]',
		);
		expect(closeControl).not.toBeNull();
		fireEvent.click(closeControl as SVGElement);

		await waitFor(() =>
			expect(screen.getByRole("button", { name: "Open a view" })).toHaveFocus(),
		);
	});

	test("keeps focus on the opened tab after keyboard selection from the add menu", async () => {
		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<StatefulSidePanel />
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		const addView = screen.getByRole("button", { name: "Add view" });
		addView.focus();
		fireEvent.keyDown(addView, { key: "ArrowDown", code: "ArrowDown" });

		const filesItem = await screen.findByRole("menuitem", { name: "Files" });
		await waitFor(() => expect(filesItem).toHaveFocus());
		fireEvent.keyDown(filesItem, { key: "Enter", code: "Enter" });

		const filesTab = await screen.findByRole("button", { name: "Files" });
		await waitFor(() => expect(filesTab).toHaveFocus());
	});

	test("renders a host-provided empty state", () => {
		const emptyPanel: PanelState = { views: [], activeInstance: null };

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="right"
						title="Secondary"
						panel={emptyPanel}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusPanel={vi.fn()}
						emptyState={<button type="button">Start agent</button>}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		expect(
			screen.getByRole("button", { name: "Start agent" }),
		).toBeInTheDocument();
		expect(screen.queryByText("This is a panel.")).toBeNull();
		expect(screen.queryByRole("button", { name: "Open a view" })).toBeNull();
	});

	test("preserves an intentional blank empty-state override", () => {
		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="right"
						title="Secondary"
						panel={{ views: [], activeInstance: null }}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusPanel={() => {}}
						emptyState={null}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		expect(screen.queryByText("This is a panel.")).toBeNull();
		expect(screen.queryByRole("button", { name: "Open a view" })).toBeNull();
		expect(
			screen.getByRole("button", { name: "Add view" }),
		).toBeInTheDocument();
	});

	test("renders the active view and forwards interactions", async () => {
		const panelState: PanelState = {
			views: [{ instance: "files-1", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-1",
		};
		const handleSelect = vi.fn();
		const handleAdd = vi.fn();
		const handleRemove = vi.fn();
		const handleOpenFile = vi.fn();
		const viewContext = createViewContext(handleOpenFile);

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						panel={panelState}
						onSelectView={handleSelect}
						onAddView={handleAdd}
						onRemoveView={handleRemove}
						viewContext={viewContext}
						isFocused={true}
						onFocusPanel={vi.fn()}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		const filesTab = await screen.findByRole("button", { name: "Files" });

		fireEvent.click(filesTab);
		expect(handleSelect).toHaveBeenCalledWith("files-1");

		expect(filesTab.getAttribute("data-focused")).toBe("true");

		const fileRow = await screen.findByRole(
			"button",
			{ name: "writing-style.md" },
			{ timeout: 5000 },
		);
		fireEvent.click(fileRow);
		expect(handleOpenFile).toHaveBeenCalledWith(
			"/docs/guides/writing-style.md",
			{
				state: {
					atelier: { label: "writing-style.md" },
				},
				focus: false,
			},
		);
	});

	test("removes focus flag when panel not focused", async () => {
		const panelState: PanelState = {
			views: [{ instance: "files-1", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-1",
		};

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						panel={panelState}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusPanel={vi.fn()}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		const filesTab = await screen.findByRole("button", { name: "Files" });
		expect(filesTab.getAttribute("data-focused")).toBeNull();
	});
});
