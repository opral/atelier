import { describe, expect, test, vi } from "vitest";
import { Terminal } from "lucide-react";
import type { AtelierExtensionRegistration } from "../extension-api";
import { hostExtensionDefinition } from "./host-extension";

describe("hostExtensionDefinition", () => {
	test("normalizes a declarative host extension", () => {
		const Component = vi.fn(() => null);
		const menuItems = vi.fn(() => []);
		const registration: AtelierExtensionRegistration = {
			id: "host_terminal",
			name: "Terminal",
			description: "Run a terminal.",
			multiInstance: true,
			icon: Terminal,
			menuItems,
			Component,
		};

		expect(hostExtensionDefinition(registration)).toMatchObject({
			kind: "host_terminal",
			label: "Terminal",
			description: "Run a terminal.",
			icon: Terminal,
			multiInstance: true,
			menuItems,
			Component,
		});
	});
});
