import {
	Suspense,
	type ComponentPropsWithRef,
	type ComponentType,
	type ReactNode,
} from "react";
import { LixProvider } from "@/lib/lix-react";
import { V2LayoutShell } from "@/shell/layout-shell";
import type { AtelierExtensionState } from "./extension-api";
import {
	getAtelierConfiguration,
	type AtelierInstance,
	type AtelierPanelSide,
} from "./atelier-instance";

export type { AtelierPanelSide } from "./atelier-instance";

export type AtelierTopBarProps = Omit<
	ComponentPropsWithRef<"header">,
	"children" | "dangerouslySetInnerHTML" | "role"
> & {
	readonly [attribute: `data-${string}`]: string | number | boolean | undefined;
};

export type AtelierEmptyPanelSlotContext = {
	/** The panel whose empty state is being rendered. */
	readonly side: AtelierPanelSide;
	/** Open a registered extension in this panel. */
	readonly openExtension: (
		extensionId: string,
		state?: AtelierExtensionState,
	) => void;
};

export type AtelierEmptyPanelSlot =
	| ReactNode
	| ((context: AtelierEmptyPanelSlotContext) => ReactNode);

/** One central tab, headless: Atelier owns the rules, the host the pixels. */
export type AtelierTabStripTab = {
	readonly instanceId: string;
	readonly kind: string;
	readonly label: string;
	readonly icon: ComponentType<{ className?: string }>;
	readonly isActive: boolean;
	readonly isPinned: boolean;
	readonly isPending: boolean;
	readonly select: () => void;
	/** Absent on the pinned home view. */
	readonly close?: () => void;
};

export type AtelierTabStripContext = {
	readonly tabs: readonly AtelierTabStripTab[];
	/** Opens a fresh document in its own tab; absent when read-only. */
};

export type AtelierSlots = {
	/** Host-owned content rendered before Atelier's navbar controls. */
	readonly navbarStart?: ReactNode;
	/** Host-owned content rendered before Atelier's final navbar control. */
	readonly navbarEnd?: ReactNode;
	/** Host-owned top-bar center, replacing the built-in view title. */
	readonly navbarCenter?: ReactNode;
	/**
	 * Host-rendered central tab strip (tabs mode only). Selection, closing,
	 * pinning, and navigation rules stay in Atelier; the host renders the
	 * chips. Custom strips forgo the built-in drag-reorder.
	 */
	readonly centralTabStrip?: (context: AtelierTabStripContext) => ReactNode;
	/** Host-owned content rendered when the left panel has no open views. */
	readonly leftPanelEmpty?: AtelierEmptyPanelSlot;
	/** Host-owned content rendered when the central panel has no open views. */
	readonly centralPanelEmpty?: AtelierEmptyPanelSlot;
	/** Host-owned content rendered when the right panel has no open views. */
	readonly rightPanelEmpty?: AtelierEmptyPanelSlot;
};

export type AtelierProps = {
	readonly instance: AtelierInstance;
	readonly slots?: AtelierSlots;
	/** Props forwarded to Atelier's semantic top-bar header. */
	readonly topBarProps?: AtelierTopBarProps;
};

export function Atelier({ instance, slots, topBarProps }: AtelierProps) {
	const configuration = getAtelierConfiguration(instance);
	const defaultOpenPanels = configuration.defaultOpenPanels ?? [];
	return (
		<div className="atelier-root h-full w-full overflow-hidden">
			<LixProvider lix={instance.lix}>
				<Suspense fallback={<AtelierLoadingPlaceholder />}>
					<V2LayoutShell
						instance={instance}
						slots={slots}
						topBarProps={topBarProps}
						extensions={configuration.extensions}
						defaultOpenPanels={defaultOpenPanels}
						onEvent={configuration.onEvent}
					/>
				</Suspense>
			</LixProvider>
		</div>
	);
}

function AtelierLoadingPlaceholder() {
	return <div className="h-full w-full bg-[var(--color-bg-app)]" />;
}
