import type { ComponentType } from "react";
import type { Lix } from "@lix-js/sdk";

export type ExtensionManifest = {
	apiVersion: 1;
	id: string;
	name: string;
	description?: string;
	entry: string;
	fileExtensions?: string[];
	multiInstance?: boolean;
};

export type AtelierExtensionState = {
	readonly atelier?: { readonly label?: string };
	readonly [key: string]: unknown;
};

export type AtelierDocumentOrigin = "existing" | "new";

export type CheckpointDiffFileStatus =
	| "added"
	| "deleted"
	| "modified"
	| "recreated";

export type CheckpointDiffFile = {
	readonly fileId: string;
	readonly path: string;
	readonly beforePath: string | null;
	readonly afterPath: string | null;
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly reviewId: string;
	readonly status: CheckpointDiffFileStatus;
};

export type CheckpointDiffVisibleFile = {
	readonly fileId: string;
	readonly path: string;
};

export type CheckpointDiff = {
	readonly branchId: string;
	readonly branchName: string;
	readonly beforeBranchId: string;
	readonly beforeBranchName: string;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly afterIsActiveHead?: boolean;
	readonly visibleFiles?: readonly CheckpointDiffVisibleFile[];
	readonly files: readonly CheckpointDiffFile[];
};

export type CheckpointDiffBranchRow = {
	readonly id: string;
	readonly name: string;
	readonly commit_id: string | null;
};

export type ShowCheckpointDiffArgs = {
	readonly branchId: string;
	readonly branches: readonly CheckpointDiffBranchRow[];
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
	readonly events: {
		readonly emit: (event: AtelierEvent) => void;
	};
	readonly files: {
		readonly open: (args: {
			readonly fileId: string;
			readonly filePath: string;
			readonly state?: AtelierExtensionState;
			readonly focus?: boolean;
			readonly pending?: boolean;
			readonly documentOrigin?: AtelierDocumentOrigin;
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
	readonly runtime: ExtensionRuntimeEntry;
};
