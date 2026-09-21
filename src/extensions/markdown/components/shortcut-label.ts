import { isMacPlatform } from "@/lib/platform";

const MAC_MODIFIERS: Record<string, string> = {
	Ctrl: "⌃",
	Alt: "⌥",
	Shift: "⇧",
	Mod: "⌘",
	Cmd: "⌘",
	Meta: "⌘",
};

const OTHER_MODIFIERS: Record<string, string> = {
	Ctrl: "Ctrl",
	Alt: "Alt",
	Shift: "Shift",
	Mod: "Ctrl",
	Cmd: "Ctrl",
	Meta: "Win",
};

// Apple's order for modifier symbols, and the usual one elsewhere.
const MAC_ORDER = ["⌃", "⌥", "⇧", "⌘"];
const OTHER_ORDER = ["Ctrl", "Win", "Alt", "Shift"];

const KEYS: Record<string, [mac: string, other: string]> = {
	ArrowUp: ["↑", "↑"],
	ArrowDown: ["↓", "↓"],
	ArrowLeft: ["←", "←"],
	ArrowRight: ["→", "→"],
	Backspace: ["⌫", "Backspace"],
	Delete: ["⌦", "Delete"],
	Enter: ["↩", "Enter"],
	Escape: ["⎋", "Esc"],
};

/**
 * A ProseMirror key binding as the platform writes it: `⌘⌥↑` on Apple
 * platforms, `Ctrl+Alt+↑` elsewhere.
 *
 * @example
 * formatKeyBinding("Mod-Alt-Shift-Backspace") // "⌥⇧⌘⌫" on macOS
 */
export function formatKeyBinding(
	binding: string,
	mac: boolean = isMacPlatform(),
): string {
	const parts = binding.split("-");
	const key = parts.pop() ?? "";
	const names = mac ? MAC_MODIFIERS : OTHER_MODIFIERS;
	const order = mac ? MAC_ORDER : OTHER_ORDER;
	const modifiers = parts
		.map((part) => names[part] ?? part)
		.sort((a, b) => order.indexOf(a) - order.indexOf(b));
	const label =
		KEYS[key]?.[mac ? 0 : 1] ?? (key.length === 1 ? key.toUpperCase() : key);
	return mac ? [...modifiers, label].join("") : [...modifiers, label].join("+");
}
