import { useCallback, type ReactNode } from "react";
import { FilePlus, FileText } from "lucide-react";
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
 *
 * A host nobody can write to hands over no `onCreateNewFile`, and there the
 * copy says what is true instead of offering a new document and then
 * withholding the button — "Start writing" over a workspace that takes no
 * writing was the whole of the empty state a reader got.
 */
function EmptyStateContent({
	onCreateNewFile,
}: {
	onCreateNewFile?: () => void | Promise<void>;
}) {
	const canCreate = onCreateNewFile !== undefined;
	const Glyph = canCreate ? FilePlus : FileText;
	return (
		<div
			className="atw:flex atw:h-full atw:flex-col atw:items-center atw:justify-center atw:p-10 atw:text-center"
			data-testid="main-panel-empty-state"
			data-can-create={canCreate ? "true" : "false"}
		>
			<Glyph className="atw:size-8 atw:text-fg-subtle" strokeWidth={1.5} />
			<h1 className="atw:mt-4 atw:text-2xl atw:font-bold atw:tracking-[-0.02em] atw:text-fg">
				{canCreate ? "Start writing" : "Nothing open"}
			</h1>
			<p className="atw:mt-1.5 atw:max-w-90 atw:text-sm atw:leading-relaxed atw:text-fg-muted atw:text-pretty">
				{canCreate
					? "Open a file from the left, or create a new document."
					: "Open a file from the left to read it."}
			</p>
			{onCreateNewFile ? (
				<button
					type="button"
					onClick={() => void onCreateNewFile()}
					data-attr="main-empty-new-document"
					className="atw:mt-6 atw:flex atw:items-center atw:gap-2 atw:rounded-[10px] atw:bg-accent atw:px-6 atw:py-2.75 atw:text-sm atw:font-bold atw:text-accent-on atw:shadow-accent atw:hover:bg-accent-hover"
				>
					New document
					<span className="atw:text-[11.5px] atw:font-semibold atw:opacity-75">
						{shortcutHint("⌘.")}
					</span>
				</button>
			) : null}
		</div>
	);
}
