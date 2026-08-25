import { act, waitFor } from "@testing-library/react";
import { use } from "react";
import { flushSync } from "react-dom";
import { describe, expect, test, vi } from "vitest";
import { Search } from "lucide-react";
import { createReactExtensionDefinition } from "./react-extension";
import type { ExtensionRuntime, ExtensionView } from "./types";
import { useLix } from "../lib/lix-react";

const atelier = { lix: {} as ExtensionRuntime["lix"] } as ExtensionRuntime;
const view: ExtensionView = {
	instanceId: "async-view-1",
	state: {},
	panel: "left",
	isActive: true,
	isFocused: true,
	preferences: { get: () => undefined, set: () => {}, delete: () => {} },
	registerNewFileDraftHandler: () => () => {},
};

describe("createReactExtensionDefinition", () => {
	test("provides the runtime Lix to every React extension", async () => {
		let observedLix: unknown;
		function LixProbe() {
			observedLix = useLix();
			return <span>Ready</span>;
		}
		const definition = createReactExtensionDefinition({
			manifest: { apiVersion: 1, id: "lix-probe", name: "Lix probe" },
			description: "Lix context test",
			icon: Search,
			component: () => <LixProbe />,
		});
		const element = document.createElement("div");
		let mounted: ReturnType<typeof definition.mount>;
		await act(async () => {
			mounted = definition.mount({
				atelier,
				view,
				element,
				signal: new AbortController().signal,
			});
		});

		await waitFor(() => expect(element).toHaveTextContent("Ready"));
		expect(observedLix).toBe(atelier.lix);
		await act(async () => mounted?.dispose?.());
	});

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
		expect(element).toHaveTextContent("Loading Async view…");

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
