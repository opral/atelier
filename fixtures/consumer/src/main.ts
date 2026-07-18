import type { Lix } from "@lix-js/sdk";
import {
	Atelier,
	ATELIER_BUILTIN_EXTENSION_IDS,
	createAtelier,
	type AtelierExtensionRegistration,
	type AtelierExtensionRuntime,
	type AtelierProps,
	type AtelierRevisionSelection,
	type AtelierSlots,
	type AtelierTopBarProps,
} from "@opral/atelier";
import { fileIconUrl } from "@opral/atelier/file-icons";
import "@opral/atelier/style.css";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

export function mountAtelier(lix: Lix): void {
	const element = document.querySelector<HTMLElement>("#atelier");
	if (!element) throw new Error("Atelier fixture mount is missing");
	const slots = {
		navbarStart: null,
		navbarEnd: null,
	} satisfies AtelierSlots;
	const historyOverride = {
		manifest: {
			apiVersion: 1,
			id: ATELIER_BUILTIN_EXTENSION_IDS.history,
			name: "Host History",
		},
		entry: {
			icon: FixtureExtensionIcon,
			mount: ({ element: extensionElement }) => {
				extensionElement.textContent = "Host history";
			},
		},
	} satisfies AtelierExtensionRegistration;
	const atelier = createAtelier({ lix, extensions: [historyOverride] });
	const topBarProps = {
		"data-host-titlebar": true,
	} satisfies AtelierTopBarProps;
	const openDocument: (path: string) => Promise<void> = atelier.documents.open;
	const startNewDocument: () => Promise<void> = atelier.documents.startNew;
	const closeActiveDocument: () => Promise<void> =
		atelier.documents.closeActive;
	createRoot(element).render(
		createElement(Atelier, { instance: atelier, slots, topBarProps }),
	);

	const props: AtelierProps = { instance: atelier, slots, topBarProps };
	void Atelier;
	void props;
	void openDocument;
	void startNewDocument;
	void closeActiveDocument;
	void fileIconUrl("/README.md");
}

function FixtureExtensionIcon() {
	return null;
}

export function currentRevision(
	runtime: AtelierExtensionRuntime,
): AtelierRevisionSelection | null {
	return runtime.revisions.current;
}
