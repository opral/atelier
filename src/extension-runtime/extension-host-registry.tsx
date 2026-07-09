import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	type ReactNode,
} from "react";
import type {
	ExtensionDefinition,
	ExtensionInstance,
	ExtensionRuntime,
	ExtensionView,
	MountedExtension,
} from "./types";

export type ExtensionHostRecord = {
	readonly instanceId: string;
	readonly container: HTMLDivElement;
	view: ExtensionDefinition;
	instance: ExtensionInstance;
	mounted: MountedExtension | undefined;
	abortController: AbortController;
};

type EnsureArgs = {
	instance: ExtensionInstance;
	view: ExtensionDefinition;
	atelier: ExtensionRuntime;
	extensionView: ExtensionView;
};

type ExtensionHostRegistry = {
	ensureHost: (args: EnsureArgs) => ExtensionHostRecord;
	pruneHosts: (activeInstances: Set<string>) => void;
};

function mountExtension(args: {
	view: ExtensionDefinition;
	atelier: ExtensionRuntime;
	extensionView: ExtensionView;
	element: HTMLElement;
}): {
	mounted: MountedExtension | undefined;
	abortController: AbortController;
} {
	const abortController = new AbortController();
	const mounted = args.view.mount({
		atelier: args.atelier,
		view: args.extensionView,
		element: args.element,
		signal: abortController.signal,
	});
	if (mounted !== undefined) {
		if (!mounted || typeof mounted !== "object") {
			throw new Error("Extension mount must return an object or undefined.");
		}
		if (mounted.update !== undefined && typeof mounted.update !== "function") {
			throw new Error("Extension update must be a function when provided.");
		}
		if (
			mounted.dispose !== undefined &&
			typeof mounted.dispose !== "function"
		) {
			throw new Error("Extension dispose must be a function when provided.");
		}
	}
	return { mounted: mounted || undefined, abortController };
}

function disposeExtension(record: ExtensionHostRecord): void {
	record.abortController.abort();
	record.mounted?.dispose?.();
}

const ExtensionHostRegistryContext =
	createContext<ExtensionHostRegistry | null>(null);

export function ExtensionHostRegistryProvider({
	children,
}: {
	children: ReactNode;
}) {
	const hostsRef = useRef<Map<string, ExtensionHostRecord>>(new Map());

	const ensureHost = useCallback(
		({
			instance,
			view,
			atelier,
			extensionView,
		}: EnsureArgs): ExtensionHostRecord => {
			let record = hostsRef.current.get(instance.instance);
			if (!record) {
				const container = document.createElement("div");
				container.className =
					"flex min-h-0 flex-1 flex-col overflow-hidden w-full h-full";
				const lifecycle = mountExtension({
					view,
					atelier,
					extensionView,
					element: container,
				});
				record = {
					instanceId: instance.instance,
					container,
					view,
					instance,
					...lifecycle,
				};
				hostsRef.current.set(instance.instance, record);
				return record;
			}

			if (record.view !== view) {
				disposeExtension(record);
				const lifecycle = mountExtension({
					view,
					atelier,
					extensionView,
					element: record.container,
				});
				record.mounted = lifecycle.mounted;
				record.abortController = lifecycle.abortController;
			} else {
				record.mounted?.update?.({ atelier, view: extensionView });
			}
			record.instance = instance;
			record.view = view;
			return record;
		},
		[],
	);

	const pruneHosts = useCallback((activeInstances: Set<string>) => {
		for (const [key, record] of hostsRef.current) {
			if (activeInstances.has(key)) continue;
			disposeExtension(record);
			record.container.remove();
			hostsRef.current.delete(key);
		}
	}, []);

	const value = useMemo<ExtensionHostRegistry>(
		() => ({
			ensureHost,
			pruneHosts,
		}),
		[ensureHost, pruneHosts],
	);

	useEffect(() => {
		const hosts = hostsRef.current;
		return () => {
			for (const record of hosts.values()) {
				disposeExtension(record);
				record.container.remove();
			}
			hosts.clear();
		};
	}, []);

	return (
		<ExtensionHostRegistryContext.Provider value={value}>
			{children}
		</ExtensionHostRegistryContext.Provider>
	);
}

export function useExtensionHostRegistry(): ExtensionHostRegistry {
	const ctx = useContext(ExtensionHostRegistryContext);
	if (!ctx) {
		throw new Error(
			"useExtensionHostRegistry must be used within the provider.",
		);
	}
	return ctx;
}
