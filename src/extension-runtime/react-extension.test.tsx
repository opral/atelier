import { act, waitFor } from "@testing-library/react";
import { use } from "react";
import { flushSync } from "react-dom";
import { describe, expect, test, vi } from "vitest";
import { Search } from "lucide-react";
import { createReactExtensionDefinition } from "./react-extension";
import type { ExtensionRuntime, ExtensionView } from "./types";

const atelier = {} as ExtensionRuntime;
const view: ExtensionView = {
	instanceId: "async-view-1",
	state: {},
	panel: "left",
	isActive: true,
	isFocused: true,
	registerNewFileDraftHandler: () => () => {},
};

describe("createReactExtensionDefinition", () => {
	test("contains suspension inside the React extension root", async () => {
		let resolve!: (value: string) => void;
		const pendingValue = new Promise<string>((next) => {
			resolve = next;
		});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		function SuspendingProbe() {
			return <span>{use(pendingValue)}</span>;
		}
		const definition = createReactExtensionDefinition({
			manifest: {
				apiVersion: 1,
				id: "async-view",
				name: "Async view",
				entry: "index.js",
			},
			description: "Suspending extension test",
			icon: Search,
			component: () => <SuspendingProbe />,
		});
		const element = document.createElement("div");
		const mounted = definition.mount({
			atelier,
			view,
			element,
			signal: new AbortController().signal,
		});

		// Extension runtime snapshots may update while an initial query is pending.
		// A boundary in this root must absorb every retry rather than escalating the
		// suspension into React's "async Client Component" failure.
		expect(() => {
			for (let index = 0; index < 110; index += 1) {
				flushSync(() => mounted?.update?.({ atelier, view }));
			}
		}).not.toThrow();
		expect(
			element.querySelector("[data-atelier-extension-suspended]"),
		).not.toBeNull();

		resolve("Ready");
		await act(async () => pendingValue);
		await waitFor(() => expect(element).toHaveTextContent("Ready"));
		expect(
			element.querySelector("[data-atelier-extension-suspended]"),
		).toBeNull();
		expect(
			consoleError.mock.calls.some((call) =>
				call.some((value) => String(value).includes("async Client Component")),
			),
		).toBe(false);

		await act(async () => mounted?.dispose?.());
		consoleError.mockRestore();
	});
});
