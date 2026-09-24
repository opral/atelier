import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	CaptureUpdateAction,
	Excalidraw,
	MainMenu,
	serializeAsJSON,
} from "@excalidraw/excalidraw";
import type {
	BinaryFiles,
	ExcalidrawImperativeAPI,
	ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";
import { useDebouncedPayloadPersistence } from "@/extension-runtime/use-debounced-payload-persistence";
import "@excalidraw/excalidraw/index.css";
import { parseExcalidrawScene } from "./scene";
import { viewportsEqual, type ExcalidrawViewport } from "./viewport";

const PERSIST_DEBOUNCE_MS = 400;

export type ExcalidrawCanvasProps = {
	/** Raw text of the `.excalidraw` document currently persisted. */
	readonly sceneJson: string;
	readonly readOnly: boolean;
	/**
	 * Called with the full serialized scene document after local edits
	 * settle. Never called while `readOnly` is true.
	 */
	readonly onSceneChange?: (serialized: string) => void;
	/**
	 * Where the reader last left this file. The canvas opens there instead of
	 * fitting the drawing into view; with none, it fits. A value that arrives
	 * after mount (preferences loaded late) is applied while the reader has
	 * not moved the canvas yet.
	 */
	readonly viewport?: ExcalidrawViewport;
	/**
	 * Called when the reader scrolls or zooms. Cheap and frequent — every
	 * frame of a pan — so it must not render.
	 */
	readonly onViewportChange?: (viewport: ExcalidrawViewport) => void;
};

function viewportOf(appState: AppState): ExcalidrawViewport {
	return {
		scrollX: appState.scrollX,
		scrollY: appState.scrollY,
		zoom: appState.zoom.value,
	};
}

function viewportAppState(viewport: ExcalidrawViewport) {
	return {
		scrollX: viewport.scrollX,
		scrollY: viewport.scrollY,
		zoom: { value: viewport.zoom as AppState["zoom"]["value"] },
	};
}

/**
 * The Excalidraw surface. This module is loaded lazily so the drawing
 * runtime stays out of the initial Atelier bundle.
 */
export default function ExcalidrawCanvas({
	sceneJson,
	readOnly,
	onSceneChange,
	viewport,
	onViewportChange,
}: ExcalidrawCanvasProps) {
	const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
	// The viewport the canvas is known to be at (unset until its first change
	// event, which is the canvas settling on its initial viewport, not the
	// reader moving it), and whether the reader has moved it since.
	const shownViewportRef = useRef<ExcalidrawViewport | undefined>(undefined);
	const readerMovedRef = useRef(false);
	const initialViewportRef = useRef(viewport);
	const lateViewportRef = useRef<ExcalidrawViewport | undefined>(undefined);
	const onViewportChangeRef = useRef(onViewportChange);
	useEffect(() => {
		onViewportChangeRef.current = onViewportChange;
	}, [onViewportChange]);

	const showViewport = useCallback((next: ExcalidrawViewport) => {
		const api = apiRef.current;
		if (!api) return;
		shownViewportRef.current = next;
		api.updateScene({
			appState: viewportAppState(next),
			captureUpdate: CaptureUpdateAction.NEVER,
		});
	}, []);
	type ScenePayload = {
		readonly elements: readonly OrderedExcalidrawElement[];
		readonly appState: AppState;
		readonly files: BinaryFiles;
	};
	const { capture, isCurrent, resetBaseline } =
		useDebouncedPayloadPersistence<ScenePayload>({
			initialSerialized: sceneJson,
			serialize: ({ elements, appState, files }) =>
				serializeAsJSON(
					elements.filter((element) => !element.isDeleted),
					appState,
					files,
					"local",
				),
			onPersist: onSceneChange,
			debounceMs: PERSIST_DEBOUNCE_MS,
			disabled: readOnly,
		});

	const initialData = useMemo<ExcalidrawInitialDataState>(() => {
		const parsed = parseExcalidrawScene(sceneJson);
		const scene = parsed.ok
			? parsed.scene
			: { elements: [], appState: {}, files: {} };
		return {
			elements: scene.elements as ExcalidrawInitialDataState["elements"],
			appState: (viewport
				? { ...scene.appState, ...viewportAppState(viewport) }
				: scene.appState) as ExcalidrawInitialDataState["appState"],
			files: scene.files as unknown as BinaryFiles,
			// Fit the drawing only when there is no viewport to return to.
			scrollToContent: !viewport,
		};
		// The initial document and viewport are captured once on mount; later
		// updates flow through updateScene below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleChange = useCallback(
		(
			elements: readonly OrderedExcalidrawElement[],
			appState: AppState,
			files: BinaryFiles,
		) => {
			capture({ elements, appState, files });
			const next = viewportOf(appState);
			const shown = shownViewportRef.current;
			if (viewportsEqual(shown, next)) return;
			shownViewportRef.current = next;
			if (shown === undefined) {
				const late = lateViewportRef.current;
				lateViewportRef.current = undefined;
				if (late && !viewportsEqual(late, next)) showViewport(late);
				return;
			}
			readerMovedRef.current = true;
			onViewportChangeRef.current?.(next);
		},
		[capture, showViewport],
	);

	// A remembered viewport that arrives after mount — the preferences were
	// still loading — is applied while the reader has not moved the canvas;
	// before the canvas has settled, it is applied when it does.
	useEffect(() => {
		if (!viewport || readerMovedRef.current) return;
		if (viewportsEqual(viewport, initialViewportRef.current)) return;
		if (viewportsEqual(viewport, shownViewportRef.current)) return;
		if (shownViewportRef.current === undefined) {
			lateViewportRef.current = viewport;
			return;
		}
		showViewport(viewport);
	}, [showViewport, viewport]);

	// Apply external document changes (agent writes, review swaps) onto the
	// live canvas without remounting so the viewport is preserved.
	useEffect(() => {
		if (isCurrent(sceneJson)) return;
		const api = apiRef.current;
		if (!api) {
			resetBaseline(sceneJson);
			return;
		}
		const parsed = parseExcalidrawScene(sceneJson);
		if (!parsed.ok) return;
		// updateScene fires onChange; re-baseline on that event instead of
		// treating the programmatic update as a local edit to persist.
		resetBaseline(sceneJson);
		api.updateScene({
			elements: parsed.scene
				.elements as unknown as readonly OrderedExcalidrawElement[],
			captureUpdate: CaptureUpdateAction.NEVER,
		});
		const files = Object.values(parsed.scene.files);
		if (files.length > 0) {
			api.addFiles(files as Parameters<typeof api.addFiles>[0]);
		}
	}, [isCurrent, resetBaseline, sceneJson]);

	return (
		<Excalidraw
			excalidrawAPI={(api) => {
				apiRef.current = api;
			}}
			initialData={initialData}
			onChange={handleChange}
			viewModeEnabled={readOnly}
			theme="light"
			UIOptions={{
				canvasActions: {
					loadScene: false,
					saveToActiveFile: false,
					toggleTheme: false,
					export: false,
				},
				tools: { image: true },
			}}
		>
			<MainMenu>
				<MainMenu.DefaultItems.SaveAsImage />
				<MainMenu.DefaultItems.ClearCanvas />
				<MainMenu.DefaultItems.Help />
				<MainMenu.Separator />
				<MainMenu.DefaultItems.ChangeCanvasBackground />
			</MainMenu>
		</Excalidraw>
	);
}
