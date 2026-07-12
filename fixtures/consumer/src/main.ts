import type { Lix } from "@lix-js/sdk";
import {
	Atelier,
	createAtelier,
	type AtelierExtensionRuntime,
	type AtelierFilesSnapshot,
	type AtelierProps,
	type AtelierSlots,
	type CheckpointDiff,
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
	const filesSnapshot: AtelierFilesSnapshot = atelier.files.getSnapshot();
	const openFile: (path: string) => Promise<void> = atelier.files.open;
	const createFile: () => Promise<void> = atelier.files.create;
	const closeActiveFile: () => Promise<void> = atelier.files.closeActive;
	createRoot(element).render(
		createElement(Atelier, { instance: atelier, slots }),
	);

	const props: AtelierProps = { instance: atelier, slots };
	void Atelier;
	void props;
	void filesSnapshot;
	void openFile;
	void createFile;
	void closeActiveFile;
}

export function currentRevision(
	runtime: AtelierExtensionRuntime,
): CheckpointDiff | null {
	return runtime.revisions.current;
}
