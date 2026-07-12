import { describe, expect, test, vi } from "vitest";
import { Terminal } from "lucide-react";
import {
	hostExtensionDefinition,
	type AtelierExtensionRegistration,
} from "./host-extension";

describe("hostExtensionDefinition", () => {
	test("combines a host manifest with its already-loaded entry", () => {
		const mount = vi.fn();
		const registration: AtelierExtensionRegistration = {
			manifest: {
				apiVersion: 1,
				id: "host_terminal",
				name: "Terminal",
				description: "Run a terminal.",
				multiInstance: true,
			},
			entry: { icon: Terminal, mount },
		};

		expect(hostExtensionDefinition(registration)).toMatchObject({
			kind: "host_terminal",
			label: "Terminal",
			description: "Run a terminal.",
			icon: Terminal,
			multiInstance: true,
			mount,
		});
	});
});
