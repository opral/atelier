/* oxlint-disable react/jsx-no-constructed-context-values -- Test fixtures deliberately replace provider snapshots. */
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Search } from "lucide-react";
import { AtelierRenderContext } from "../atelier-render-context";
import type {
	ExtensionDefinition,
	ExtensionRuntime,
	ExtensionView,
} from "./types";
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

function controlledObservation() {
	const waiters: Array<(result: IteratorResult<unknown>) => void> = [];
	let closed = false;
	const next = vi.fn(
		() =>
			new Promise<IteratorResult<unknown>>((resolve) => {
				if (closed) resolve({ done: true, value: undefined });
				else waiters.push(resolve);
			}),
	);
	const returnIterator = vi.fn(async () => {
		closed = true;
		for (const resolve of waiters.splice(0))
			resolve({ done: true, value: undefined });
		return { done: true, value: undefined } as const;
	});
	const iterator: AsyncIterableIterator<unknown> = {
		next,
		return: returnIterator,
		[Symbol.asyncIterator]() {
			return this;
		},
	};
	return {
		iterator,
		next,
		returnIterator,
		emit() {
			const resolve = waiters.shift();
			if (!resolve) throw new Error("No observation read is waiting");
			resolve({ done: false, value: undefined });
		},
	};
}

function deferredRead<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("declarative extension hydration", () => {
	test("shows visible feedback while the initial read is pending", async () => {
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
					view={{
						...view,
						state: { fileId: "file-1", filePath: "/private/document.csv" },
					}}
				/>
			</AtelierRenderContext.Provider>,
		);
		try {
			expect(mounted.getByRole("status")).toHaveTextContent(
				"Opening document…",
			);
			expect(mounted.getByText("Opening document…")).not.toHaveClass(
				"atw:sr-only",
			);
			await waitFor(() => expect(load).toHaveBeenCalled());
			// Let the observer's initial frame settle while the first read is blocked.
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
					fileId: "file-1",
					viewKind: "custom",
					durationMs: expect.any(Number),
				}),
			);
		} finally {
			await act(async () => mounted.unmount());
			await lix.close();
		}
	});

	test("starts reading after observation begins and coalesces catch-up frames", async () => {
		const observer = controlledObservation();
		let current = "snapshot 1";
		const reads: Array<{
			snapshot: string;
			complete: (value: string) => void;
		}> = [];
		const load = vi.fn(() => {
			const snapshot = current;
			const read = deferredRead<string>();
			reads.push({ snapshot, complete: read.resolve });
			return read.promise;
		});
		const emit = vi.fn();
		const observe = vi.fn(() => observer.iterator);
		const atelier = {
			events: { emit },
			lix: { observe },
			branches: { activeId: "main" },
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
			expect(observer.next).toHaveBeenCalledTimes(1);
			expect(observer.next.mock.invocationCallOrder[0]).toBeLessThan(
				load.mock.invocationCallOrder[0]!,
			);
			expect(mounted.getByRole("status")).toHaveTextContent(
				"Opening document…",
			);

			// The first observer frame represents a change after the initial read
			// began. It marks that read dirty without starting a concurrent load.
			current = "snapshot 2";
			await act(async () => observer.emit());
			await waitFor(() => expect(observer.next).toHaveBeenCalledTimes(2));
			await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
			expect(load).toHaveBeenCalledTimes(1);

			await act(async () => reads[0]!.complete(reads[0]!.snapshot));
			expect(await mounted.findByRole("heading")).toHaveTextContent(
				"snapshot 1",
			);
			await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
			expect(reads[1]!.snapshot).toBe("snapshot 2");

			// A second frame during catch-up schedules one more read. The completed
			// catch-up remains visible while that latest read is still pending.
			current = "snapshot 3";
			await act(async () => observer.emit());
			await waitFor(() => expect(observer.next).toHaveBeenCalledTimes(3));
			await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
			expect(load).toHaveBeenCalledTimes(2);

			await act(async () => reads[1]!.complete(reads[1]!.snapshot));
			expect(mounted.getByRole("heading")).toHaveTextContent("snapshot 2");
			await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
			expect(reads[2]!.snapshot).toBe("snapshot 3");
			await act(async () => reads[2]!.complete(reads[2]!.snapshot));
			expect(mounted.getByRole("heading")).toHaveTextContent("snapshot 3");
		} finally {
			await act(async () => mounted.unmount());
			expect(observer.returnIterator).toHaveBeenCalledTimes(1);
		}
	});

	test("aborts stale loads on a file switch and on unmount", async () => {
		const observers: ReturnType<typeof controlledObservation>[] = [];
		const reads: Array<{
			path: string;
			signal: AbortSignal;
			complete: (value: string) => void;
		}> = [];
		const load = vi.fn(
			({
				location,
				signal,
			}: Parameters<NonNullable<ExtensionDefinition["load"]>>[0]) => {
				const path = "path" in location ? location.path : "revision";
				const read = deferredRead<string>();
				reads.push({ path, signal, complete: read.resolve });
				return read.promise;
			},
		);
		const emit = vi.fn();
		const lix = {
			observe: vi.fn(() => {
				const observer = controlledObservation();
				observers.push(observer);
				return observer.iterator;
			}),
		};
		const atelier = {
			events: { emit },
			lix,
			branches: { activeId: "main" },
		} as unknown as ExtensionRuntime;
		const definition = {
			kind: "custom",
			label: "Custom",
			description: "Custom",
			icon: Search,
			load,
			Component: ({ data }: { data: unknown }) => <h1>{String(data)}</h1>,
		};
		const tree = (fileId: string, filePath: string) => (
			<AtelierRenderContext.Provider value={{}}>
				<DeclarativeExtension
					definition={definition}
					atelier={atelier}
					view={{ ...view, state: { fileId, filePath } }}
				/>
			</AtelierRenderContext.Provider>
		);
		const mounted = render(tree("file-1", "/one.md"));
		let unmounted = false;
		try {
			await waitFor(() => expect(reads).toHaveLength(1));
			mounted.rerender(tree("file-2", "/two.md"));
			await waitFor(() => expect(reads).toHaveLength(2));
			expect(reads[0]!.signal.aborted).toBe(true);
			expect(observers[0]!.returnIterator).toHaveBeenCalledTimes(1);

			await act(async () => reads[1]!.complete("File two"));
			expect(await mounted.findByRole("heading")).toHaveTextContent("File two");
			await act(async () => reads[0]!.complete("Late file one"));
			expect(mounted.getByRole("heading")).toHaveTextContent("File two");

			mounted.rerender(tree("file-3", "/three.md"));
			await waitFor(() => expect(reads).toHaveLength(3));
			const emittedBeforeUnmount = emit.mock.calls.length;
			await act(async () => mounted.unmount());
			unmounted = true;
			expect(reads[2]!.signal.aborted).toBe(true);
			expect(observers[2]!.returnIterator).toHaveBeenCalledTimes(1);
			await act(async () => reads[2]!.complete("Late file three"));
			expect(emit).toHaveBeenCalledTimes(emittedBeforeUnmount);
		} finally {
			if (!unmounted)
				await act(async () => mounted.unmount());
		}
	});

	test("keeps the document's scoped Lix handle when the runtime is rebuilt", async () => {
		const lix = await openLix();
		// The host wraps the handle per document (a trace). A new wrapper is a
		// new query cache: every read of the view would start over.
		const scopeDocumentLix = vi.fn(
			(_path: string, _fileId: string | undefined, base: typeof lix) => base,
		);
		const runtime = () =>
			({
				events: { emit: vi.fn() },
				lix,
				scopeDocumentLix,
				branches: { activeId: "main" },
			}) as unknown as ExtensionRuntime;
		const definition = {
			kind: "custom",
			label: "Custom",
			description: "Custom",
			icon: Search,
			load: async () => "Loaded document",
			Component: ({ data }: { data: unknown }) => <h1>{String(data)}</h1>,
		};
		const documentView = {
			...view,
			state: { fileId: "file-1", filePath: "/notes.md" },
		};
		const mounted = render(
			<AtelierRenderContext.Provider value={{}}>
				<DeclarativeExtension
					definition={definition}
					atelier={runtime()}
					view={documentView}
				/>
			</AtelierRenderContext.Provider>,
		);
		try {
			await mounted.findByRole("heading");
			const calls = scopeDocumentLix.mock.calls.length;
			// The shell rebuilds the runtime on every change (the tab in front,
			// a review opening); the document is the same.
			for (let index = 0; index < 3; index += 1) {
				mounted.rerender(
					<AtelierRenderContext.Provider value={{}}>
						<DeclarativeExtension
							definition={definition}
							atelier={runtime()}
							view={documentView}
						/>
					</AtelierRenderContext.Provider>,
				);
			}
			expect(scopeDocumentLix.mock.calls.length).toBe(calls);
		} finally {
			mounted.unmount();
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
		const observer = controlledObservation();
		const lix = { observe: vi.fn(() => observer.iterator) };
		const completions: Array<(data: string) => void> = [];
		const load = vi.fn(
			() => new Promise<string>((resolve) => completions.push(resolve)),
		);
		const atelier = {
			lix,
			branches: { activeId: "main" },
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
			expect(initial()).toHaveClass("atw:invisible");
			act(() => vi.advanceTimersByTime(399));
			expect(initial()).toHaveClass("atw:invisible");
			act(() => vi.advanceTimersByTime(1));
			expect(initial()).not.toHaveClass("atw:invisible");
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
