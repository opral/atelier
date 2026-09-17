import { createContext, useContext } from "react";
import type { AtelierLocation } from "./atelier-state";

export type AtelierNavigation = {
	/** A real URL, used for native links even before JavaScript starts. */
	href(location: AtelierLocation): string;
	/** Raw file URL for native media, usable without a browser Lix connection. */
	fileHref?(file: {
		path: string;
		branchId?: string;
		commitId?: string;
	}): string;
	navigate?(location: AtelierLocation): void;
};

export const AtelierRenderContext = createContext<{
	navigation?: AtelierNavigation;
}>({});

export function useAtelierRenderContext() {
	return useContext(AtelierRenderContext);
}
