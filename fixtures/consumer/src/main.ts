import type { Lix } from "@lix-js/sdk";
import {
	Atelier,
	type AtelierProps,
	type AtelierHistoryProps,
	type AtelierExtensionRegistration,
	loadAtelier,
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
	const topBarProps = {
		"data-host-titlebar": true,
	} satisfies AtelierTopBarProps;
	createRoot(element).render(
		createElement(Atelier, { lix, slots, topBarProps }),
	);

	const props: AtelierProps = { lix, slots, topBarProps };
	void Atelier;
	void props;
	void createElement(Atelier, {
		lix,
		location: { path: "/README.md" },
		readOnly: true,
	});
	const extension: AtelierExtensionRegistration = {
		id: "consumer_summary",
		load: async () => ({ title: "Summary" }),
		Component: ({ data }) =>
			createElement("article", null, JSON.stringify(data)),
	};
	void loadAtelier({
		lix,
		location: { view: extension.id },
		extensions: [extension],
	});
	void fileIconUrl("/README.md");
}

export function renderHistory(atelier: AtelierHistoryProps["atelier"]) {
	return createElement(Atelier.History, { atelier });
}
