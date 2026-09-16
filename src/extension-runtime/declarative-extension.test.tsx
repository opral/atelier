/* oxlint-disable react/jsx-no-constructed-context-values -- Test fixtures deliberately replace provider snapshots. */
import { act, render, waitFor } from "@testing-library/react";
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
	area: "main",
	isActive: true,
	isFocused: true,
} as ExtensionView;

describe("declarative extension hydration", () => {
	test("loads once for the initial observation and shows visible feedback until ready", async () => {
		const lix = await openLix();
		let finish!: (data: string) => void;
		const load = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					finish = resolve;
				}),
		);
		const emit = vi.fn();
		const atelier = {
			events: { emit },
			lix,
			branches: { activeId: await lix.activeBranchId() },
		} as unknown as ExtensionRuntime;
		const definition = {
			kind: "custom",
			label: "Custom",
			description: "Custom",
			icon: Search,
			load,
			Component: ({ data }: { data: unknown }) => <h1>{String(data)}</h1>,
		};
		const mounted = render(
			<AtelierRenderContext.Provider
				value={{ connected: true, hydrated: true }}
			>
				<DeclarativeExtension
					definition={definition}
					atelier={atelier}
					view={{ ...view, state: { filePath: "/private/document.csv" } }}
				/>
			</AtelierRenderContext.Provider>,
		);
		try {
			expect(mounted.getByRole("status")).toHaveTextContent(
				"Opening document…",
			);
			expect(mounted.getByText("Opening document…")).not.toHaveClass("sr-only");
			await waitFor(() => expect(load).toHaveBeenCalled());
			// Let the observer's initial frame settle while the document fetch is blocked.
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 100));
			});
			expect(load).toHaveBeenCalledTimes(1);
			expect(emit).not.toHaveBeenCalled();
			await act(async () => finish("Loaded document"));
			expect(await mounted.findByRole("heading")).toHaveTextContent(
				"Loaded document",
			);
			expect(mounted.queryByRole("status")).toBeNull();
			expect(emit).toHaveBeenCalledTimes(1);
			expect(emit).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "document_loaded",
					viewKind: "custom",
					durationMs: expect.any(Number),
				}),
			);
		} finally {
			await act(async () => mounted.unmount());
			await lix.close();
		}
	});

	test("coalesces changes during a slow read and refreshes after it completes", async () => {
		const lix = await openLix();
		const completions: Array<(data: string) => void> = [];
		const load = vi.fn(
			() => new Promise<string>((resolve) => completions.push(resolve)),
		);
		const atelier = {
			lix,
			branches: { activeId: await lix.activeBranchId() },
		} as unknown as ExtensionRuntime;
		const definition = {
			kind: "custom",
			label: "Custom",
			description: "Custom",
			icon: Search,
			load,
			Component: ({ data }: { data: unknown }) => <h1>{String(data)}</h1>,
		};
		const mounted = render(
			<AtelierRenderContext.Provider
				value={{ connected: true, hydrated: true }}
			>
				<DeclarativeExtension
					definition={definition}
					atelier={atelier}
					view={view}
				/>
			</AtelierRenderContext.Provider>,
		);
		try {
			await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
			for (let i = 0; i < 3; i++) {
				await lix.execute(
					"INSERT INTO lix_file(path, content) VALUES ($1, $2)",
					[`/change-${i}.txt`, new TextEncoder().encode("changed")],
				);
			}
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 100));
			});
			expect(load).toHaveBeenCalledTimes(1);
			await act(async () => completions[0]!("First result"));
			await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
			expect(mounted.getByRole("heading")).toHaveTextContent("First result");
			await act(async () => completions[1]!("Current result"));
			expect(mounted.getByRole("heading")).toHaveTextContent("Current result");
		} finally {
			await act(async () => mounted.unmount());
			await lix.close();
		}
	});

	test("keeps the document mounted while a revision change loads again", async () => {
		const lix = await openLix();
		const completions: Array<(data: string) => void> = [];
		const load = vi.fn(
			() => new Promise<string>((resolve) => completions.push(resolve)),
		);
		const atelier = {
			lix,
			branches: { activeId: await lix.activeBranchId() },
		} as unknown as ExtensionRuntime;
		const definition = {
			kind: "custom",
			label: "Custom",
			description: "Custom",
			icon: Search,
			load,
			Component: ({ data }: { data: unknown }) => <h1>{String(data)}</h1>,
		};
		const live = { fileId: "file-1", filePath: "/private/document.md" };
		const revision = {
			...live,
			beforeCommitId: "commit-before",
			afterCommitId: "commit-after",
		};
		const tree = (state: Record<string, string>) => (
			<AtelierRenderContext.Provider
				value={{ connected: true, hydrated: true }}
			>
				<DeclarativeExtension
					definition={definition}
					atelier={atelier}
					view={{ ...view, state }}
				/>
			</AtelierRenderContext.Provider>
		);
		const mounted = render(tree(live));
		try {
			await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
			await act(async () => completions[0]!("Live document"));
			expect(mounted.getByRole("heading")).toHaveTextContent("Live document");

			// Entering a review reads the file at its revision. Until that read
			// lands the view stays on what it has: no loading state, no remount.
			mounted.rerender(tree(revision));
			await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
			expect(mounted.queryByRole("status")).toBeNull();
			expect(mounted.getByRole("heading")).toHaveTextContent("Live document");
			await act(async () => completions[1]!("Revision document"));
			expect(mounted.getByRole("heading")).toHaveTextContent(
				"Revision document",
			);

			// Leaving it is the same in reverse, back to the first location.
			mounted.rerender(tree(live));
			await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
			expect(mounted.queryByRole("status")).toBeNull();
			expect(mounted.getByRole("heading")).toHaveTextContent(
				"Revision document",
			);
			await act(async () => completions[2]!("Live document again"));
			expect(mounted.getByRole("heading")).toHaveTextContent(
				"Live document again",
			);

			// Another document in the same view — a review stepping to its
			// next file — keeps the page it has until its own read lands, then
			// swaps in one commit: no loading state in between.
			mounted.rerender(tree({ fileId: "file-2", filePath: "/other.md" }));
			await waitFor(() => expect(load).toHaveBeenCalledTimes(4));
			expect(mounted.queryByRole("status")).toBeNull();
			expect(mounted.getByRole("heading")).toHaveTextContent(
				"Live document again",
			);
			await act(async () => completions[3]!("Other document"));
			expect(mounted.getByRole("heading")).toHaveTextContent("Other document");
		} finally {
			await act(async () => mounted.unmount());
			await lix.close();
		}
	});

	test("does not report a loaded document while its renderer is suspended", async () => {
		let ready = false;
		let resolve!: () => void;
		const gate = new Promise<void>((done) => {
			resolve = done;
		});
		const emit = vi.fn();
		const atelier = {
			lix: {},
			branches: { activeId: "branch" },
			events: { emit },
		} as unknown as ExtensionRuntime;
		const definition = {
			kind: "custom",
			label: "Custom",
			description: "Custom",
			icon: Search,
			Component: () => {
				if (!ready) throw gate;
				return <h1>Ready</h1>;
			},
		};
		const initialState = {
			views: { view1: { extensionId: "custom", data: "Prepared" } },
		} as unknown as AtelierInitialState;
		const mounted = render(
			<AtelierRenderContext.Provider
				value={{ initialState, connected: true, hydrated: true }}
			>
				<DeclarativeExtension
					atelier={atelier}
					definition={definition}
					view={{ ...view, state: { filePath: "/file.csv" } }}
				/>
			</AtelierRenderContext.Provider>,
		);
		try {
			expect(mounted.getByRole("status")).toHaveTextContent(
				"Opening document…",
			);
			expect(emit).not.toHaveBeenCalled();
			await act(async () => {
				ready = true;
				resolve();
			});
			expect(mounted.getByRole("heading")).toHaveTextContent("Ready");
			expect(emit).toHaveBeenCalledTimes(1);
		} finally {
			mounted.unmount();
		}
	});

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
