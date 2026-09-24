import { act, render, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type {
	AtelierExtensionPreferences,
	AtelierJsonValue,
} from "@/extension-api";
import type { ExtensionRuntime } from "@/extension-runtime/types";
import { LixProvider } from "@/lib/lix-react";
import { qb } from "@/lib/lix-kysely";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import {
	forgetSessionViewports,
	VIEWPORT_PERSIST_DEBOUNCE_MS,
	VIEWPORTS_PREFERENCE_KEY,
} from "./viewport";

/**
 * Excalidraw itself does not run under happy-dom; a stand-in records what
 * the canvas is handed and lets a test move its viewport.
 */
const excalidraw = vi.hoisted(() => {
	type Props = {
		initialData: {
			appState: Record<string, unknown>;
			scrollToContent?: boolean;
		};
		onChange: (elements: unknown[], appState: unknown, files: unknown) => void;
		excalidrawAPI: (api: unknown) => void;
	};
	const state = {
		mounts: 0,
		unmounts: 0,
		latest: null as Props | null,
		appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 } } as {
			scrollX: number;
			scrollY: number;
			zoom: { value: number };
		},
		updates: [] as unknown[],
	};
	return {
		state,
		/** The reader pans/zooms the mounted canvas. */
		move(scrollX: number, scrollY: number, zoom: number) {
			state.appState = { scrollX, scrollY, zoom: { value: zoom } };
			state.latest?.onChange([], state.appState, {});
		},
	};
});

vi.mock("@excalidraw/excalidraw", () => {
	function Excalidraw(props: {
		initialData: {
			appState: Record<string, unknown>;
			scrollToContent?: boolean;
		};
		onChange: (elements: unknown[], appState: unknown, files: unknown) => void;
		excalidrawAPI: (api: unknown) => void;
	}) {
		excalidraw.state.latest = props;
		useEffect(() => {
			excalidraw.state.mounts += 1;
			props.excalidrawAPI({
				updateScene: (update: { appState?: unknown }) => {
					excalidraw.state.updates.push(update);
				},
				addFiles: () => {},
			});
			// Like Excalidraw: the canvas settles on its initial viewport and
			// reports it — a fitted one when asked to scroll to content.
			const initial = props.initialData.appState as {
				scrollX?: number;
				scrollY?: number;
				zoom?: { value: number };
			};
			excalidraw.state.appState = props.initialData.scrollToContent
				? { scrollX: 11, scrollY: 22, zoom: { value: 1 } }
				: {
						scrollX: initial.scrollX ?? 0,
						scrollY: initial.scrollY ?? 0,
						zoom: initial.zoom ?? { value: 1 },
					};
			props.onChange([], excalidraw.state.appState, {});
			return () => {
				excalidraw.state.unmounts += 1;
			};
			// Mount-only, as Excalidraw reads initialData once.
			// eslint-disable-next-line react-hooks/exhaustive-deps
		}, []);
		return <canvas data-testid="excalidraw-canvas" />;
	}
	const Stub = () => null;
	const MainMenu = Object.assign(
		({ children }: { children?: unknown }) => children ?? null,
		{
			DefaultItems: {
				SaveAsImage: Stub,
				ClearCanvas: Stub,
				Help: Stub,
				ChangeCanvasBackground: Stub,
			},
			Separator: Stub,
		},
	);
	return {
		Excalidraw,
		MainMenu,
		CaptureUpdateAction: { NEVER: "NEVER" },
		// A constant, so the scene never differs from its baseline and the
		// canvas never writes the file back.
		serializeAsJSON: () => "scene",
	};
});

/** Lets a test force the file query back to pending, as a re-read does. */
const query = vi.hoisted(() => ({ forcePending: false }));
vi.mock("@/lib/lix-react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/lix-react")>();
	return {
		...actual,
		useQueryResult: ((...args: Parameters<typeof actual.useQueryResult>) => {
			const result = actual.useQueryResult(...args);
			return query.forcePending ? { status: "pending" } : result;
		}) as typeof actual.useQueryResult,
	};
});

const { ExcalidrawView } = await import("./index");

type Lix = Awaited<ReturnType<typeof openLix>>;

const SCENE = JSON.stringify({
	type: "excalidraw",
	version: 2,
	elements: [],
	appState: {},
	files: {},
});

function memoryPreferences(): AtelierExtensionPreferences & {
	readonly values: Map<string, AtelierJsonValue>;
} {
	const values = new Map<string, AtelierJsonValue>();
	return {
		values,
		get: (key) => values.get(key),
		set: (key, value) => {
			values.set(key, value);
		},
		delete: (key) => {
			values.delete(key);
		},
	};
}

async function atelierFor(lix: Lix): Promise<ExtensionRuntime> {
	return {
		lix,
		readOnly: false,
		events: { emit: () => {} },
		documents: {
			open: () => Promise.resolve(),
			startNew: () => Promise.resolve(),
			closeActive: () => {},
			close: () => {},
			closeAll: () => {},
			activeFileId: null,
			activeFilePath: null,
		},
		views: { open: () => {} },
		preferences: { get: () => undefined, set: () => {} },
		icons: { fileUrl: () => "" },
		branches: { activeId: await lix.activeBranchId() },
		diff: { session: null },
	} as unknown as ExtensionRuntime;
}

describe("Excalidraw viewport", () => {
	let lix: Lix;
	let atelier: ExtensionRuntime;
	const fileA = fakeUuid("viewport-a");
	const fileB = fakeUuid("viewport-b");
	let views: ReturnType<typeof render>[] = [];

	beforeEach(async () => {
		forgetSessionViewports();
		query.forcePending = false;
		excalidraw.state.mounts = 0;
		excalidraw.state.unmounts = 0;
		excalidraw.state.latest = null;
		excalidraw.state.updates = [];
		lix = await openLix();
		atelier = await atelierFor(lix);
		await qb(lix)
			.insertInto("lix_file")
			.values([
				{
					id: fileA,
					path: "/a.excalidraw",
					content: new TextEncoder().encode(SCENE),
				},
				{
					id: fileB,
					path: "/b.excalidraw",
					content: new TextEncoder().encode(SCENE),
				},
			])
			.execute();
	});

	afterEach(async () => {
		for (const view of views) await act(async () => view.unmount());
		views = [];
		vi.useRealTimers();
		await lix.close();
	});

	async function mount(
		fileId: string,
		preferences?: AtelierExtensionPreferences,
	) {
		const mountsBefore = excalidraw.state.mounts;
		let view!: ReturnType<typeof render>;
		const element = (pending: boolean) => {
			query.forcePending = pending;
			return (
				<LixProvider lix={lix}>
					<ExcalidrawView
						atelier={atelier}
						fileId={fileId}
						preferences={preferences}
					/>
				</LixProvider>
			);
		};
		await act(async () => {
			view = render(element(false));
		});
		views.push(view);
		await waitFor(() => expect(excalidraw.state.mounts).toBe(mountsBefore + 1));
		return {
			view,
			rerender: async (pending: boolean) => {
				await act(async () => view.rerender(element(pending)));
			},
			unmount: async () => {
				await act(async () => view.unmount());
				views = views.filter((candidate) => candidate !== view);
			},
		};
	}

	function initialData() {
		return excalidraw.state.latest!.initialData;
	}

	test("fits the drawing when nothing is remembered", async () => {
		await mount(fileA);
		expect(initialData().scrollToContent).toBe(true);
		expect(initialData().appState).not.toHaveProperty("scrollX");
	});

	test("reopens at the viewport the reader left, without fitting", async () => {
		const first = await mount(fileA);
		excalidraw.move(-120, 340, 1.5);
		await first.unmount();

		await mount(fileA);
		expect(initialData().scrollToContent).toBe(false);
		expect(initialData().appState).toMatchObject({
			scrollX: -120,
			scrollY: 340,
			zoom: { value: 1.5 },
		});
	});

	test("remembers the viewport per file", async () => {
		const a = await mount(fileA);
		excalidraw.move(5, 6, 2);
		await a.unmount();

		const b = await mount(fileB);
		expect(initialData().scrollToContent).toBe(true);
		excalidraw.move(-7, -8, 0.5);
		await b.unmount();

		await mount(fileA);
		expect(initialData()).toMatchObject({
			scrollToContent: false,
			appState: { scrollX: 5, scrollY: 6, zoom: { value: 2 } },
		});
	});

	test("the fitted viewport a canvas opens at is not remembered", async () => {
		const first = await mount(fileA);
		await first.unmount();
		await mount(fileA);
		expect(initialData().scrollToContent).toBe(true);
	});

	test("persists the viewport in the view's preferences, so a reload restores it", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const preferences = memoryPreferences();
		const first = await mount(fileA, preferences);
		excalidraw.move(30, 40, 0.75);
		// A pan is written once it settles, not on every frame.
		expect(preferences.values.has(VIEWPORTS_PREFERENCE_KEY)).toBe(false);
		await act(async () => {
			vi.advanceTimersByTime(VIEWPORT_PERSIST_DEBOUNCE_MS);
		});
		expect(preferences.get(VIEWPORTS_PREFERENCE_KEY)).toMatchObject({
			[fileA]: { scrollX: 30, scrollY: 40, zoom: 0.75 },
		});
		await first.unmount();
		vi.useRealTimers();

		// A reload: this page's memory is gone, the preferences are not.
		forgetSessionViewports();
		await mount(fileA, preferences);
		expect(initialData()).toMatchObject({
			scrollToContent: false,
			appState: { scrollX: 30, scrollY: 40, zoom: { value: 0.75 } },
		});
	});

	test("unmounting flushes a viewport that has not been written yet", async () => {
		const preferences = memoryPreferences();
		const first = await mount(fileA, preferences);
		excalidraw.move(1, 2, 3);
		await first.unmount();
		expect(preferences.get(VIEWPORTS_PREFERENCE_KEY)).toMatchObject({
			[fileA]: { scrollX: 1, scrollY: 2, zoom: 3 },
		});
	});

	test("applies a remembered viewport that loads after the canvas mounted", async () => {
		const preferences = memoryPreferences();
		const mounted = await mount(fileA, preferences);
		expect(initialData().scrollToContent).toBe(true);
		// The workspace's preferences arrive late, as they load asynchronously.
		preferences.set(VIEWPORTS_PREFERENCE_KEY, {
			[fileA]: { scrollX: 9, scrollY: 8, zoom: 2, at: 1 },
		});
		await mounted.rerender(false);
		expect(excalidraw.state.updates).toContainEqual({
			appState: { scrollX: 9, scrollY: 8, zoom: { value: 2 } },
			captureUpdate: "NEVER",
		});
		expect(excalidraw.state.mounts).toBe(1);
	});

	test("keeps the canvas mounted when the file query is pending again", async () => {
		const mounted = await mount(fileA);
		excalidraw.move(50, 60, 1.25);
		await mounted.rerender(true);
		expect(excalidraw.state.unmounts).toBe(0);
		expect(excalidraw.state.mounts).toBe(1);
		expect(mounted.view.queryByText("Loading drawing…")).toBeNull();
		expect(mounted.view.getByTestId("excalidraw-canvas")).toBeTruthy();
		await mounted.rerender(false);
		expect(excalidraw.state.mounts).toBe(1);
	});

	test("the first read still shows the loading state", async () => {
		query.forcePending = true;
		let view!: ReturnType<typeof render>;
		await act(async () => {
			view = render(
				<LixProvider lix={lix}>
					<ExcalidrawView atelier={atelier} fileId={fileA} />
				</LixProvider>,
			);
		});
		views.push(view);
		expect(view.getByText("Loading drawing…")).toBeTruthy();
		expect(excalidraw.state.mounts).toBe(0);
	});
});
