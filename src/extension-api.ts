import type { ComponentType, ReactNode } from "react";
import type { CommitSpan, Lix } from "@lix-js/sdk";

export type AtelierArea = "left" | "main" | "right";

/**
 * What a file is to a person, as the Library groups it: the view that opens
 * the file says so in its manifest. A file no view claims is "other".
 */
export type AtelierLibraryKind = "pages" | "tables" | "drawings" | "media";

/** Metadata for an already-loaded host extension entry. */
export type ExtensionManifest = {
	readonly apiVersion: 1;
	readonly id: string;
	readonly name: string;
	readonly description?: string;
	readonly fileExtensions?: readonly string[];
	/** The Library kind of the files this view opens (a file handler only). */
	readonly kind?: AtelierLibraryKind;
	readonly multiInstance?: boolean;
	/**
	 * Panel sides this view may occupy. Defaults to the side areas; main
	 * placement is reserved for document editors unless declared here.
	 */
	readonly placement?: readonly AtelierArea[];
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
	library: "atelier_library",
	history: "atelier_history",
	debug: "atelier_debug",
	markdown: "atelier_file",
	csv: "atelier_csv",
	image: "atelier_image",
	html: "atelier_html",
	pdf: "atelier_pdf",
	video: "atelier_video",
	text: "atelier_text",
	excalidraw: "atelier_excalidraw",
	sqlExplorer: "sql_explorer",
	conversation: "atelier_conversation",
} as const;

export type AtelierBuiltinExtensionId =
	(typeof ATELIER_BUILTIN_EXTENSION_IDS)[keyof typeof ATELIER_BUILTIN_EXTENSION_IDS];

export type AtelierExtensionState = {
	readonly atelier?: { readonly label?: string };
	readonly [key: string]: unknown;
};

export type AtelierJsonValue =
	| null
	| boolean
	| number
	| string
	| readonly AtelierJsonValue[]
	| { readonly [key: string]: AtelierJsonValue };

/** Extension-scoped preferences. Atelier namespaces keys by extension id. */
export type AtelierExtensionPreferences = {
	readonly get: (key: string) => AtelierJsonValue | undefined;
	readonly set: (key: string, value: AtelierJsonValue) => void;
	readonly delete: (key: string) => void;
};

type AtelierExtensionMenuItemBase = {
	/** Locally unique within this extension's menu. */
	readonly key: string;
	/** Optional shell-rendered leading icon. */
	readonly icon?: ComponentType<{
		className?: string;
		"aria-hidden"?: boolean;
	}>;
	readonly disabled?: boolean;
};

export type AtelierExtensionCheckboxMenuItem = AtelierExtensionMenuItemBase & {
	readonly kind: "checkbox";
	readonly label: string;
	readonly checked: boolean;
	readonly onSelect: () => void;
};

export type AtelierExtensionActionMenuItem = AtelierExtensionMenuItemBase & {
	readonly kind: "action";
	readonly label: string;
	readonly onSelect: () => void;
};

export type AtelierExtensionSeparatorMenuItem = Pick<
	AtelierExtensionMenuItemBase,
	"key"
> & {
	readonly kind: "separator";
};

export type AtelierExtensionMenuItem =
	| AtelierExtensionCheckboxMenuItem
	| AtelierExtensionActionMenuItem
	| AtelierExtensionSeparatorMenuItem;

export type AtelierExtensionMenuItems = (context: {
	readonly preferences: AtelierExtensionPreferences;
}) => readonly AtelierExtensionMenuItem[];

/** One host-contributed, not-yet-imported filesystem entry. */
export type AtelierWatchedEntry = {
	/** Workspace-absolute path, e.g. "/notes/todo.md" or "/notes/". */
	readonly path: string;
	readonly kind: "file" | "directory";
};

/**
 * Host data source for un-imported "watched" entries in the bundled Files
 * view. Watched entries render alongside lix entries (lix wins on path
 * collisions) and are imported lazily on first interaction.
 */
export type AtelierFilesViewOptions = {
	/**
	 * Contribute un-imported entries. Called with the currently expanded
	 * directories (the root "/" is always included) and resubscribed whenever
	 * the expanded set changes. Push the current entries through `onChange`;
	 * return an unsubscribe function.
	 */
	readonly watchEntries?: (args: {
		readonly expandedDirectories: readonly string[];
		readonly onChange: (entries: readonly AtelierWatchedEntry[]) => void;
	}) => () => void;
	/**
	 * Resolve (import) a watched path to a canonical lix file before an
	 * interaction such as open, rename, or delete. Returning `null` cancels
	 * the interaction.
	 */
	readonly resolveFileForInteraction?: (
		path: string,
	) => Promise<{ readonly fileId: string } | null>;
};

export type AtelierDocumentOrigin = "existing" | "new";
export type AtelierDocumentNavigationCause =
	| "foreground"
	| "route"
	| "restoration";

export type AtelierDocumentOpenOptions = {
	/** Cancels navigation before it changes the workspace. */
	readonly signal?: AbortSignal;
	/** Stable identity already resolved with this path by the caller. */
	readonly fileId?: string;
	readonly state?: AtelierExtensionState;
	readonly focus?: boolean;
	readonly documentOrigin?: AtelierDocumentOrigin;
	/** Why the document entered the workspace, independent of its content origin. */
	readonly navigationCause?: AtelierDocumentNavigationCause;
	/**
	 * Appends a new main tab instead of navigating the active tab in place.
	 */
	readonly newTab?: boolean;
	/**
	 * Opens in the preview tab, as IDEs do for a file picked from a list: the
	 * next preview replaces it instead of adding a tab. The tab is kept once
	 * the person works in the document (a click, a key) or double-clicks its
	 * tab. A document already open is brought to the front as it is.
	 * `newTab` wins over it.
	 */
	readonly preview?: boolean;
};

export type AtelierViewOpenOptions = {
	/** Cancels navigation before it changes the workspace. */
	readonly signal?: AbortSignal;
	readonly state?: AtelierExtensionState;
	/**
	 * Stable identity for this view instance — the same value is reported back
	 * as `instanceId` on views and events. An open view with the same id is
	 * activated (and its state updated) instead of opening a duplicate.
	 */
	readonly instanceId?: string;
	/** Appends a new main tab instead of navigating the active tab in place. */
	readonly newTab?: boolean;
	readonly focus?: boolean;
	/**
	 * `false` only updates the state of the open instance named by
	 * `instanceId` (a view renaming its own tab while in the background),
	 * without activating it; nothing opens when there is no such instance.
	 */
	readonly activate?: boolean;
	/**
	 * Target panel. Defaults to "main". Side areas follow the add-view
	 * rules instead of the tab rules: `instanceId` and `newTab` are ignored.
	 */
	readonly area?: AtelierArea;
};

export type AtelierViewsApi = {
	/** Resolves when the registered extension view is active. */
	open(extensionId: string, options?: AtelierViewOpenOptions): Promise<void>;
};

export type AtelierDocumentsApi = {
	/** Resolves when the document is active; rejects if its activation is displaced. */
	open(path: string, options?: AtelierDocumentOpenOptions): Promise<void>;
	/** Requests Atelier's contextual new-document UI. */
	startNew(): Promise<void>;
	/** Closes the active document. */
	closeActive(): Promise<void>;
	/** Closes every view showing the document at the workspace path. */
	close(path: string): Promise<void>;
	/** Closes every document in the main panel. */
	closeAll(): Promise<void>;
};

/** Product-domain events emitted for hosts that own analytics or auditing. */
export type AtelierEvent =
	| {
			type: "document_open_attempted";
			fileId: string;
			filePath: string;
			navigationCause: AtelierDocumentNavigationCause;
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
			/** The first document data has rendered; excludes subsequent refreshes. */
			type: "document_loaded";
			fileId: string | undefined;
			filePath: string;
			viewKind: string;
			durationMs: number;
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
			/**
			 * The durable transition this write produced, when the surface that
			 * wrote was told one. It is what lets a review that is open over
			 * this file tell the reviewer's own write apart from anybody
			 * else's, without asking the workspace a question whose answer has
			 * already moved on.
			 */
			commit?: CommitSpan | null;
	  }
	| {
			type: "extension_opened";
			extensionId: string;
			area: AtelierArea;
	  }
	| {
			/** Explicit user tab selection, emitted before activation, including
			 * selecting an already active tab. Hosts cancel pending route work here.
			 * Restoring state and programmatic opens do not emit this event.
			 */
			type: "main_view_navigation_requested";
			viewKind: string;
			instanceId: string;
			filePath: string | null;
			state?: AtelierExtensionState;
	  }
	| {
			/**
			 * The active main view changed (open, tab click, close, restore),
			 * or the active non-document view renamed its tab
			 * (`state.atelier.label`; a conversation titles its tab once read).
			 * Hosts that own routing map this to a URL; a repeat for the same
			 * `instanceId` is a rename, so replace the entry rather than push.
			 */
			type: "main_view_activated";
			viewKind: string;
			instanceId: string;
			/** Set when the active view is a document editor. */
			filePath: string | null;
			state?: AtelierExtensionState;
	  }
	| {
			/**
			 * The last main view closed: nothing is in front. Hosts that map
			 * the active view to a URL move it off the view that closed.
			 */
			type: "main_area_emptied";
	  }
	| {
			/**
			 * A diff session opened, changed shape, or exited. Hosts use this
			 * to enter and leave review presentation (e.g. dimming chrome
			 * outside the changes) without reaching into shell state.
			 */
			type: "diff_session_changed";
			active: boolean;
			changedFileCount: number;
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

/** A diffable state: a specific commit, or the mutable working state. */
export type AtelierDiffRef =
	| { readonly commitId: string }
	| { readonly working: true };

export type AtelierDiffFile = {
	readonly id: string;
	readonly path: string;
	readonly changeKind: "added" | "modified" | "removed";
	/** Set when a modified file's side paths differ: a move/rename. */
	readonly movedFromPath?: string;
	/** Certified HOT epoch for a mutable working diff. */
	readonly workingEpoch?: {
		readonly beforeCommitId: string;
		readonly afterCommitId: string;
	};
	/** Present when the session reviews external writes (mutable target). */
	readonly review?: {
		readonly id: string;
		readonly status: "pending" | "resolved";
	};
};

export type AtelierDiffSession = {
	readonly intent?: "review-applied";
	/** The older side; null means the repository's beginning. */
	readonly base: AtelierDiffRef | null;
	readonly target: AtelierDiffRef;
	readonly files: readonly AtelierDiffFile[];
	readonly activePath: string | null;
	/** When the target commit was created; drives the "Viewing checkpoint" title. */
	readonly createdAt?: string;
	/** Derived from the refs — the effective latest checkpoint can be undone; older checkpoints restore. */
	readonly capabilities: {
		readonly checkpoint: boolean;
		readonly undo: boolean;
		readonly restore: boolean;
	};
};

/**
 * The one diff surface: every review is a session between two refs.
 * Working changes review = open({ target: { working: true } });
 * checkpoint view = open({ base: previous, target: commit }).
 */
export type AtelierDiffApi = {
	readonly session: AtelierDiffSession | null;
	readonly open: (options: {
		/** Defaults to the latest checkpoint for a working target. */
		/** Review an already-applied commit span with Keep / Undo. Requires two commit refs. */
		readonly intent?: "review-applied";
		readonly base?: AtelierDiffRef | null;
		readonly target: AtelierDiffRef;
		/**
		 * Also open the first changed file. By default opening a review is not
		 * a navigation: whatever is on screen stays, and the user steps through
		 * the changed files from the review float.
		 */
		readonly reveal?: boolean;
	}) => Promise<void>;
	readonly openFile: (path: string) => void;
	readonly exit: () => void;
	readonly accept: (path: string) => Promise<void>;
	readonly reject: (path: string) => Promise<void>;
	/** Accept with authored content: writes the bytes, then resolves. */
	readonly resolve: (path: string, data: Uint8Array) => Promise<void>;
	/**
	 * Seal every working change into a checkpoint without opening a session.
	 * An open working-changes session concludes with it. Rejects when the host
	 * is read-only.
	 */
	readonly checkpointAll: () => Promise<void>;
	readonly autoAccept: boolean;
};

/**
 * How the host names files in URLs. Atelier links documents to each other
 * by relative path, but a document can also carry the host's own permanent
 * URL for a file (pasted from the browser, written by an agent). The host
 * says which URLs are its files here, and how to write one.
 */
export type AtelierDocumentLinks = {
	/** The file a host URL points at in this workspace; null for any other URL. */
	readonly resolve: (
		href: string,
	) => { readonly id: string } | { readonly path: string } | null;
	/** The host's permanent URL for a file. Mentions insert it when present. */
	readonly href?: (file: {
		readonly id: string;
		readonly path: string;
	}) => string;
};

export type AtelierExtensionRuntime = {
	readonly lix: Lix;
	readonly scopeDocumentLix?: (
		path: string,
		fileId: string | undefined,
		lix: Lix,
	) => Lix;
	/** The host's file URLs, when it has any; see `AtelierDocumentLinks`. */
	readonly documentLinks?: AtelierDocumentLinks;
	/**
	 * Optional host bridge for comparing the workspace replica with its remote.
	 * The host owns the returned handle and its lifecycle. Keeping this lazy
	 * avoids opening a remote connection for workspaces that never use Debug.
	 */
	readonly debug?: {
		readonly remoteLix?: () => Promise<Lix>;
		/** Base name used for manual local snapshot downloads. */
		readonly snapshotName?: string;
		/** Downloads the canonical server-side snapshot when a server is present. */
		readonly remoteSnapshot?: () => Promise<Blob>;
		/** Builds a portable archive for a completed local/remote comparison. */
		readonly createReproduction?: (input: {
			readonly query: string;
			readonly diffCsv: string;
		}) => Promise<Blob>;
	};
	/**
	 * Whether this extension view must render without mutation affordances.
	 * True for a host-level read-only workspace and for historical revisions.
	 */
	readonly readOnly: boolean;
	readonly events: {
		readonly emit: (event: AtelierEvent) => void;
	};
	readonly documents: AtelierDocumentsApi & {
		readonly activeFileId: string | null;
		readonly activeFilePath: string | null;
		/** Files open in the main area, in tab order. */
		readonly openFileIds?: readonly string[];
	};
	readonly views: AtelierViewsApi & {
		/** The main view in front: what a navigation surface marks as current. */
		readonly activeMain?: {
			readonly extensionId: string;
			readonly instanceId: string;
			readonly state: AtelierExtensionState;
		} | null;
		/**
		 * The views a person can open in the main area — what an add-view menu
		 * lists — so a navigation surface can offer them itself.
		 */
		readonly mainViews?: readonly {
			readonly extensionId: string;
			readonly name: string;
			readonly icon?: ComponentType<{ className?: string }>;
		}[];
	};
	/** Host contributions to the bundled Library view. */
	readonly library?: AtelierLibraryOptions;
	/**
	 * Read and write another extension's preference without taking ownership
	 * of its defaults. A host surface that mirrors a bundled extension reads
	 * through this; one that offers the same control the extension offers —
	 * its own New menu, say — writes through it too, because a second copy of
	 * the same setting is two answers to one question.
	 */
	readonly preferences: {
		readonly get: (
			extensionId: string,
			key: string,
		) => AtelierJsonValue | undefined;
		readonly set: (
			extensionId: string,
			key: string,
			value: AtelierJsonValue | undefined,
		) => void;
	};
	/** Canonical Atelier iconography, shared by views, floats, and lists. */
	readonly icons: {
		/** Icon URL for a workspace file path (resolved by extension). */
		readonly fileUrl: (path: string) => string;
	};
	readonly branches: {
		readonly activeId: string;
	};
	/** The unified diff surface. */
	readonly diff?: AtelierDiffApi;
};

/**
 * What a host adds to the bundled Library. The Library is complete without
 * it; a host fills the moments that are about the product, not the files.
 */
export type AtelierLibraryOptions = {
	/**
	 * The host's Home: a first section that sums up the workspace — its
	 * README, activity, who and what is connected. With one, Home takes the
	 * place of All at the top of the Library and is where a tab opens.
	 */
	readonly Home?: ComponentType<{
		readonly atelier: AtelierExtensionRuntime;
		/**
		 * The Library's Recent row (a heading and a row of cards), for the host
		 * to place in its page; null when nothing has been opened or changed.
		 */
		readonly recent: ReactNode;
	}>;
	/**
	 * Shown in All when the workspace has no files yet: the host's own
	 * onboarding (connect an agent, start writing). Without it the Library
	 * shows its plain empty state.
	 */
	readonly EmptyWorkspace?: ComponentType<{
		readonly atelier: AtelierExtensionRuntime;
	}>;
};

export type AtelierExtensionView = {
	readonly instanceId: string;
	readonly state: AtelierExtensionState;
	readonly area: AtelierArea;
	readonly isActive: boolean;
	readonly isFocused: boolean;
	/** Preferences shared by every instance of this extension. */
	readonly preferences: AtelierExtensionPreferences;
	readonly registerNewFileDraftHandler: (
		handler: () => Promise<void> | void,
	) => () => void;
};

/** A view whose initial render works on the server and in the browser. */
export type AtelierExtensionRegistration = {
	readonly id: string;
	readonly name?: string;
	readonly description?: string;
	readonly icon?: ComponentType<{ className?: string }>;
	readonly fileExtensions?: readonly string[];
	/** The Library kind of the files this view opens; see `AtelierLibraryKind`. */
	readonly kind?: AtelierLibraryKind;
	readonly multiInstance?: boolean;
	readonly placement?: readonly AtelierArea[];
	readonly hidden?: boolean;
	readonly menuItems?: AtelierExtensionMenuItems;
	readonly load?: AtelierExtensionLoader;
	/** Control shown at the trailing end of this view's side-panel header. */
	readonly HeaderAccessory?: ComponentType<{
		readonly atelier: AtelierExtensionRuntime;
		readonly view: AtelierExtensionView;
	}>;
	readonly Component: ComponentType<{
		readonly data: AtelierJsonValue;
		readonly atelier: AtelierExtensionRuntime;
		readonly view: AtelierExtensionView;
	}>;
};

export type AtelierExtensionLoader = (args: {
	readonly lix: Lix;
	readonly location: import("./atelier-state").AtelierLocation;
	readonly signal: AbortSignal;
}) => Promise<AtelierJsonValue>;
