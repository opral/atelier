import type { Lix } from "@lix-js/sdk";
import { act, render, waitFor } from "@testing-library/react";
import { Search } from "lucide-react";
import { useEffect } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createExtensionHostContext } from "@/test-utils/extension-host-context";
import {
	ExtensionHostRegistryProvider,
	useExtensionHostRegistry,
} from "./extension-host-registry";
import type {
	ExtensionDefinition,
	ExtensionInstance,
	ExtensionView,
} from "./types";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("ExtensionHostRegistryProvider", () => {
	test("defers disposal when a host is pruned during a parent update", async () => {
		const queuedMicrotasks: VoidFunction[] = [];
		vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => {
			queuedMicrotasks.push(callback);
		});
		const dispose = vi.fn();
		const mount = vi.fn(() => ({ dispose }));
		const definition: ExtensionDefinition = {
			kind: "test",
			label: "Test",
			description: "Test extension",
			icon: Search,
			mount,
		};
		const instance: ExtensionInstance = {
			instance: "test-1",
			kind: definition.kind,
		};
		const extensionView: ExtensionView = {
			instanceId: instance.instance,
			state: {},
			panel: "central",
			isActive: true,
			isFocused: true,
			registerNewFileDraftHandler: () => () => {},
		};
		const atelier = createExtensionHostContext({} as Lix).atelier;

		function Probe({ active }: { readonly active: boolean }) {
			const registry = useExtensionHostRegistry();
			useEffect(() => {
				if (active) {
					registry.ensureHost({
						instance,
						view: definition,
						atelier,
						extensionView,
					});
					return;
				}
				registry.pruneHosts(new Set());
			}, [active, registry]);
			return null;
		}

		const rendered = render(
			<ExtensionHostRegistryProvider>
				<Probe active />
			</ExtensionHostRegistryProvider>,
		);
		await waitFor(() => expect(mount).toHaveBeenCalledOnce());
		rendered.rerender(
			<ExtensionHostRegistryProvider>
				<Probe active={false} />
			</ExtensionHostRegistryProvider>,
		);
		await waitFor(() => expect(queuedMicrotasks).toHaveLength(1));

		expect(dispose).not.toHaveBeenCalled();
		await act(async () => queuedMicrotasks[0]?.());
		expect(dispose).toHaveBeenCalledOnce();
		rendered.unmount();
	});

	test("defers nested root disposal until the parent unmount commit finishes", async () => {
		const queuedMicrotasks: VoidFunction[] = [];
		vi.spyOn(globalThis, "queueMicrotask").mockImplementation((callback) => {
			queuedMicrotasks.push(callback);
		});
		const dispose = vi.fn();
		const mount = vi.fn(() => ({ dispose }));
		const definition: ExtensionDefinition = {
			kind: "test",
			label: "Test",
			description: "Test extension",
			icon: Search,
			mount,
		};
		const instance: ExtensionInstance = {
			instance: "test-1",
			kind: definition.kind,
		};
		const extensionView: ExtensionView = {
			instanceId: instance.instance,
			state: {},
			panel: "central",
			isActive: true,
			isFocused: true,
			registerNewFileDraftHandler: () => () => {},
		};
		const atelier = createExtensionHostContext({} as Lix).atelier;

		function Probe() {
			const registry = useExtensionHostRegistry();
			useEffect(() => {
				registry.ensureHost({
					instance,
					view: definition,
					atelier,
					extensionView,
				});
			}, [registry]);
			return null;
		}

		const rendered = render(
			<ExtensionHostRegistryProvider>
				<Probe />
			</ExtensionHostRegistryProvider>,
		);
		await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));

		rendered.unmount();

		expect(dispose).not.toHaveBeenCalled();
		expect(queuedMicrotasks).toHaveLength(1);
		await act(async () => queuedMicrotasks[0]?.());
		expect(dispose).toHaveBeenCalledTimes(1);
	});
});
