import { useCallback, type ReactNode } from "react";
import { FilePlus, Plus } from "lucide-react";
import type {
	PanelState,
	PanelSide,
	ExtensionHostContext,
	ExtensionDefinition,
} from "../extension-runtime/types";
import { PanelV2 } from "./panel-v2";

type CentralPanelProps = {
	readonly panel: PanelState;
	readonly onSelectView: (key: string) => void;
	readonly onRemoveView: (key: string) => void;
	readonly viewContext: ExtensionHostContext;
	readonly onCreateNewFile?: () => void | Promise<void>;
	readonly isFocused: boolean;
	readonly onFocusPanel: (side: PanelSide) => void;
	readonly onFinalizePendingView?: (key: string) => void;
	readonly emptyState?: ReactNode;
	/** Renders the central tab strip (browser-style tabs mode). */
	readonly showTabBar?: boolean;
	/** Host-rendered strip replacing the built-in tab row. */
	readonly customTabStrip?: ReactNode;
};

/**
 * Central panel - the main content area between left and right panels.
 *
 * @example
 * <CentralPanel
 *   panel={centralPanel}
 *   onSelectView={handleSelect}
 *   onRemoveView={handleRemove}
 *   onCreateNewFile={() => console.log("create")}
 * />
 */
export function CentralPanel({
	panel,
	onSelectView,
	onRemoveView,
	viewContext,
	isFocused,
	onFocusPanel,
	onFinalizePendingView,
	onCreateNewFile,
	emptyState: emptyStateOverride,
	showTabBar = false,
	customTabStrip,
}: CentralPanelProps) {
	const finalizePendingIfNeeded = useCallback(
		(key: string) => {
			if (!onFinalizePendingView) return;
			const entry = panel.views.find((view) => view.instance === key);
			if (entry?.isPending) {
				onFinalizePendingView(key);
			}
		},
		[onFinalizePendingView, panel.views],
	);

	const emptyState =
		emptyStateOverride === undefined ? (
			<EmptyStateContent onCreateNewFile={onCreateNewFile} />
		) : (
			emptyStateOverride
		);

	const labelResolver = useCallback(
		(view: ExtensionDefinition, entry: (typeof panel.views)[number]) =>
			(entry.state?.atelier?.label as string | undefined) ?? view.label,
		[],
	);

	return (
		<PanelV2
			side="central"
			panel={panel}
			isFocused={isFocused}
			onFocusPanel={onFocusPanel}
			onSelectView={onSelectView}
			onRemoveView={onRemoveView}
			viewContext={viewContext}
			tabLabel={labelResolver}
			onActiveViewInteraction={finalizePendingIfNeeded}
			emptyStatePlaceholder={emptyState}
			dropId="central-panel"
			showTabBar={showTabBar}
			customTabStrip={customTabStrip}
			tabBarExtraContent={
				showTabBar && onCreateNewFile ? (
					<NewTabButton onCreateNewFile={onCreateNewFile} />
				) : undefined
			}
		/>
	);
}

/** The tab-strip "+" — opens a fresh document in its own tab. */
function NewTabButton({
	onCreateNewFile,
}: {
	onCreateNewFile: () => void | Promise<void>;
}) {
	return (
		<button
			type="button"
			title="New tab"
			aria-label="New tab"
			data-attr="central-new-tab"
			onClick={() => void onCreateNewFile()}
			className="flex size-6 flex-none items-center justify-center rounded-md text-[var(--color-icon-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-icon-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring-focus-visible)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg-panel)]"
		>
			<Plus aria-hidden="true" className="size-3.25" strokeWidth={2} />
		</button>
	);
}

/**
 * Empty editor island in an open workspace: start a document, or hand off to
 * the agent island.
 */
function EmptyStateContent({
	onCreateNewFile,
}: {
	onCreateNewFile?: () => void | Promise<void>;
}) {
	return (
		<div
			className="flex h-full flex-col items-center justify-center p-10 text-center"
			data-testid="central-panel-empty-state"
		>
			<FilePlus
				className="size-8 text-[var(--color-icon-tertiary)]"
				strokeWidth={1.5}
			/>
			<h1 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-[var(--color-text-primary)]">
				Start writing
			</h1>
			<p className="mt-1.5 max-w-90 text-sm leading-relaxed text-[var(--color-text-secondary)] text-pretty">
				Open a file from the left, or create a new document — saved as plain
				markdown in this folder.
			</p>
			{onCreateNewFile ? (
				<button
					type="button"
					onClick={() => void onCreateNewFile()}
					data-attr="central-empty-new-document"
					className="mt-6 flex items-center gap-2 rounded-[10px] bg-[var(--color-bg-action-primary)] px-6 py-2.75 text-sm font-bold text-[var(--color-text-on-action-primary)] shadow-[0_6px_18px_rgba(154,52,18,0.24),inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-[var(--color-bg-action-primary-hover)]"
				>
					New document
					<span className="text-[11.5px] font-semibold opacity-75">⌘.</span>
				</button>
			) : null}
		</div>
	);
}
