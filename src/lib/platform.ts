/**
 * True when the workspace runs on an Apple platform, so shortcut hints render
 * `⌘1` instead of `Ctrl+1`.
 *
 * @example
 * const modifier = isMacPlatform() ? "⌘" : "Ctrl";
 */
export function isMacPlatform(): boolean {
	if (typeof navigator === "undefined") return false;
	const platformCandidates = [
		((navigator as { userAgentData?: { platform?: string } }).userAgentData
			?.platform ?? null) as string | null,
		navigator.platform ?? null,
		navigator.userAgent ?? null,
	].filter(Boolean) as string[];
	return /mac|iphone|ipad|ipod/.test(
		platformCandidates.join(" ").toLowerCase(),
	);
}

/**
 * Human-readable hint for a primary-modifier shortcut (`⌘1`, `Ctrl+1`).
 *
 * @example
 * panelShortcutHint("left") // "⌘1" on macOS
 */
export function panelShortcutHint(side: "left" | "right"): string {
	const digit = side === "left" ? "1" : "2";
	return isMacPlatform() ? `⌘${digit}` : `Ctrl+${digit}`;
}

/**
 * A shortcut written the way the platform writes it. Pass the macOS spelling:
 * it is kept verbatim there, and spelled out everywhere else, where the
 * modifier names carry their own separator and the glyph's breathing space
 * around the key would read as part of it (`⌘ .` → `Ctrl+.`).
 *
 * @example
 * shortcutHint("⇧⌘.") // "Shift+Ctrl+." off macOS
 */
export function shortcutHint(keys: string): string {
	if (isMacPlatform()) return keys;
	return keys
		.replace("⇧", "Shift+")
		.replace("⌥", "Alt+")
		.replace("⌘", "Ctrl+")
		.replace("⌫", "Backspace")
		.replace("⌦", "Delete")
		.replace("⏎", "Enter")
		.replace(/\+\s+/g, "+");
}

/**
 * The same shortcut in the names `aria-keyshortcuts` is defined in terms of,
 * which assistive technology reads out as the authoritative binding. Pass the
 * macOS spelling, as with {@link shortcutHint}.
 *
 * @example
 * ariaKeyShortcut("⌘⌫") // "Meta+Backspace" on macOS, "Control+Backspace" off it
 */
export function ariaKeyShortcut(keys: string): string {
	return keys
		.replace("⇧", "Shift+")
		.replace("⌥", "Alt+")
		.replace("⌘", isMacPlatform() ? "Meta+" : "Control+")
		.replace("⌫", "Backspace")
		.replace("⌦", "Delete")
		.replace("⏎", "Enter")
		.replace(/\+\s+/g, "+");
}

/**
 * The shortcut spoken aloud, for the label on a `kbd` whose glyphs a screen
 * reader would otherwise spell out one symbol at a time.
 *
 * @example
 * spokenShortcut("⌘⌫") // "Command Backspace" on macOS, "Control Backspace" off it
 */
export function spokenShortcut(keys: string): string {
	return keys
		.replace("⇧", "Shift ")
		.replace("⌥", isMacPlatform() ? "Option " : "Alt ")
		.replace("⌘", isMacPlatform() ? "Command " : "Control ")
		.replace("⌫", "Backspace")
		.replace("⌦", "Delete")
		.replace("⏎", "Enter")
		.replace(/\s+/g, " ")
		.trim();
}
