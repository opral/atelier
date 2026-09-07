import { useEffect, useRef, useState } from "react";
import { useExtensionRegistry } from "./extension-registry";
import {
	loadInstalledExtensionsFromRows,
	reconcileInstalledExtensionCandidates,
	type InstalledExtensionFileRow,
} from "./installed-extension-loader";
import type { ExtensionDefinition } from "./types";

/** Shared discovery lifecycle for shell and standalone file views. */
export function useInstalledExtensionRegistry(
	rows: readonly InstalledExtensionFileRow[],
	ready: boolean,
) {
	const { replaceInstalledExtensions } = useExtensionRegistry();
	const previous = useRef(new Map<string, ExtensionDefinition>());
	const [loaded, setLoaded] = useState<{
		rows: readonly InstalledExtensionFileRow[];
		status: "ready" | "error";
		error?: unknown;
	} | null>(null);
	useEffect(() => {
		if (!ready) return;
		let cancelled = false;
		void loadInstalledExtensionsFromRows(rows)
			.then((candidates) => {
				if (cancelled) return;
				previous.current = reconcileInstalledExtensionCandidates(
					previous.current,
					candidates,
				);
				replaceInstalledExtensions([...previous.current.values()]);
				setLoaded({ rows, status: "ready" });
			})
			.catch((error: unknown) => {
				if (!cancelled) setLoaded({ rows, status: "error", error });
			});
		return () => {
			cancelled = true;
		};
	}, [rows, ready, replaceInstalledExtensions]);
	return ready && loaded?.rows === rows
		? loaded
		: { status: "loading" as const };
}
