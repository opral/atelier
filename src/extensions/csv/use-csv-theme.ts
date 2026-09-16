import { useLayoutEffect, useState, type RefObject } from "react";
import { CSV_COLOR_FALLBACKS, type CsvPalette } from "./csv-palette";
const FALLBACK_THEME = {
	baseFontStyle: "13px",
	headerFontStyle: "13px",
	headerIconSize: 16,
	textDark: "#44403c",
	textHeader: "#78716c",
	fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
	accentColor: "rgb(194, 65, 12)",
	accentFg: "rgb(255, 255, 255)",
	accentLight: "rgb(251, 239, 228)",
	bgHeader: "rgb(255, 255, 255)",
	bgHeaderHasFocus: "rgb(255, 255, 255)",
	bgHeaderHovered: "rgb(255, 255, 255)",
	borderColor: "rgb(244, 241, 236)",
	headerBottomBorderColor: "rgb(244, 241, 236)",
	horizontalBorderColor: "rgb(244, 241, 236)",
	linkColor: "rgb(194, 65, 12)",
	resizeIndicatorColor: "rgb(234, 88, 12)",
	textHeaderSelected: "rgb(124, 45, 18)",
};
const colorTokens = {
	textDark: "--at-fg-muted",
	textMedium: "--at-fg-subtle",
	textLight: "--at-fg-faint",
	textHeader: "--at-fg-subtle",
	textHeaderSelected: "--at-accent",
	accentColor: "--at-accent",
	accentFg: "--at-accent-on",
	accentLight: "--at-accent-subtle",
	bgCell: "--at-panel",
	bgCellMedium: "--at-bg-subtle",
	bgHeader: "--at-panel",
	bgHeaderHasFocus: "--at-panel",
	bgHeaderHovered: "--at-bg-hover",
	bgIconHeader: "--at-panel",
	fgIconHeader: "--at-fg-subtle",
	borderColor: "--at-border-subtle",
	headerBottomBorderColor: "--at-border-subtle",
	horizontalBorderColor: "--at-border-subtle",
	linkColor: "--at-link",
	resizeIndicatorColor: "--at-link",
} as const;

const DEFAULT_APPEARANCE = {
	theme: {
		...FALLBACK_THEME,
		textMedium: "#78716c",
		textLight: "#a8a29e",
		bgCell: "#fff",
		bgCellMedium: "#fafaf9",
		bgIconHeader: "#fff",
		fgIconHeader: "#78716c",
	},
	palette: CSV_COLOR_FALLBACKS as CsvPalette,
	searchColor: "#fef08a",
	/** The title column's ink: primary text, the rest of the grid secondary. */
	titleColor: "#1c1917",
	/** The hovered row's ground. */
	hoverColor: "#f5f2ed",
};

/** Canvas cannot consume var(). Resolve the owning table's inherited Atelier tokens. */
export function useCsvTheme(ref: RefObject<HTMLElement | null>) {
	const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const update = () => {
			const styles = getComputedStyle(element);
			const read = (token: string, fallback: string) =>
				styles.getPropertyValue(token).trim() || fallback;
			setAppearance((previous) => {
				const theme = { ...DEFAULT_APPEARANCE.theme };
				for (const [key, token] of Object.entries(colorTokens)) {
					const field = key as keyof typeof colorTokens;
					theme[field] = read(token, theme[field]);
				}
				const palette = Object.fromEntries(
					Object.entries(CSV_COLOR_FALLBACKS).map(([name, [bg, fg]]) => [
						name,
						[read(`--at-tag-${name}`, bg), read(`--at-tag-${name}-fg`, fg)],
					]),
				) as unknown as CsvPalette;
				const next = {
					theme,
					palette,
					searchColor: read("--at-highlight", DEFAULT_APPEARANCE.searchColor),
					titleColor: read("--at-fg", DEFAULT_APPEARANCE.titleColor),
					hoverColor: read("--at-bg-hover", DEFAULT_APPEARANCE.hoverColor),
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
		};
	}, [ref]);
	return appearance;
}
