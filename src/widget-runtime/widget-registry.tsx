import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import type { WidgetDefinition, WidgetKind } from "./types";
import {
	BUILTIN_VISIBLE_WIDGET_DEFINITIONS,
	BUILTIN_WIDGET_DEFINITIONS,
} from "./builtin-widget-registry";
import { normalizeInstalledWidgetDefinitions } from "./installed-widget-registry";

type WidgetRegistryValue = {
	readonly visibleWidgets: WidgetDefinition[];
	readonly widgetMap: Map<WidgetKind, WidgetDefinition>;
	readonly installedWidgets: WidgetDefinition[];
	replaceInstalledWidgets: (definitions: readonly WidgetDefinition[]) => void;
	clearInstalledWidgets: () => void;
};

const buildWidgetRegistry = (
	installedDefinitions: readonly WidgetDefinition[],
): Pick<WidgetRegistryValue, "visibleWidgets" | "widgetMap"> => {
	const builtinKinds = new Set(
		BUILTIN_WIDGET_DEFINITIONS.map((def) => def.kind),
	);
	const installedVisible = normalizeInstalledWidgetDefinitions(
		installedDefinitions,
	).filter((def) => !builtinKinds.has(def.kind));

	const visibleWidgets = [
		...BUILTIN_VISIBLE_WIDGET_DEFINITIONS,
		...installedVisible,
	];
	const widgetMap = new Map<WidgetKind, WidgetDefinition>(
		[...BUILTIN_WIDGET_DEFINITIONS, ...installedVisible].map((def) => [
			def.kind,
			def,
		]),
	);

	return { visibleWidgets, widgetMap };
};

const BASE_REGISTRY = buildWidgetRegistry([]);

export const WIDGET_DEFINITIONS: WidgetDefinition[] =
	BASE_REGISTRY.visibleWidgets;
export const WIDGET_MAP: Map<WidgetKind, WidgetDefinition> =
	BASE_REGISTRY.widgetMap;

const NOOP = () => {};

const WidgetRegistryContext = createContext<WidgetRegistryValue>({
	visibleWidgets: WIDGET_DEFINITIONS,
	widgetMap: WIDGET_MAP,
	installedWidgets: [],
	replaceInstalledWidgets: NOOP,
	clearInstalledWidgets: NOOP,
});

export function WidgetRegistryProvider({ children }: { children: ReactNode }) {
	const [installedWidgets, setInstalledWidgets] = useState<WidgetDefinition[]>(
		[],
	);

	const replaceInstalledWidgets = useCallback(
		(definitions: readonly WidgetDefinition[]) => {
			setInstalledWidgets(normalizeInstalledWidgetDefinitions(definitions));
		},
		[],
	);

	const clearInstalledWidgets = useCallback(() => {
		setInstalledWidgets([]);
	}, []);

	const value = useMemo<WidgetRegistryValue>(() => {
		const merged = buildWidgetRegistry(installedWidgets);
		return {
			visibleWidgets: merged.visibleWidgets,
			widgetMap: merged.widgetMap,
			installedWidgets,
			replaceInstalledWidgets,
			clearInstalledWidgets,
		};
	}, [installedWidgets, replaceInstalledWidgets, clearInstalledWidgets]);

	return (
		<WidgetRegistryContext.Provider value={value}>
			{children}
		</WidgetRegistryContext.Provider>
	);
}

export function useWidgetRegistry(): WidgetRegistryValue {
	return useContext(WidgetRegistryContext);
}

let widgetCounter = 0;

export function createWidgetInstanceId(kind: WidgetKind): string {
	widgetCounter += 1;
	return `${kind}-${widgetCounter}`;
}
