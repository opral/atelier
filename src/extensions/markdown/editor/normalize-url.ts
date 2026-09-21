/**
 * The schemes a link may carry. Anything else — `javascript:`, `data:`,
 * `vbscript:`, an app's own protocol — runs code or leaves the browser when
 * clicked, and a click in a read-only document falls through to native
 * navigation. The static renderer draws the same line (`render/html.ts`).
 */
const SAFE_SCHEMES = new Set(["http", "https", "mailto", "tel", "sms", "ftp"]);

/**
 * Files a writer links to by name. A single segment with one of these
 * extensions is a file next to this one, `notes.md`, not a host: prefixing it
 * made `https://notes.md`. A bare domain, `atelier.dev`, still reads as a host.
 */
const FILE_EXTENSION =
	/\.(md|mdx|markdown|txt|csv|tsv|json|ya?ml|html?|pdf|png|jpe?g|gif|svg|webp|avif|mp4|webm|mov|mp3|wav)$/i;

/**
 * The scheme a browser would read from `href`, lowercased, or `null` for a
 * relative reference. Browsers drop tabs and newlines anywhere in a URL, and
 * control characters and spaces before it, so `java\tscript:` is read as
 * `javascript:`; this reads it the same way.
 */
function hrefScheme(href: string): string | null {
	let start = 0;
	while (start < href.length && href.charCodeAt(start) <= 0x20) start += 1;
	const cleaned = href.slice(start).replace(/[\t\n\r]/g, "");
	const match = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
	return match ? match[1]!.toLowerCase() : null;
}

function isControlCharacter(char: string): boolean {
	const code = char.charCodeAt(0);
	return code < 0x20 || code === 0x7f;
}

/**
 * Whether `href` may be rendered as a navigable link: a relative reference
 * (`notes.md`, `/docs`, `#intro`, `?tab=2`) or one of the safe schemes.
 */
export function isSafeHref(href: string): boolean {
	const scheme = hrefScheme(href);
	return scheme === null || SAFE_SCHEMES.has(scheme);
}

/**
 * Normalize a user-entered link target into a usable `href`.
 *
 * - Values that carry a safe scheme (`https://…`, `mailto:`, `tel:`, …) are
 *   returned untouched; any other scheme (`javascript:`, `data:`) is refused.
 * - Anchors (`#section`), queries (`?tab=2`) and relative paths (`/docs`,
 *   `./intro.md`, `../page`, `assets/clip.mp4`, `notes.md`) pass through as-is.
 * - Bare email addresses become `mailto:` links.
 * - Everything else is treated as an external link and gets an `https://` prefix.
 *
 * Returns `null` for empty or refused input so callers can bail out early.
 *
 * @example
 * normalizeUrl("superset.sh")         // "https://superset.sh"
 * normalizeUrl("hi@example.com")      // "mailto:hi@example.com"
 * normalizeUrl("/docs")               // "/docs"
 * normalizeUrl("./intro.md")          // "./intro.md"
 * normalizeUrl("javascript:alert(1)") // null
 * normalizeUrl("")                    // null
 */
export function normalizeUrl(input: string): string | null {
	const value = input.trim();
	if (!value) return null;
	// A control character in a link is never meant, and a browser drops some
	// of them before it reads the scheme.
	if ([...value].some(isControlCharacter)) return null;

	const scheme = hrefScheme(value);
	if (scheme !== null) {
		if (SAFE_SCHEMES.has(scheme)) return value;
		// `localhost:3000` reads as a scheme but is a host and a port.
		if (/^[^:/?#]+:\d+(?:[/?#]|$)/.test(value)) return `https://${value}`;
		return null;
	}
	// Anchor, query or relative path — leave the author in control
	if (
		value.startsWith("#") ||
		value.startsWith("?") ||
		value.startsWith("/") ||
		value.startsWith("./") ||
		value.startsWith("../")
	) {
		return value;
	}
	// A path into a folder of this workspace, written the way a writer writes
	// it: `assets/clip.mp4`. Its first segment is a folder name, not a host —
	// no dot in it, and a host must have one. Prefixing these made every such
	// link a bogus external URL, `https://assets/clip.mp4`, that went nowhere.
	// `example.com/docs` keeps its prefix: that first segment is a host.
	const [head, ...rest] = value.split("/");
	if (rest.length > 0 && head !== undefined && !head.includes(".")) {
		return value;
	}
	// A file next to this one, named with its extension: `notes.md`.
	if (rest.length === 0 && !value.includes("@") && FILE_EXTENSION.test(value)) {
		return value;
	}
	// Looks like a bare email address
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;

	// Default: an external link missing its protocol
	return `https://${value}`;
}
