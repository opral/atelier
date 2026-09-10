import {
	resolveMarkdownAssetPath,
	type MarkdownWorkspaceFileOpener,
} from "./markdown-asset";

/** Relative Markdown destinations are resolved against the containing file. */
export function documentLinkPath(
	href: string,
	sourceFilePath: string,
): string | null {
	if (!href.trim() || /^[#?]/.test(href) || /^[a-z][a-z\d+.-]*:/i.test(href))
		return null;
	return resolveMarkdownAssetPath({ src: href, sourceFilePath });
}

export function bindDocumentLinks(
	root: HTMLElement,
	sourceFilePath: string,
	openFile: MarkdownWorkspaceFileOpener,
	sourceCommitId?: string,
	exists: (path: string) => boolean | undefined = () => undefined,
): () => void {
	let active: HTMLAnchorElement | null = null;
	let card: HTMLDivElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	let describedLink: HTMLAnchorElement | null = null;
	let previousDescription: string | null = null;
	const tooltipId = `markdown-link-${crypto.randomUUID()}`;
	const anchor = (event: Event) => {
		const link =
			event.target instanceof Element ? event.target.closest("a[href]") : null;
		return link instanceof HTMLAnchorElement && root.contains(link)
			? link
			: null;
	};
	const hide = () => {
		clearTimeout(timer);
		if (describedLink) {
			if (previousDescription === null)
				describedLink.removeAttribute("aria-describedby");
			else describedLink.setAttribute("aria-describedby", previousDescription);
			describedLink = null;
		}
		card?.remove();
		card = null;
		active = null;
	};
	const show = (link: HTMLAnchorElement, path: string, error?: string) => {
		hide();
		active = link;
		card = document.createElement("div");
		card.id = tooltipId;
		card.addEventListener("mouseenter", () => clearTimeout(timer));
		card.addEventListener("mouseleave", () => {
			timer = setTimeout(hide, 120);
		});
		describedLink = link;
		previousDescription = link.getAttribute("aria-describedby");
		link.setAttribute(
			"aria-describedby",
			[previousDescription, tooltipId].filter(Boolean).join(" "),
		);
		card.className = "atelier-markdown-link-card";
		card.setAttribute("role", error ? "alert" : "tooltip");
		const missing = exists(path) === false;
		const label = document.createElement("strong");
		label.textContent = error
			? "Could not open document"
			: missing
				? "Not in this repository"
				: "In this repository";
		const destination = document.createElement("div");
		destination.className = "atelier-markdown-link-path";
		destination.textContent = path;
		const hint = document.createElement("div");
		hint.textContent =
			error ??
			(missing ? "No file at this path yet" : "Click to open in a tab");
		card.append(label, destination, hint);
		(root.closest(".atelier-root") ?? document.body).append(card);
		const rect = link.getBoundingClientRect();
		card.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - card.offsetWidth - 8))}px`;
		card.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - card.offsetHeight - 8))}px`;
	};
	const hover = (event: Event) => {
		const link = anchor(event);
		if (!link) return;
		if (link === active && card) {
			clearTimeout(timer);
			return;
		}
		hide();
		const path =
			link && documentLinkPath(link.getAttribute("href") ?? "", sourceFilePath);
		if (!link || !path) return;
		active = link;
		timer = setTimeout(
			() => show(link, path),
			event.type === "focusin" ? 0 : 250,
		);
	};
	const leave = (event: Event) => {
		if (
			event instanceof MouseEvent &&
			active?.contains(event.relatedTarget as Node | null)
		)
			return;
		clearTimeout(timer);
		timer = setTimeout(hide, 120);
	};
	const activate = (event: Event) => {
		if (event instanceof MouseEvent && event.button !== 0 && event.button !== 1)
			return;
		if (event.type === "auxclick" && (event as MouseEvent).button !== 1) return;
		if (event instanceof KeyboardEvent && event.key !== "Enter") return;
		const link = anchor(event);
		const path =
			link && documentLinkPath(link.getAttribute("href") ?? "", sourceFilePath);
		if (!link || !path) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		hide();
		if (exists(path) === false) {
			show(link, path, "No file at this path yet.");
			return;
		}
		Promise.resolve()
			.then(() =>
				openFile({
					filePath: path,
					focus: true,
					newTab: true,
					...(sourceCommitId ? { state: { sourceCommitId } } : {}),
				}),
			)
			.catch(() => {
				if (!disposed && root.isConnected)
					show(link, path, "Check the path and try again.");
			});
	};
	const escape = (event: KeyboardEvent) => {
		if (event.key === "Escape") hide();
	};
	root.addEventListener("click", activate, true);
	root.addEventListener("auxclick", activate, true);
	root.addEventListener("keydown", activate, true);
	root.addEventListener("mouseover", hover);
	root.addEventListener("focusin", hover);
	root.addEventListener("mouseout", leave);
	root.addEventListener("focusout", leave);
	window.addEventListener("keydown", escape);
	window.addEventListener("scroll", hide, true);
	window.addEventListener("resize", hide);
	return () => {
		disposed = true;
		hide();
		root.removeEventListener("click", activate, true);
		root.removeEventListener("auxclick", activate, true);
		root.removeEventListener("keydown", activate, true);
		root.removeEventListener("mouseover", hover);
		root.removeEventListener("focusin", hover);
		root.removeEventListener("mouseout", leave);
		root.removeEventListener("focusout", leave);
		window.removeEventListener("keydown", escape);
		window.removeEventListener("scroll", hide, true);
		window.removeEventListener("resize", hide);
	};
}
