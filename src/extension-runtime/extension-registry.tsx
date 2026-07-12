import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import type { ExtensionDefinition, ExtensionKind } from "./types";
import {
	BUILTIN_VISIBLE_EXTENSION_DEFINITIONS,
	BUILTIN_EXTENSION_DEFINITIONS,
} from "./builtin-extension-registry";
import { normalizeInstalledExtensionDefinitions } from "./installed-extension-registry";

type ExtensionRegistryValue = {
	readonly visibleExtensions: ExtensionDefinition[];
	readonly extensionMap: Map<ExtensionKind, ExtensionDefinition>;
	replaceInstalledExtensions: (
		definitions: readonly ExtensionDefinition[],
	) => void;
};

/** @internal */
export const buildExtensionRegistry = (
	hostDefinitions: readonly ExtensionDefinition[],
	installedDefinitions: readonly ExtensionDefinition[],
): Pick<ExtensionRegistryValue, "visibleExtensions" | "extensionMap"> => {
	const bundledKinds = new Set(
		BUILTIN_EXTENSION_DEFINITIONS.map((definition) => definition.kind),
	);
	const overrideMap = new Map(
		hostDefinitions
			.filter((definition) => bundledKinds.has(definition.kind))
			.map((definition) => [definition.kind, definition] as const),
	);
	const builtinDefinitions = BUILTIN_EXTENSION_DEFINITIONS.map(
		(definition) => overrideMap.get(definition.kind) ?? definition,
	);
	const builtinVisibleDefinitions = BUILTIN_VISIBLE_EXTENSION_DEFINITIONS.map(
		(definition) => overrideMap.get(definition.kind) ?? definition,
	);
	const builtinKinds = new Set(builtinDefinitions.map((def) => def.kind));
	const hostVisible = normalizeInstalledExtensionDefinitions(
		hostDefinitions,
	).filter((def) => !builtinKinds.has(def.kind));
	const reservedKinds = new Set([
		...builtinKinds,
		...hostVisible.map((definition) => definition.kind),
	]);
	const installedVisible = normalizeInstalledExtensionDefinitions(
		installedDefinitions,
	).filter((def) => !reservedKinds.has(def.kind));

	const visibleExtensions = [
		...builtinVisibleDefinitions,
		...hostVisible,
		...installedVisible,
	];
	const extensionMap = new Map<ExtensionKind, ExtensionDefinition>(
		[...builtinDefinitions, ...hostVisible, ...installedVisible].map((def) => [
			def.kind,
			def,
		]),
	);

	return { visibleExtensions, extensionMap };
};

const BASE_REGISTRY = buildExtensionRegistry([], []);

export const EXTENSION_DEFINITIONS: ExtensionDefinition[] =
	BASE_REGISTRY.visibleExtensions;
export const EXTENSION_MAP: Map<ExtensionKind, ExtensionDefinition> =
	BASE_REGISTRY.extensionMap;

const NOOP = () => {};

const ExtensionRegistryContext = createContext<ExtensionRegistryValue>({
	visibleExtensions: EXTENSION_DEFINITIONS,
	extensionMap: EXTENSION_MAP,
	replaceInstalledExtensions: NOOP,
});

export function ExtensionRegistryProvider({
	children,
	hostExtensions = [],
}: {
	children: ReactNode;
	readonly hostExtensions?: readonly ExtensionDefinition[];
}) {
	const [installedExtensions, setInstalledExtensions] = useState<
		ExtensionDefinition[]
	>([]);

	const replaceInstalledExtensions = useCallback(
		(definitions: readonly ExtensionDefinition[]) => {
			const builtinKinds = new Set(
				BUILTIN_EXTENSION_DEFINITIONS.map((definition) => definition.kind),
			);
			const accepted = definitions.filter((definition) => {
				if (!builtinKinds.has(definition.kind)) return true;
				console.warn(
					`[extension-loader] Workspace extension id "${definition.kind}" conflicts with a bundled extension.`,
				);
				return false;
			});
			setInstalledExtensions(normalizeInstalledExtensionDefinitions(accepted));
		},
		[],
	);

	const value = useMemo<ExtensionRegistryValue>(() => {
		const merged = buildExtensionRegistry(hostExtensions, installedExtensions);
		return {
			visibleExtensions: merged.visibleExtensions,
			extensionMap: merged.extensionMap,
			replaceInstalledExtensions,
		};
	}, [hostExtensions, installedExtensions, replaceInstalledExtensions]);

	return (
		<ExtensionRegistryContext.Provider value={value}>
			{children}
		</ExtensionRegistryContext.Provider>
	);
}

export function useExtensionRegistry(): ExtensionRegistryValue {
	return useContext(ExtensionRegistryContext);
}

let extensionCounter = 0;

export function createExtensionInstanceId(kind: ExtensionKind): string {
	extensionCounter += 1;
	return `${kind}-${extensionCounter}`;
}
