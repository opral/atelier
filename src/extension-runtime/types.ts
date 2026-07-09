import type { LucideIcon } from "lucide-react";
import type { Lix } from "@lix-js/sdk";
import type { CheckpointDiff, ShowCheckpointDiffArgs } from "./checkpoint-diff";
import type { ExternalWriteReview } from "./external-write-review";

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
export type ExtensionState = {
	/**
	 * Atelier-managed metadata (reserved namespace).
	 */
	readonly atelier?: {
		readonly label?: string;
	};
	readonly [key: string]: unknown;
};

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
	readonly icon: LucideIcon;
	/**
	 * Lowercase file extensions this extension can render when a file is opened.
	 *
	 * @example
	 * fileExtensions: ["md", "markdown"]
	 */
	readonly fileExtensions?: readonly string[];
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

export interface ExtensionRuntime {
	readonly lix: Lix;
	readonly files: {
		readonly open: (args: {
			readonly fileId: string;
			readonly filePath: string;
			readonly state?: ExtensionState;
			readonly focus?: boolean;
			readonly pending?: boolean;
		}) => void | Promise<void>;
		readonly close: (fileId: string) => void;
		readonly active: {
			readonly id: string;
			readonly path: string | null;
		} | null;
	};
	readonly revisions: {
		readonly current: CheckpointDiff | null;
		readonly show: (
			args: ShowCheckpointDiffArgs,
		) => Promise<CheckpointDiff | null>;
		readonly clear: () => void;
	};
	readonly reviews: {
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
}

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
