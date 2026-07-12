import { describe, expect, test, vi } from "vitest";
import { Terminal } from "lucide-react";
import {
	hostExtensionDefinition,
	type AtelierExtensionRegistration,
} from "./host-extension";

describe("hostExtensionDefinition", () => {
	test("combines a serializable manifest with its resolved runtime", () => {
		const mount = vi.fn();
		const registration: AtelierExtensionRegistration = {
			manifest: {
				apiVersion: 1,
				id: "host_terminal",
				name: "Terminal",
				description: "Run a terminal.",
				entry: "./index.js",
				multiInstance: true,
			},
			runtime: { icon: Terminal, mount },
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
