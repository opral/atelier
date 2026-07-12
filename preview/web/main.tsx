import { openLix } from "@lix-js/sdk";
import type { Lix } from "@lix-js/sdk";
import { Atelier, AtelierDeveloperTools, createAtelier } from "@opral/atelier";
import { useEffect, useState } from "react";
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
	const atelier = createAtelier({ lix });
	createRoot(mountElement).render(
		<Atelier
			instance={atelier}
			slots={
				import.meta.env.DEV
					? { navbarEnd: <PreviewDeveloperTools lix={lix} /> }
					: undefined
			}
		/>,
	);
}

function PreviewDeveloperTools({ lix }: { readonly lix: Lix }) {
	const [currentFile, setCurrentFile] = useState<string | null>(null);

	useEffect(() => {
		let closed = false;
		const events = lix.observe(
			"SELECT value FROM lix_key_value_by_branch WHERE key = ? AND lixcol_branch_id = ?",
			["atelier_active_file_id", "global"],
		);
		void (async () => {
			try {
				while (!closed) {
					const event = await events.next();
					if (!event || closed) break;
					const fileId = event.result.rows[0]?.get("value");
					if (typeof fileId !== "string") {
						setCurrentFile(null);
						continue;
					}
					const file = await lix.execute(
						"SELECT path FROM lix_file WHERE id = ? LIMIT 1",
						[fileId],
					);
					if (!closed) {
						const path = file.rows[0]?.get("path");
						setCurrentFile(typeof path === "string" ? path : null);
					}
				}
			} catch (error) {
				if (!closed) {
					console.warn(
						"Unable to resolve the active preview file for developer tools",
						error,
					);
				}
			}
		})();
		return () => {
			closed = true;
			events.close();
		};
	}, [lix]);

	return <AtelierDeveloperTools lix={lix} currentFile={currentFile} />;
}

void start().catch((error: unknown) => {
	console.error("Unable to start the Atelier web preview", error);
	mountElement.replaceChildren();
	const message = document.createElement("pre");
	message.textContent =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	mountElement.append(message);
});
