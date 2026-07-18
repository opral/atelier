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
};

/** Stable ids for replacing Atelier's bundled extension views. */
export const ATELIER_BUILTIN_EXTENSION_IDS = {
	files: "atelier_files",
	history: "atelier_history",
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

export type AtelierRevisionSelection = {
	readonly branchId: string;
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
	readonly branches: {
		readonly activeId: string;
		readonly create: (name: string) => Promise<string>;
		readonly switch: (branchId: string) => Promise<void>;
	};
	readonly revisions: {
		readonly current: AtelierRevisionSelection | null;
		readonly show: (branchId: string) => Promise<void>;
		readonly clear: () => void;
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
