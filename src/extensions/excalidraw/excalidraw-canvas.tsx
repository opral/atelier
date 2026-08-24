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
			appState: scene.appState as ExcalidrawInitialDataState["appState"],
			files: scene.files as unknown as BinaryFiles,
			scrollToContent: true,
		};
		// The initial document is captured once on mount; later updates flow
		// through updateScene below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleChange = useCallback(
		(
			elements: readonly OrderedExcalidrawElement[],
			appState: AppState,
			files: BinaryFiles,
		) => {
			capture({ elements, appState, files });
		},
		[capture],
	);

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
