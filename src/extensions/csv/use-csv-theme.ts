import { useLayoutEffect, useState, type RefObject } from "react";
import { CSV_COLOR_FALLBACKS, type CsvPalette } from "./csv-palette";
const FALLBACK_THEME = {
	baseFontStyle: "13px",
	headerFontStyle: "13px",
	headerIconSize: 16,
	textDark: "#44403c", // token-literal: canvas fallback for --atelier-fg-muted
	textHeader: "#78716c", // token-literal: canvas fallback for --atelier-fg-subtle
	fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
	accentColor: "rgb(194, 65, 12)", // token-literal: canvas fallback for --atelier-accent
	accentFg: "rgb(255, 255, 255)", // token-literal: canvas fallback for --atelier-accent-on
	accentLight: "rgb(251, 239, 228)", // token-literal: canvas fallback for --atelier-accent-subtle
	bgHeader: "rgb(255, 255, 255)", // token-literal: canvas fallback for --atelier-panel
	bgHeaderHasFocus: "rgb(255, 255, 255)", // token-literal: canvas fallback for --atelier-panel
	bgHeaderHovered: "rgb(245, 242, 237)", // token-literal: canvas fallback for --atelier-bg-hover
	borderColor: "rgb(244, 241, 236)", // token-literal: canvas fallback for --atelier-border-subtle
	headerBottomBorderColor: "rgb(244, 241, 236)", // token-literal: canvas fallback for --atelier-border-subtle
	horizontalBorderColor: "rgb(244, 241, 236)", // token-literal: canvas fallback for --atelier-border-subtle
	linkColor: "rgb(234, 88, 12)", // token-literal: canvas fallback for --atelier-link
	resizeIndicatorColor: "rgb(234, 88, 12)", // token-literal: canvas fallback for --atelier-link
	textHeaderSelected: "rgb(194, 65, 12)", // token-literal: canvas fallback for --atelier-accent
};
const colorTokens = {
	textDark: "--atelier-fg-muted",
	textMedium: "--atelier-fg-subtle",
	textLight: "--atelier-fg-faint",
	textHeader: "--atelier-fg-subtle",
	textHeaderSelected: "--atelier-accent",
	accentColor: "--atelier-accent",
	accentFg: "--atelier-accent-on",
	accentLight: "--atelier-accent-subtle",
	bgCell: "--atelier-panel",
	bgCellMedium: "--atelier-bg-subtle",
	bgHeader: "--atelier-panel",
	bgHeaderHasFocus: "--atelier-panel",
	bgHeaderHovered: "--atelier-bg-hover",
	bgIconHeader: "--atelier-panel",
	fgIconHeader: "--atelier-fg-subtle",
	borderColor: "--atelier-border-subtle",
	headerBottomBorderColor: "--atelier-border-subtle",
	horizontalBorderColor: "--atelier-border-subtle",
	linkColor: "--atelier-link",
	resizeIndicatorColor: "--atelier-link",
} as const;

const DEFAULT_APPEARANCE = {
	theme: {
		...FALLBACK_THEME,
		textMedium: "#78716c", // token-literal: canvas fallback for --atelier-fg-subtle
		textLight: "#a8a29e", // token-literal: canvas fallback for --atelier-fg-faint
		bgCell: "#fff", // token-literal: canvas fallback for --atelier-panel
		bgCellMedium: "#fafaf9", // token-literal: canvas fallback for --atelier-bg-subtle
		bgIconHeader: "#fff", // token-literal: canvas fallback for --atelier-panel
		fgIconHeader: "#78716c", // token-literal: canvas fallback for --atelier-fg-subtle
	},
	palette: CSV_COLOR_FALLBACKS as CsvPalette,
	searchColor: "#fef08a", // token-literal: canvas fallback for --atelier-highlight
	/** The title column's ink: primary text, the rest of the grid secondary. */
	titleColor: "#1c1917", // token-literal: canvas fallback for --atelier-fg
	/** The hovered row's ground. */
	hoverColor: "#f5f2ed", // token-literal: canvas fallback for --atelier-bg-hover
	/** A link's quiet underline at rest; it takes the link colour on hover. */
	linkUnderlineColor: "rgb(214, 211, 209)", // token-literal: canvas fallback for --atelier-border-strong
};

/** Canvas cannot consume var(). Resolve the owning table's inherited Atelier tokens. */
export function useCsvTheme(ref: RefObject<HTMLElement | null>) {
	const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		// A custom property's computed value is its token stream, so a token
		// written as `light-dark(a, b)` reads back as that text, which no canvas
		// fillStyle or gradient stop accepts. Assigning it to a real colour
		// property on a child of the table resolves it under the table's own
		// colour scheme, and the computed colour is what the canvas gets.
		const probe = element.ownerDocument.createElement("span");
		probe.hidden = true;
		element.append(probe);
		const update = () => {
			const styles = getComputedStyle(element);
			const read = (token: string, fallback: string) => {
				const raw = styles.getPropertyValue(token).trim();
				if (!raw) return fallback;
				probe.style.color = "";
				probe.style.color = raw;
				if (!probe.style.color) return fallback;
				return getComputedStyle(probe).color || raw;
			};
			setAppearance((previous) => {
				const theme = { ...DEFAULT_APPEARANCE.theme };
				for (const [key, token] of Object.entries(colorTokens)) {
					const field = key as keyof typeof colorTokens;
					theme[field] = read(token, theme[field]);
				}
				const palette = Object.fromEntries(
					Object.entries(CSV_COLOR_FALLBACKS).map(([name, [bg, fg]]) => [
						name,
						[
							read(`--atelier-tag-${name}`, bg),
							read(`--atelier-tag-${name}-fg`, fg),
						],
					]),
				) as unknown as CsvPalette;
				const next = {
					theme,
					palette,
					searchColor: read(
						"--atelier-highlight",
						DEFAULT_APPEARANCE.searchColor,
					),
					titleColor: read("--atelier-fg", DEFAULT_APPEARANCE.titleColor),
					hoverColor: read("--atelier-bg-hover", DEFAULT_APPEARANCE.hoverColor),
					linkUnderlineColor: read(
						"--atelier-border-strong",
						DEFAULT_APPEARANCE.linkUnderlineColor,
					),
				};
				return JSON.stringify(next) === JSON.stringify(previous)
					? previous
					: next;
			});
		};
		update();
		const observer = new MutationObserver(update);
		// Theme overrides can live on the host, an ancestor, or document root.
		for (let node: Element | null = element; node;) {
			observer.observe(node, {
				attributes: true,
				attributeFilter: ["class", "style", "data-theme"],
			});
			node =
				node.parentElement ??
				(node.getRootNode() instanceof ShadowRoot
					? (node.getRootNode() as ShadowRoot).host
					: null);
		}
		const scheme = window.matchMedia("(prefers-color-scheme: dark)");
		scheme.addEventListener("change", update);
		return () => {
			observer.disconnect();
			scheme.removeEventListener("change", update);
			probe.remove();
		};
	}, [ref]);
	return appearance;
}
