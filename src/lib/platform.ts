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
