import { DndContext } from "@dnd-kit/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import type { FilesystemEntryRow } from "@/queries";
import { SidePanel } from "./side-panel";
import { ExtensionHostRegistryProvider } from "../extension-runtime/extension-host-registry";
import type { AreaState } from "../extension-runtime/types";
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
	const [area, setPanel] = useState<AreaState>({
		views: [],
		activeInstance: null,
	});
	return (
		<SidePanel
			side="left"
			title="Navigator"
			area={area}
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
			onFocusArea={() => {}}
		/>
	);
}

describe("SidePanel", () => {
	test("renders the empty state CTA and opens its view picker", async () => {
		const emptyPanel: AreaState = { views: [], activeInstance: null };
		const handleAdd = vi.fn();

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						area={emptyPanel}
						onSelectView={() => {}}
						onAddView={handleAdd}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusArea={vi.fn()}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		expect(
			screen.getByRole("heading", { name: "This is the left sidebar." }),
		).toBeInTheDocument();
		expect(screen.getByText("Open a view to get started.")).toBeInTheDocument();
		expect(
			screen.getByRole("complementary", { name: "Navigator" }),
		).toBeInTheDocument();
		// Views open from one-click chips, not a dropdown.
		const filesChip = screen.getByRole("button", { name: "Files" });
		expect(filesChip).toHaveAttribute("data-attr", "panel-empty-open-view");
		fireEvent.click(filesChip);
		expect(handleAdd).toHaveBeenCalledWith(FILES_EXTENSION_KIND);
		expect(screen.queryByText("No view open")).toBeNull();
	});

	test("uses the section picker for an opened view", async () => {
		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<StatefulSidePanel />
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Files" }));

		expect(
			await screen.findByRole("button", { name: "Files panel view menu" }),
		).toBeInTheDocument();
	});

	test("opens the section picker after keyboard selection", async () => {
		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<StatefulSidePanel />
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Files" }));

		const picker = await screen.findByRole("button", {
			name: "Files panel view menu",
		});
		picker.focus();
		fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });

		const filesItem = await screen.findByRole("menuitem", { name: "Files" });
		await waitFor(() => expect(filesItem).toHaveFocus());
		fireEvent.keyDown(filesItem, { key: "Enter", code: "Enter" });

		expect(
			await screen.findByRole("button", { name: "Files panel view menu" }),
		).toBeInTheDocument();
	});

	test("closing the section picker puts the keyboard back on it", async () => {
		const panelState: AreaState = {
			views: [{ instance: "files-1", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-1",
		};

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						area={panelState}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusArea={() => {}}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		const picker = await screen.findByRole("button", {
			name: "Files panel view menu",
		});

		// Choosing a view: the picker it was chosen from keeps the keyboard.
		picker.focus();
		fireEvent.pointerDown(picker, { button: 0 });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Files" }));
		// Not <body>: the next Tab carries on from the sidebar instead of
		// restarting at the top of the page.
		await waitFor(() => expect(picker).toHaveFocus());

		// And giving up on the menu, which is where dropping the keyboard is
		// least forgivable: nothing happened, and the reader is nowhere.
		fireEvent.pointerDown(picker, { button: 0 });
		await screen.findByRole("menuitem", { name: "Files" });
		fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
		await waitFor(() => expect(picker).toHaveFocus());
	});

	test("hides the sidebar from the section picker", async () => {
		const handleHide = vi.fn();
		const panelState: AreaState = {
			views: [{ instance: "files-1", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-1",
		};

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						area={panelState}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						onHidePanel={handleHide}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusArea={() => {}}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		fireEvent.pointerDown(
			screen.getByRole("button", { name: "Files panel view menu" }),
			{ button: 0 },
		);
		fireEvent.click(
			await screen.findByRole("menuitem", { name: /Hide sidebar/ }),
		);
		expect(handleHide).toHaveBeenCalledOnce();
	});

	test("omits Hide sidebar when the host cannot collapse the panel", async () => {
		const panelState: AreaState = {
			views: [{ instance: "files-1", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-1",
		};

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						area={panelState}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusArea={() => {}}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		fireEvent.pointerDown(
			screen.getByRole("button", { name: "Files panel view menu" }),
			{ button: 0 },
		);
		expect(
			await screen.findByRole("menuitem", { name: "Files" }),
		).toBeInTheDocument();
		expect(screen.queryByRole("menuitem", { name: /Hide sidebar/ })).toBeNull();
	});

	test("renders a host-provided empty state", () => {
		const emptyPanel: AreaState = { views: [], activeInstance: null };

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="right"
						title="Secondary"
						area={emptyPanel}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusArea={vi.fn()}
						emptyState={<button type="button">Start agent</button>}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		expect(
			screen.getByRole("button", { name: "Start agent" }),
		).toBeInTheDocument();
		expect(screen.queryByText("This is the right sidebar.")).toBeNull();
		expect(
			document.querySelector('[data-attr="panel-empty-open-view"]'),
		).toBeNull();
	});

	test("preserves an intentional blank empty-state override", () => {
		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="right"
						title="Secondary"
						area={{ views: [], activeInstance: null }}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusArea={() => {}}
						emptyState={null}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		expect(screen.queryByText("This is the right sidebar.")).toBeNull();
		expect(
			document.querySelector('[data-attr="panel-empty-open-view"]'),
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Add view" })).toBeNull();
	});

	test("renders the active view and forwards interactions", async () => {
		const panelState: AreaState = {
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
						area={panelState}
						onSelectView={handleSelect}
						onAddView={handleAdd}
						onRemoveView={handleRemove}
						viewContext={viewContext}
						isFocused={true}
						onFocusArea={vi.fn()}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		const filesPicker = await screen.findByRole("button", {
			name: "Files panel view menu",
		});
		fireEvent.pointerDown(filesPicker, { button: 0 });
		fireEvent.click(await screen.findByRole("menuitem", { name: "Files" }));
		expect(handleSelect).toHaveBeenCalledWith("files-1");

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
		const panelState: AreaState = {
			views: [{ instance: "files-1", kind: FILES_EXTENSION_KIND }],
			activeInstance: "files-1",
		};

		render(
			<ExtensionHostRegistryProvider>
				<DndContext>
					<SidePanel
						side="left"
						title="Navigator"
						area={panelState}
						onSelectView={() => {}}
						onAddView={() => {}}
						onRemoveView={() => {}}
						viewContext={createViewContext()}
						isFocused={false}
						onFocusArea={vi.fn()}
					/>
				</DndContext>
			</ExtensionHostRegistryProvider>,
		);

		expect(
			await screen.findByRole("button", { name: "Files panel view menu" }),
		).toBeInTheDocument();
	});
});
