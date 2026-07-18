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
import "@excalidraw/excalidraw/index.css";
import { parseExcalidrawScene } from "./scene";

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
};

/**
 * The Excalidraw surface. This module is loaded lazily so the drawing
 * runtime stays out of the initial Atelier bundle.
 */
export default function ExcalidrawCanvas({
	sceneJson,
	readOnly,
	onSceneChange,
}: ExcalidrawCanvasProps) {
	const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
	// The serialized document that matches what the canvas currently shows.
	// Used to tell locally-echoed persistence updates apart from external
	// writes that must be applied onto the canvas.
	const canvasDocRef = useRef(sceneJson);
	// The first onChange fires while Excalidraw loads the initial scene. That
	// event captures the serialization baseline instead of scheduling a
	// persist, so mounting alone never rewrites the file — and a canvas that
	// never receives real edits (e.g. a StrictMode ghost) never writes at all.
	const baselineReadyRef = useRef(false);
	// Latest scene payload delivered by onChange. Flushes serialize from this
	// snapshot rather than querying the imperative API: during unmount the
	// API already reads back an empty, torn-down scene, and persisting that
	// would erase the stored document.
	const lastSceneRef = useRef<{
		readonly elements: readonly OrderedExcalidrawElement[];
		readonly appState: AppState;
		readonly files: BinaryFiles;
	} | null>(null);
	const flushTimerRef = useRef<number | null>(null);
	const onSceneChangeRef = useRef(onSceneChange);
	const readOnlyRef = useRef(readOnly);

	useEffect(() => {
		onSceneChangeRef.current = onSceneChange;
	}, [onSceneChange]);
	useEffect(() => {
		readOnlyRef.current = readOnly;
	}, [readOnly]);

	const initialData = useMemo<ExcalidrawInitialDataState>(() => {
		const parsed = parseExcalidrawScene(sceneJson);
		const scene = parsed.ok
			? parsed.scene
			: { elements: [], appState: {}, files: {} };
		return {
			elements: scene.elements as ExcalidrawInitialDataState["elements"],
			appState: scene.appState as ExcalidrawInitialDataState["appState"],
			files: scene.files as unknown as BinaryFiles,
			scrollToContent: true,
		};
		// The initial document is captured once on mount; later updates flow
		// through updateScene below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const serializeCurrentScene = useCallback((): string | null => {
		const scene = lastSceneRef.current;
		if (!scene) return null;
		return serializeAsJSON(
			scene.elements.filter((element) => !element.isDeleted),
			scene.appState,
			scene.files,
			"local",
		);
	}, []);

	const flushLocalEdits = useCallback(() => {
		if (flushTimerRef.current !== null) {
			window.clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		if (readOnlyRef.current) return;
		const serialized = serializeCurrentScene();
		if (serialized === null || serialized === canvasDocRef.current) return;
		canvasDocRef.current = serialized;
		onSceneChangeRef.current?.(serialized);
	}, [serializeCurrentScene]);

	const handleChange = useCallback(
		(
			elements: readonly OrderedExcalidrawElement[],
			appState: AppState,
			files: BinaryFiles,
		) => {
			if (readOnlyRef.current) return;
			lastSceneRef.current = { elements, appState, files };
			if (!baselineReadyRef.current) {
				baselineReadyRef.current = true;
				const baseline = serializeCurrentScene();
				if (baseline !== null) canvasDocRef.current = baseline;
				return;
			}
			if (flushTimerRef.current !== null) {
				window.clearTimeout(flushTimerRef.current);
			}
			flushTimerRef.current = window.setTimeout(
				flushLocalEdits,
				PERSIST_DEBOUNCE_MS,
			);
		},
		[flushLocalEdits, serializeCurrentScene],
	);

	// Persist pending edits when the view unmounts (tab switch, close). Only
	// an armed debounce timer means there are unpersisted local edits; without
	// this guard a cleanup pass on a canvas that never settled could
	// serialize a half-initialized scene over the stored document.
	useEffect(
		() => () => {
			if (!baselineReadyRef.current) return;
			if (flushTimerRef.current === null) return;
			flushLocalEdits();
		},
		[flushLocalEdits],
	);

	// Apply external document changes (agent writes, review swaps) onto the
	// live canvas without remounting so the viewport is preserved.
	useEffect(() => {
		if (sceneJson === canvasDocRef.current) return;
		const api = apiRef.current;
		if (!api) {
			canvasDocRef.current = sceneJson;
			return;
		}
		if (flushTimerRef.current !== null) {
			window.clearTimeout(flushTimerRef.current);
			flushTimerRef.current = null;
		}
		const parsed = parseExcalidrawScene(sceneJson);
		if (!parsed.ok) return;
		canvasDocRef.current = sceneJson;
		// updateScene fires onChange; re-baseline on that event instead of
		// treating the programmatic update as a local edit to persist.
		baselineReadyRef.current = false;
		api.updateScene({
			elements: parsed.scene
				.elements as unknown as readonly OrderedExcalidrawElement[],
			captureUpdate: CaptureUpdateAction.NEVER,
		});
		const files = Object.values(parsed.scene.files);
		if (files.length > 0) {
			api.addFiles(files as Parameters<typeof api.addFiles>[0]);
		}
	}, [sceneJson]);

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
