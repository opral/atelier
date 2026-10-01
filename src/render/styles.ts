import { CHROME_CSS } from "./chrome.generated";
import { DOCUMENT_CSS } from "../shell/document.generated";
import { THEME_CSS } from "../shell/theme.generated";

/** The static renderer uses the same canonical CSS as the mounted editor. */
export const RENDER_CSS = [THEME_CSS, DOCUMENT_CSS, CHROME_CSS]
	.join("\n")
	.trim();
