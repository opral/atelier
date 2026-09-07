import type { Lix } from "@lix-js/sdk";
import {
	Atelier,
	type AtelierShellProps,
	type AtelierShellHandle,
	type AtelierSlots,
	type AtelierTopBarProps,
} from "@opral/atelier";
import { fileIconUrl } from "@opral/atelier/file-icons";
import "@opral/atelier/style.css";
import { createElement, createRef } from "react";
import { createRoot } from "react-dom/client";

export function mountAtelier(lix: Lix): void {
	const element = document.querySelector<HTMLElement>("#atelier");
	if (!element) throw new Error("Atelier fixture mount is missing");
	const slots = {
		navbarStart: null,
		navbarEnd: null,
	} satisfies AtelierSlots;
	const ref = createRef<AtelierShellHandle>();
	const topBarProps = {
		"data-host-titlebar": true,
	} satisfies AtelierTopBarProps;
	createRoot(element).render(
		createElement(Atelier.Shell, { lix, ref, slots, topBarProps }),
	);

	const props: AtelierShellProps = { lix, slots, topBarProps };
	void Atelier;
	void props;
	void createElement(Atelier.FileView, { lix, fileId: "file", readOnly: true });
	void fileIconUrl("/README.md");
}
