import { openLix } from "@lix-js/sdk";
import { Atelier, createAtelier } from "@opral/atelier";
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
	createRoot(mountElement).render(<Atelier instance={atelier} />);
}

void start().catch((error: unknown) => {
	console.error("Unable to start the Atelier web preview", error);
	mountElement.replaceChildren();
	const message = document.createElement("pre");
	message.textContent =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	mountElement.append(message);
});
