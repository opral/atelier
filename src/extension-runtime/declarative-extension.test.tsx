/* oxlint-disable react/jsx-no-constructed-context-values -- Test fixtures deliberately replace provider snapshots. */
import { act, render } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { Search } from "lucide-react";
import { AtelierRenderContext } from "../atelier-render-context";
import type { AtelierInitialState } from "../atelier-state";
import type { ExtensionRuntime, ExtensionView } from "./types";
import { DeclarativeExtension } from "./declarative-extension";
import { PreparedFileSurface } from "./prepared-file";
import { openLix } from "../test-utils/node-lix-sdk";

const view = {
	instanceId: "view1",
	state: {},
	panel: "central",
	isActive: true,
	isFocused: true,
} as ExtensionView;

describe("declarative extension hydration", () => {
	test("surfaces refresh errors while preserving prepared content", async () => {
		const lix = await openLix();
		const atelier = {
			lix,
			branches: { activeId: await lix.activeBranchId() },
		} as unknown as ExtensionRuntime;
		const definition = {
			kind: "custom",
			label: "Custom",
			description: "Custom",
			icon: Search,
			load: async () => {
				throw new Error("Refresh unavailable");
			},
			Component: ({ data }: { data: unknown }) => <h1>{String(data)}</h1>,
		};
		const initialState = {
			views: { view1: { extensionId: "custom", data: "Prepared repository" } },
		} as unknown as AtelierInitialState;
		const mounted = render(
			<AtelierRenderContext.Provider
				value={{ initialState, connected: true, hydrated: true }}
			>
				<DeclarativeExtension
					definition={definition}
					atelier={atelier}
					view={view}
				/>
			</AtelierRenderContext.Provider>,
		);
		try {
			const heading = mounted.getByRole("heading");
			expect(await mounted.findByRole("alert")).toHaveTextContent(
				"Refresh unavailable",
			);
			expect(mounted.getByRole("heading")).toBe(heading);
			expect(heading).toHaveTextContent("Prepared repository");
		} finally {
			await act(async () => mounted.unmount());
			await lix.close();
		}
	});

	test("hydrates the exact prepared custom extension with no live Lix or loader calls", async () => {
		const load = vi.fn(async () => "unexpected");
		const execute = vi.fn(() => {
			throw new Error("No connection");
		});
		const atelier = {
			lix: { execute },
			branches: { activeId: "branch" },
		} as unknown as ExtensionRuntime;
		const definition = {
			kind: "custom",
			label: "Custom",
			description: "Custom",
			icon: Search,
			load,
			Component: ({ data }: { data: unknown }) => <h1>{String(data)}</h1>,
		};
		const initialState = {
			views: { view1: { extensionId: "custom", data: "Prepared repository" } },
		} as unknown as AtelierInitialState;
		const context = { initialState, hydrated: false, connected: false };
		const ui = (
			<AtelierRenderContext.Provider value={context}>
				<DeclarativeExtension
					definition={definition}
					atelier={atelier}
					view={view}
				/>
			</AtelierRenderContext.Provider>
		);
		const container = document.createElement("div");
		container.innerHTML = renderToString(ui);
		document.body.appendChild(container);
		const heading = container.querySelector("h1");
		const onRecoverableError = vi.fn();
		let root: Root | undefined;
		await act(async () => {
			root = hydrateRoot(container, ui, { onRecoverableError });
		});
		expect(container.querySelector("h1")).toBe(heading);
		expect(heading?.textContent).toBe("Prepared repository");
		expect(onRecoverableError).not.toHaveBeenCalled();
		expect(load).not.toHaveBeenCalled();
		expect(execute).not.toHaveBeenCalled();
		await act(async () => root?.unmount());
		container.remove();
	});
	test("keeps formatted content until the connected editor is ready", async () => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const contexts = {
			live: { hydrated: true, connected: true },
			disconnected: { hydrated: false, connected: false },
		};
		const ui = (connected: boolean) => (
			<AtelierRenderContext.Provider
				value={connected ? contexts.live : contexts.disconnected}
			>
				<PreparedFileSurface
					initial={<h1>Formatted document</h1>}
					readySelector=".ready-editor"
				>
					<div className="ready-editor">Interactive document</div>
				</PreparedFileSurface>
			</AtelierRenderContext.Provider>
		);
		container.innerHTML = renderToString(ui(false));
		expect(container.textContent).toBe("Formatted document");
		let root: Root | undefined;
		await act(async () => {
			root = hydrateRoot(container, ui(false));
		});
		expect(container.textContent).toBe("Formatted document");
		await act(async () => {
			root?.render(ui(true));
		});
		expect(container.textContent).toBe("Interactive document");
		await act(async () => {
			root?.render(ui(false));
		});
		expect(container.textContent).toBe("Formatted document");
		await act(async () => root?.unmount());
		container.remove();
	});
});
