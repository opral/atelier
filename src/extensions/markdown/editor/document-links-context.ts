import { createContext, useContext } from "react";
import type { AtelierDocumentLinks } from "@/extension-api";

/** The host's file URLs for the Markdown views under one extension entry. */
export const DocumentLinksContext = createContext<
	AtelierDocumentLinks | undefined
>(undefined);

export function useDocumentLinks(): AtelierDocumentLinks | undefined {
	return useContext(DocumentLinksContext);
}
