import type { Lix } from "@lix-js/sdk";
import {
	Atelier,
	createAtelier,
	type AtelierProps,
	type AtelierSlots,
} from "@opral/atelier";
import "@opral/atelier/style.css";

export function mountAtelier(lix: Lix): void {
	const element = document.querySelector<HTMLElement>("#atelier");
	if (!element) throw new Error("Atelier fixture mount is missing");
	const slots = {
		navbarStart: null,
		navbarEnd: ({ currentFile }) => currentFile,
	} satisfies AtelierSlots;
	createAtelier({ element, lix, slots });

	const props: AtelierProps = { lix, slots };
	void Atelier;
	void props;
}
