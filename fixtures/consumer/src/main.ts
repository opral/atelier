import type { Lix } from "@lix-js/sdk";
import { createAtelier } from "@opral/atelier";
import "@opral/atelier/style.css";

export function mountAtelier(lix: Lix): void {
	const element = document.querySelector<HTMLElement>("#atelier");
	if (!element) throw new Error("Atelier fixture mount is missing");
	createAtelier({ element, lix });
}
