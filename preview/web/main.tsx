import { openLix } from "@lix-js/sdk";
import type { Lix } from "@lix-js/sdk";
import { Atelier, AtelierDeveloperTools, createAtelier } from "@opral/atelier";
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
	const [atelier] = useState(() =>
		createAtelier({
			lix,
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
		atelier.branches.subscribe,
		atelier.branches.activeId,
		atelier.branches.activeId,
	);
	return (
		<Atelier
			instance={atelier}
			slots={
				import.meta.env.DEV
					? {
							navbarEnd: (
								<AtelierDeveloperTools
									lix={lix}
									currentFile={currentFile}
									branchId={branchId}
								/>
							),
						}
					: undefined
			}
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
