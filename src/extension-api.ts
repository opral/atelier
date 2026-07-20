import type { ComponentType } from "react";
import type { Lix } from "@lix-js/sdk";

/** Metadata for an already-loaded host extension entry. */
export type ExtensionManifest = {
	readonly apiVersion: 1;
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly fileExtensions?: readonly string[];
	readonly multiInstance?: boolean;
	/**
	 * Panel sides this view may occupy. Defaults to the side panels; central
	 * placement is reserved for document editors unless declared here.
	 */
	readonly placement?: readonly ("left" | "right" | "central")[];
	/**
	 * Excludes the view from the add-view menus. Hidden views stay mountable
	 * programmatically — right for views opened only through navigation or
	 * configuration (a folder view, a pinned home).
	 */
	readonly hidden?: boolean;
};

/** Stable ids for replacing Atelier's bundled extension views. */
export const ATELIER_BUILTIN_EXTENSION_IDS = {
	files: "atelier_files",
	markdown: "atelier_file",
	csv: "atelier_csv",
	image: "atelier_image",
	html: "atelier_html",
	pdf: "atelier_pdf",
	text: "atelier_text",
	excalidraw: "atelier_excalidraw",
} as const;

export type AtelierBuiltinExtensionId =
	(typeof ATELIER_BUILTIN_EXTENSION_IDS)[keyof typeof ATELIER_BUILTIN_EXTENSION_IDS];

export type AtelierExtensionState = {
	readonly atelier?: { readonly label?: string };
	readonly [key: string]: unknown;
};

export type AtelierDocumentOrigin = "existing" | "new";

export type AtelierDocumentOpenOptions = {
	readonly state?: AtelierExtensionState;
	readonly focus?: boolean;
	readonly documentOrigin?: AtelierDocumentOrigin;
	/**
	 * Appends a new central tab instead of navigating the active tab in place.
	 * Only meaningful when the host enabled `centralPanel.tabs`.
	 */
	readonly newTab?: boolean;
};

export type AtelierViewOpenOptions = {
	readonly state?: AtelierExtensionState;
	/**
	 * Stable identity for this view instance. An open view with the same key is
	 * activated (and its state updated) instead of opening a duplicate.
	 */
	readonly instanceKey?: string;
	/** Appends a new central tab instead of navigating the active tab in place. */
	readonly newTab?: boolean;
	readonly focus?: boolean;
	/** Target panel. Defaults to "central". */
	readonly panel?: "left" | "right" | "central";
};

export type AtelierViewsApi = {
	/** Opens (or activates) a registered extension view. */
	open(extensionId: string, options?: AtelierViewOpenOptions): Promise<void>;
};

export type AtelierDocumentsApi = {
	/** Opens a document by workspace path. */
	open(path: string, options?: AtelierDocumentOpenOptions): Promise<void>;
	/** Requests Atelier's contextual new-document UI. */
	startNew(): Promise<void>;
	/** Closes the active document. */
	closeActive(): Promise<void>;
	/** Closes every view showing the document at the workspace path. */
	close(path: string): Promise<void>;
	/** Closes every document in the central panel. */
	closeAll(): Promise<void>;
};

/** Product-domain events emitted for hosts that own analytics or auditing. */
export type AtelierEvent =
	| {
			type: "document_open_attempted";
			filePath: string;
			documentOrigin: AtelierDocumentOrigin;
			viewKind: string;
			supported: boolean;
	  }
	| {
			type: "document_viewed";
			filePath: string;
			documentOrigin: AtelierDocumentOrigin;
			viewKind: string;
	  }
	| {
			type: "document_closed";
			filePath: string;
			nextFilePath: string | null;
	  }
	| {
			type: "document_modified";
			filePath: string;
			modifiedBy: "user" | "agent";
	  }
	| {
			type: "extension_opened";
			extensionId: string;
			panel: "left" | "right" | "central";
	  }
	| {
			/**
			 * The active central view changed (open, tab click, close, restore).
			 * Hosts that own routing map this to a URL.
			 */
			type: "central_view_activated";
			viewKind: string;
			instanceId: string;
			/** Set when the active view is a document editor. */
			filePath: string | null;
			state?: AtelierExtensionState;
	  }
	| {
			type: "diff_opened";
			reviewId: string;
			filePath: string;
	  }
	| {
			type: "diff_resolved";
			reviewId: string;
			filePath: string;
			outcome: "accepted" | "rejected" | "abandoned";
	  };

export type AtelierExtensionRuntime = {
	readonly lix: Lix;
	/** Whether the host has opened this workspace without mutation access. */
	readonly readOnly: boolean;
	readonly events: {
		readonly emit: (event: AtelierEvent) => void;
	};
	readonly documents: AtelierDocumentsApi & {
		readonly activeFileId: string | null;
		readonly activeFilePath: string | null;
	};
	readonly views: AtelierViewsApi;
	readonly branches: {
		readonly activeId: string;
	};
};

export type AtelierExtensionView = {
	readonly instanceId: string;
	readonly state: AtelierExtensionState;
	readonly panel: "left" | "right" | "central";
	readonly isActive: boolean;
	readonly isFocused: boolean;
	readonly registerNewFileDraftHandler: (handler: () => void) => () => void;
};

export type AtelierMountedExtension = {
	update?: (args: {
		atelier: AtelierExtensionRuntime;
		view: AtelierExtensionView;
	}) => void;
	dispose?: () => void;
};

export type ExtensionRuntimeEntry = {
	readonly icon: ComponentType<{ className?: string }>;
	readonly mount: (args: {
		atelier: AtelierExtensionRuntime;
		view: AtelierExtensionView;
		element: HTMLElement;
		signal: AbortSignal;
	}) => void | AtelierMountedExtension;
};

export type AtelierExtensionRegistration = {
	readonly manifest: ExtensionManifest;
	readonly entry: ExtensionRuntimeEntry;
};
