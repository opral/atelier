import { afterEach, describe, expect, test, vi } from "vitest";
import {
	ariaKeyShortcut,
	isMacPlatform,
	panelShortcutHint,
	shortcutHint,
	spokenShortcut,
} from "./platform";

const onPlatform = (platform: string) => {
	vi.stubGlobal("navigator", {
		platform,
		userAgent: platform,
		userAgentData: { platform },
	});
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("shortcut hints", () => {
	test("macOS keeps the glyphs it was written with", () => {
		onPlatform("MacIntel");
		expect(isMacPlatform()).toBe(true);
		expect(shortcutHint("⌘.")).toBe("⌘.");
		expect(shortcutHint("⌘ .")).toBe("⌘ .");
		expect(shortcutHint("⇧⌘ .")).toBe("⇧⌘ .");
		expect(shortcutHint("⌘⌫")).toBe("⌘⌫");
		expect(shortcutHint("⇧⌘⏎")).toBe("⇧⌘⏎");
		expect(panelShortcutHint("left")).toBe("⌘1");
		expect(ariaKeyShortcut("⌘⌫")).toBe("Meta+Backspace");
		expect(spokenShortcut("⌘⌫")).toBe("Command Backspace");
	});

	test("every other platform spells the modifiers out", () => {
		onPlatform("Linux x86_64");
		expect(isMacPlatform()).toBe(false);
		expect(shortcutHint("⌘.")).toBe("Ctrl+.");
		// The glyph's breathing space would read as part of the key.
		expect(shortcutHint("⌘ .")).toBe("Ctrl+.");
		expect(shortcutHint("⇧⌘ .")).toBe("Shift+Ctrl+.");
		// A key with a glyph of its own is spelled out too: "Ctrl+⌫" names a
		// modifier this platform has and a key it does not write that way.
		expect(shortcutHint("⇧⌘⌫")).toBe("Shift+Ctrl+Backspace");
		expect(shortcutHint("⌘⌫")).toBe("Ctrl+Backspace");
		// The review float writes Checkpoint's chord with this one.
		expect(shortcutHint("⇧⌘⏎")).toBe("Shift+Ctrl+Enter");
		expect(panelShortcutHint("right")).toBe("Ctrl+2");
		// aria-keyshortcuts is read out as the authoritative binding, so it
		// names the modifier this platform's handler actually gates on.
		expect(ariaKeyShortcut("⌘⌫")).toBe("Control+Backspace");
		expect(spokenShortcut("⌘⌫")).toBe("Control Backspace");
	});
});
