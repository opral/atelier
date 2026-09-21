import { expect, test } from "vitest";
import { ariaKeyShortcuts, formatKeyBinding } from "./shortcut-label";

test("a binding reads the way the platform writes shortcuts", () => {
	expect(formatKeyBinding("Mod-Alt-ArrowUp", true)).toBe("⌥⌘↑");
	expect(formatKeyBinding("Mod-Alt-ArrowUp", false)).toBe("Ctrl+Alt+↑");
	expect(formatKeyBinding("Mod-Alt-Shift-Backspace", true)).toBe("⌥⇧⌘⌫");
	expect(formatKeyBinding("Mod-Alt-Shift-Backspace", false)).toBe(
		"Ctrl+Alt+Shift+Backspace",
	);
	expect(formatKeyBinding("Ctrl-Shift-ArrowLeft", true)).toBe("⌃⇧←");
	expect(formatKeyBinding("Alt-Shift-ArrowRight", false)).toBe("Alt+Shift+→");
	expect(formatKeyBinding("Mod-k", false)).toBe("Ctrl+K");
});

test("a binding names its keys the way aria-keyshortcuts does", () => {
	expect(ariaKeyShortcuts("Mod-Alt-ArrowUp", true)).toBe("Meta+Alt+ArrowUp");
	expect(ariaKeyShortcuts("Mod-Alt-ArrowUp", false)).toBe(
		"Control+Alt+ArrowUp",
	);
	expect(ariaKeyShortcuts("Ctrl-Shift-ArrowLeft", true)).toBe(
		"Control+Shift+ArrowLeft",
	);
	expect(ariaKeyShortcuts("Mod-Alt-Shift-Backspace", false)).toBe(
		"Control+Alt+Shift+Backspace",
	);
	expect(ariaKeyShortcuts("Mod-k", false)).toBe("Control+K");
});
