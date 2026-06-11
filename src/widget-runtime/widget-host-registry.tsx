import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	type ReactNode,
} from "react";
import type { WidgetContext, WidgetDefinition, WidgetInstance } from "./types";

export type WidgetHostRecord = {
	readonly instanceId: string;
	readonly container: HTMLDivElement;
	view: WidgetDefinition;
	instance: WidgetInstance;
	cleanup: (() => void) | undefined;
	lastContext: WidgetContext;
};

type EnsureArgs = {
	instance: WidgetInstance;
	view: WidgetDefinition;
	context: WidgetContext;
};

type WidgetHostRegistry = {
	ensureHost: (args: EnsureArgs) => WidgetHostRecord;
	pruneHosts: (activeInstances: Set<string>) => void;
};

const WidgetHostRegistryContext = createContext<WidgetHostRegistry | null>(
	null,
);

export function WidgetHostRegistryProvider({
	children,
}: {
	children: ReactNode;
}) {
	const hostsRef = useRef<Map<string, WidgetHostRecord>>(new Map());

	const ensureHost = useCallback(
		({ instance, view, context }: EnsureArgs): WidgetHostRecord => {
			let record = hostsRef.current.get(instance.instance);
			if (!record) {
				const container = document.createElement("div");
				container.className =
					"flex min-h-0 flex-1 flex-col overflow-hidden w-full h-full";
				const maybeCleanup = view.render({
					context,
					instance,
					target: container,
				});
				const cleanup =
					typeof maybeCleanup === "function" ? maybeCleanup : undefined;
				record = {
					instanceId: instance.instance,
					container,
					view,
					instance,
					cleanup,
					lastContext: context,
				};
				hostsRef.current.set(instance.instance, record);
				return record;
			}

			record.cleanup?.();
			const maybeCleanup = view.render({
				context,
				instance,
				target: record.container,
			});
			record.cleanup =
				typeof maybeCleanup === "function" ? maybeCleanup : undefined;
			record.instance = instance;
			record.view = view;
			record.lastContext = context;
			return record;
		},
		[],
	);

	const pruneHosts = useCallback((activeInstances: Set<string>) => {
		for (const [key, record] of hostsRef.current) {
			if (activeInstances.has(key)) continue;
			record.cleanup?.();
			record.container.remove();
			hostsRef.current.delete(key);
		}
	}, []);

	const value = useMemo<WidgetHostRegistry>(
		() => ({
			ensureHost,
			pruneHosts,
		}),
		[ensureHost, pruneHosts],
	);

	return (
		<WidgetHostRegistryContext.Provider value={value}>
			{children}
		</WidgetHostRegistryContext.Provider>
	);
}

export function useWidgetHostRegistry(): WidgetHostRegistry {
	const ctx = useContext(WidgetHostRegistryContext);
	if (!ctx) {
		throw new Error("useWidgetHostRegistry must be used within the provider.");
	}
	return ctx;
}
