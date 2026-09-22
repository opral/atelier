/* oxlint-disable react/jsx-no-constructed-context-values -- Test fixtures deliberately replace provider snapshots. */
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Search } from "lucide-react";
import { AtelierRenderContext } from "../atelier-render-context";
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
			<AtelierRenderContext.Provider value={{}}>
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
			<AtelierRenderContext.Provider value={{}}>
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
			<AtelierRenderContext.Provider value={{}}>
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
		const lix = await openLix();
		let ready = false;
		let resolve!: () => void;
		const gate = new Promise<void>((done) => {
			resolve = done;
		});
		const emit = vi.fn();
		const atelier = {
			lix,
			branches: { activeId: "branch" },
			events: { emit },
		} as unknown as ExtensionRuntime;
		const definition = {
			kind: "custom",
			label: "Custom",
			description: "Custom",
			icon: Search,
			load: async () => "Loaded",
			Component: () => {
				if (!ready) throw gate;
				return <h1>Ready</h1>;
			},
		};
		const mounted = render(
			<AtelierRenderContext.Provider value={{}}>
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
			expect(await mounted.findByRole("heading")).toHaveTextContent("Ready");
			await waitFor(() => expect(emit).toHaveBeenCalledTimes(1));
		} finally {
			await act(async () => mounted.unmount());
			await lix.close();
		}
	});

	test("shows a later load failure without discarding the visible document", async () => {
		const lix = await openLix();
		const atelier = {
			lix,
			branches: { activeId: await lix.activeBranchId() },
		} as unknown as ExtensionRuntime;
		let fail = false;
		const definition = {
			kind: "custom",
			label: "Custom",
			description: "Custom",
			icon: Search,
			load: async () => {
				if (fail) throw new Error("Refresh unavailable");
				return "Loaded document";
			},
			Component: ({ data }: { data: unknown }) => <h1>{String(data)}</h1>,
		};
		const tree = (sourceCommitId: string) => (
			<DeclarativeExtension
				definition={definition}
				atelier={atelier}
				view={{ ...view, state: { filePath: "/file.txt", sourceCommitId } }}
			/>
		);
		const mounted = render(tree("/first.txt"));
		try {
			const heading = await mounted.findByRole("heading");
			fail = true;
			mounted.rerender(tree("/second.txt"));
			expect(await mounted.findByRole("alert")).toHaveTextContent(
				"Refresh unavailable",
			);
			expect(mounted.getByRole("heading")).toBe(heading);
			expect(heading).toHaveTextContent("Loaded document");
		} finally {
			await act(async () => mounted.unmount());
			await lix.close();
		}
	});

	test("keeps formatted content until the mounted editor is ready", async () => {
		const tree = (ready: boolean) => (
			<PreparedFileSurface
				initial={<h1>Formatted document</h1>}
				readySelector=".ready-editor"
			>
				{ready ? (
					<div className="ready-editor">Interactive document</div>
				) : null}
			</PreparedFileSurface>
		);
		const mounted = render(tree(false));
		expect(mounted.getByRole("heading")).toHaveTextContent(
			"Formatted document",
		);
		mounted.rerender(tree(true));
		await waitFor(() => expect(mounted.queryByRole("heading")).toBeNull());
		expect(mounted.getByText("Interactive document")).toBeVisible();
		mounted.unmount();
	});

	// The prepared picture is drawn differently from the surface it stands
	// in for (a plain table for a canvas grid), so on a quick open it flashed
	// for a frame or two. It stays out of sight for a moment and is only
	// seen when the surface takes longer than that.
	test("keeps the prepared picture out of sight on a quick open", async () => {
		vi.useFakeTimers();
		try {
			const tree = (ready: boolean) => (
				<PreparedFileSurface
					initial={<h1>Formatted document</h1>}
					readySelector=".ready-editor"
					holdInitialMs={400}
				>
					{ready ? (
						<div className="ready-editor">Interactive document</div>
					) : null}
				</PreparedFileSurface>
			);
			const mounted = render(tree(false));
			const initial = () =>
				mounted.container.querySelector("[data-atelier-initial-content]");
			expect(initial()).toHaveClass("invisible");
			act(() => vi.advanceTimersByTime(399));
			expect(initial()).toHaveClass("invisible");
			act(() => vi.advanceTimersByTime(1));
			expect(initial()).not.toHaveClass("invisible");
			// A quick open never shows it at all.
			const quick = render(tree(false));
			quick.rerender(tree(true));
			await act(async () => {});
			expect(
				quick.container.querySelector("[data-atelier-initial-content]"),
			).toBeNull();
			quick.unmount();
			mounted.unmount();
		} finally {
			vi.useRealTimers();
		}
	});
});
