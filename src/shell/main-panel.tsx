import { useCallback, type ReactNode } from "react";
import { FilePlus } from "lucide-react";
import type {
	AreaState,
	Area,
	ExtensionHostContext,
	ExtensionDefinition,
	ExtensionKind,
	ExtensionState,
	ExtensionInstance,
} from "../extension-runtime/types";
import { PanelV2 } from "./panel-v2";
import { shortcutHint } from "@/lib/platform";

type MainAreaProps = {
	/** Hover text for a document tab: the file's full path. */
	readonly tabTooltip?: (
		view: ExtensionDefinition,
		instance: ExtensionInstance,
	) => string | undefined;
	readonly area: AreaState;
	readonly onSelectView: (key: string) => void;
	readonly onRemoveView: (key: string) => void;
	readonly viewContext: ExtensionHostContext;
	readonly onCreateNewFile?: () => void | Promise<void>;
	readonly onAddView?: (kind: ExtensionKind, state?: ExtensionState) => void;
	readonly isFocused: boolean;
	readonly onFocusArea: (side: Area) => void;
	readonly onFinalizePendingView?: (key: string) => void;
	readonly emptyState?: ReactNode;
	/** Renders the main tab strip (browser-style tabs mode). */
	readonly showTabBar?: boolean;
	/** Host-rendered strip replacing the built-in tab row. */
	readonly customTabStrip?: ReactNode;
};

/**
 * Main panel - the main content area between left and right areas.
 *
 * @example
 * <MainArea
 *   panel={mainArea}
 *   onSelectView={handleSelect}
 *   onRemoveView={handleRemove}
 *   onCreateNewFile={() => console.log("create")}
 * />
 */
export function MainArea({
	area,
	onSelectView,
	onRemoveView,
	viewContext,
	isFocused,
	onFocusArea,
	onFinalizePendingView,
	onCreateNewFile,
	onAddView,
	emptyState: emptyStateOverride,
	showTabBar = false,
	customTabStrip,
	tabTooltip,
}: MainAreaProps) {
	const finalizePendingIfNeeded = useCallback(
		(key: string) => {
			if (!onFinalizePendingView) return;
			const entry = area.views.find((view) => view.instance === key);
			if (entry?.isPending) {
				onFinalizePendingView(key);
			}
		},
		[onFinalizePendingView, area.views],
	);

	const emptyState =
		emptyStateOverride === undefined ? (
			<EmptyStateContent onCreateNewFile={onCreateNewFile} />
		) : (
			emptyStateOverride
		);

	const labelResolver = useCallback(
		(view: ExtensionDefinition, entry: (typeof area.views)[number]) =>
			(entry.state?.atelier?.label as string | undefined) ?? view.label,
		[],
	);

	return (
		<PanelV2
			side="main"
			area={area}
			isFocused={isFocused}
			onFocusArea={onFocusArea}
			onSelectView={onSelectView}
			onRemoveView={onRemoveView}
			viewContext={viewContext}
			tabLabel={labelResolver}
			tabTooltip={tabTooltip}
			onActiveViewInteraction={finalizePendingIfNeeded}
			onAddView={onAddView}
			emptyStatePlaceholder={emptyState}
			dropId="main-panel"
			showTabBar={showTabBar}
			customTabStrip={customTabStrip}
		/>
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
			data-testid="main-panel-empty-state"
		>
			<FilePlus className="size-8 text-fg-subtle" strokeWidth={1.5} />
			<h1 className="mt-4 text-2xl font-bold tracking-[-0.02em] text-fg">
				Start writing
			</h1>
			<p className="mt-1.5 max-w-90 text-sm leading-relaxed text-fg-muted text-pretty">
				Open a file from the left, or create a new document — saved as plain
				markdown in this folder.
			</p>
			{onCreateNewFile ? (
				<button
					type="button"
					onClick={() => void onCreateNewFile()}
					data-attr="main-empty-new-document"
					className="mt-6 flex items-center gap-2 rounded-[10px] bg-bg-hover px-6 py-2.75 text-sm font-bold text-accent-on shadow-[0_6px_18px_rgba(154,52,18,0.24),inset_0_1px_0_rgba(255,255,255,0.18)] hover:bg-accent-hover"
				>
					New document
					<span className="text-[11.5px] font-semibold opacity-75">
						{shortcutHint("⌘.")}
					</span>
				</button>
			) : null}
		</div>
	);
}
