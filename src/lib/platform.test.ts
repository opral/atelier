import { afterEach, describe, expect, test, vi } from "vitest";
import { isMacPlatform, panelShortcutHint, shortcutHint } from "./platform";

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
		expect(panelShortcutHint("left")).toBe("⌘1");
	});

	test("every other platform spells the modifiers out", () => {
		onPlatform("Linux x86_64");
		expect(isMacPlatform()).toBe(false);
		expect(shortcutHint("⌘.")).toBe("Ctrl+.");
		// The glyph's breathing space would read as part of the key.
		expect(shortcutHint("⌘ .")).toBe("Ctrl+.");
		expect(shortcutHint("⇧⌘ .")).toBe("Shift+Ctrl+.");
		expect(shortcutHint("⇧⌘⌫")).toBe("Shift+Ctrl+⌫");
		expect(panelShortcutHint("right")).toBe("Ctrl+2");
	});
});
