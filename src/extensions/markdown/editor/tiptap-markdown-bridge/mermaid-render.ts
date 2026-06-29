import mermaid from "mermaid";

let initialized = false;
let renderCounter = 0;

function isDarkMode(): boolean {
	return document.documentElement.classList.contains("dark");
}

function ensureMermaidInitialized(): void {
	if (initialized) return;
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: isDarkMode() ? "dark" : "default",
	});
	initialized = true;
}

export function resetMermaidForTests(): void {
	initialized = false;
	renderCounter = 0;
}

export async function renderMermaidDiagram(
	source: string,
	container: HTMLElement,
): Promise<void> {
	const trimmed = source.trim();
	container.replaceChildren();
	if (!trimmed) {
		return;
	}

	ensureMermaidInitialized();
	const renderId = `flashtype-mermaid-${++renderCounter}`;
	const { svg } = await mermaid.render(renderId, trimmed);
	const wrapper = document.createElement("div");
	wrapper.innerHTML = svg;
	container.appendChild(wrapper);
}
