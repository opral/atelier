import type { Lix } from "@lix-js/sdk";
import {
	Atelier,
	createAtelier,
	type AtelierProps,
	type AtelierSlots,
} from "@opral/atelier";
import "@opral/atelier/style.css";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

export function mountAtelier(lix: Lix): void {
	const element = document.querySelector<HTMLElement>("#atelier");
	if (!element) throw new Error("Atelier fixture mount is missing");
	const slots = {
		navbarStart: null,
		navbarEnd: ({ currentFile }) => currentFile,
	} satisfies AtelierSlots;
	const atelier = createAtelier({ lix });
	createRoot(element).render(
		createElement(Atelier, { instance: atelier, slots }),
	);

	const props: AtelierProps = { instance: atelier, slots };
	void Atelier;
	void props;
}
