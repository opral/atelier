import type { ComponentType } from "react";
import type {
	ExternalWriteReview,
	ResolveExternalWriteReviewArgs,
} from "./external-write-review";
import type {
	AtelierExtensionRuntime,
	AtelierExtensionState,
} from "../extension-api";

/**
 * Union of registry keys for views available in the layout.
 *
 * @example
 * const activeView: ExtensionKind = "atelier_files";
 */
export type ExtensionKind = string;

/**
 * Persisted view state. Only include values that should survive reloads.
 *
 * @example
 * const state: ExtensionState = { fileId: "file-123", filePath: "/docs/guide.md" };
 */
export type ExtensionState = AtelierExtensionState;

/**
 * Per-panel instance payload used to track which views are open.
 *
 * @example
 * const instance: ExtensionInstance = { instance: "files-1", kind: "atelier_files" };
 */
export interface ExtensionInstance {
	readonly instance: string;
	readonly kind: ExtensionKind;
	readonly isPending?: boolean;
	/**
	 * Persisted view state (serializable).
	 */
	readonly state?: ExtensionState;
}

/**
 * Shape of the static metadata that powers the view switcher UI.
 *
 * @example
 * const filesView: ExtensionDefinition = EXTENSION_DEFINITIONS[0];
 */
export interface ExtensionDefinition {
	readonly kind: ExtensionKind;
	readonly label: string;
	readonly description: string;
	readonly icon: ComponentType<{ className?: string }>;
	/**
	 * Lowercase file extensions this extension can render when a file is opened.
	 *
	 * @example
	 * fileExtensions: ["md", "markdown"]
	 */
	readonly fileExtensions?: readonly string[];
	/** Allow more than one view of this extension in the same panel. */
	readonly multiInstance?: boolean;
	readonly mount: (args: {
		atelier: ExtensionRuntime;
		view: ExtensionView;
		element: HTMLElement;
		signal: AbortSignal;
	}) => void | MountedExtension;
}

export interface MountedExtension {
	update?: (args: { atelier: ExtensionRuntime; view: ExtensionView }) => void;
	dispose?: () => void;
}

export type ExtensionRuntime = AtelierExtensionRuntime & {
	readonly reviews: {
		readonly resolvedReviewIds: readonly string[];
		readonly resolve: (args: ResolveExternalWriteReviewArgs) => Promise<void>;
		readonly accept: (args: {
			readonly fileId: string;
			readonly reviewId: string;
			readonly review?: ExternalWriteReview;
		}) => Promise<void>;
		readonly reject: (args: {
			readonly fileId: string;
			readonly reviewId: string;
			readonly review?: ExternalWriteReview;
		}) => Promise<void>;
		readonly register: (review: ExternalWriteReview) => () => void;
	};
};

export interface ExtensionView {
	readonly instanceId: string;
	readonly state: ExtensionState;
	readonly panel: PanelSide;
	readonly isActive: boolean;
	readonly isFocused: boolean;
	readonly registerNewFileDraftHandler: (handler: () => void) => () => void;
}

export interface ExtensionHostContext {
	readonly atelier: ExtensionRuntime;
	readonly registerNewFileDraftHandler: (registration: {
		readonly panelSide: PanelSide;
		readonly viewInstance: string;
		readonly isActiveView: boolean;
		readonly handler: () => void;
	}) => () => void;
}

/**
 * Lightweight state container that represents one panel island.
 *
 * @example
 * const leftPanel: PanelState = { views: [], activeInstance: null };
 */
export interface PanelState {
	readonly views: ExtensionInstance[];
	readonly activeInstance: string | null;
}

/**
 * Declares the available sides that panels can mount on.
 *
 * @example
 * const side: PanelSide = "left";
 */
export type PanelSide = "left" | "right" | "central";
