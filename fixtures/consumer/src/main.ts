import type { Lix } from "@lix-js/sdk";
import {
	Atelier,
	createAtelier,
	type AtelierProps,
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
	const atelier = createAtelier({ lix });
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
