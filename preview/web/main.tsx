import { openLix } from "@lix-js/sdk";
import type { Lix } from "@lix-js/sdk";
import {
	Atelier,
	AtelierDeveloperTools,
	createAtelier,
	createLixBranchSession,
} from "@opral/atelier";
import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "@opral/atelier/style.css";
import { seedWorkspace } from "./seed-workspace";
import "./style.css";

const element = document.querySelector<HTMLElement>("#atelier");
if (!element) throw new Error("Atelier web preview mount element is missing");
const mountElement = element;

async function start() {
	const lix = await openLix();
	await seedWorkspace(lix);
	createRoot(mountElement).render(<PreviewApp lix={lix} />);
}

function PreviewApp({ lix }: { readonly lix: Lix }) {
	const [currentFile, setCurrentFile] = useState<string | null>(null);
	const [branchSession] = useState(() => createLixBranchSession(lix));
	const [atelier] = useState(() =>
		createAtelier({
			lix,
			branchSession,
			onEvent: (event) => {
				if (event.type === "document_viewed") {
					setCurrentFile(event.filePath);
				} else if (event.type === "document_closed") {
					setCurrentFile(event.nextFilePath);
				}
			},
		}),
	);
	const branchId = useSyncExternalStore(
		branchSession.subscribe,
		branchSession.getSnapshot,
		branchSession.getSnapshot,
	);
	return (
		<Atelier
			instance={atelier}
			slots={{
				navbarEnd: (
					<AtelierDeveloperTools
						lix={lix}
						currentFile={currentFile}
						branchId={branchId}
					/>
				),
			}}
		/>
	);
}

void start().catch((error: unknown) => {
	console.error("Unable to start the Atelier web preview", error);
	mountElement.replaceChildren();
	const message = document.createElement("pre");
	message.textContent =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	mountElement.append(message);
});
