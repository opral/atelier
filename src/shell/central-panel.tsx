import { useCallback } from "react";
import { LixProvider } from "@/lib/lix-react";
import type {
	PanelState,
	PanelSide,
	WidgetContext,
	WidgetDefinition,
} from "../widget-runtime/types";
import { PanelV2 } from "./panel-v2";
import { LandingScreen } from "./landing-screen";

type CentralPanelProps = {
	readonly panel: PanelState;
	readonly onSelectWidget: (key: string) => void;
	readonly onRemoveWidget: (key: string) => void;
	readonly viewContext: WidgetContext;
	readonly onCreateNewFile?: () => void | Promise<void>;
	readonly isFocused: boolean;
	readonly onFocusPanel: (side: PanelSide) => void;
	readonly onFinalizePendingView?: (key: string) => void;
};

/**
 * Central panel - the main content area between left and right panels.
 *
 * @example
 * <CentralPanel
 *   panel={centralPanel}
 *   onSelectWidget={handleSelect}
 *   onRemoveWidget={handleRemove}
 *   onCreateNewFile={() => console.log("create")}
 * />
 */
export function CentralPanel({
	panel,
	onSelectWidget,
	onRemoveWidget,
	viewContext,
	isFocused,
	onFocusPanel,
	onFinalizePendingView,
	onCreateNewFile,
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

	const emptyState = (
		<LixProvider lix={viewContext.lix}>
			<EmptyStateContent
				viewContext={viewContext}
				onCreateNewFile={onCreateNewFile}
				isFocused={isFocused}
			/>
		</LixProvider>
	);

	const labelResolver = useCallback(
		(view: WidgetDefinition, entry: (typeof panel.views)[number]) =>
			(entry.state?.flashtype?.label as string | undefined) ?? view.label,
		[],
	);

	return (
		<PanelV2
			side="central"
			panel={panel}
			isFocused={isFocused}
			onFocusPanel={onFocusPanel}
			onSelectWidget={onSelectWidget}
			onRemoveWidget={onRemoveWidget}
			viewContext={viewContext}
			tabLabel={labelResolver}
			onActiveViewInteraction={finalizePendingIfNeeded}
			emptyStatePlaceholder={emptyState}
			dropId="central-panel"
		/>
	);
}

/**
 * Empty central panel content that renders the landing screen.
 */
function EmptyStateContent({
	viewContext,
	onCreateNewFile,
	isFocused,
}: {
	viewContext: WidgetContext;
	onCreateNewFile?: () => void | Promise<void>;
	isFocused: boolean;
}) {
	return (
		<LandingScreen
			context={viewContext}
			onCreateNewFile={onCreateNewFile}
			isPanelFocused={isFocused}
		/>
	);
}
