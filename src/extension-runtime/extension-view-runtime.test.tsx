import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useExtensionViewRuntime } from "./extension-view-runtime";
import type { PanelState } from "./types";
import type { Lix } from "@lix-js/sdk";
import { createExtensionHostContext } from "@/test-utils/extension-host-context";

const host = createExtensionHostContext({} as Lix);

describe("useExtensionViewRuntime", () => {
	test("includes panel, instance, and focus metadata", () => {
		const panel: PanelState = {
			views: [{ instance: "files-default", kind: "atelier_files" }],
			activeInstance: "files-default",
		};
		const { result } = renderHook(useExtensionViewRuntime, {
			initialProps: {
				panel,
				panelSide: "left" as const,
				isFocused: true,
				host,
			},
		});

		const runtime = result.current.makeRuntime(panel.views[0]!);
		expect(runtime.view.panel).toBe("left");
		expect(runtime.view.instanceId).toBe("files-default");
		expect(runtime.view.isFocused).toBe(true);
		expect(runtime.view.isActive).toBe(true);
	});

	test("marks only the active view as active", () => {
		const panel: PanelState = {
			views: [
				{ instance: "alpha", kind: "custom" },
				{ instance: "beta", kind: "custom" },
			],
			activeInstance: "alpha",
		};
		const { result, rerender } = renderHook(useExtensionViewRuntime, {
			initialProps: {
				panel,
				panelSide: "central" as const,
				isFocused: true,
				host,
			},
		});

		expect(result.current.makeRuntime(panel.views[0]!).view.isActive).toBe(
			true,
		);
		expect(result.current.makeRuntime(panel.views[1]!).view.isActive).toBe(
			false,
		);

		rerender({
			panel: { ...panel, activeInstance: "beta" },
			panelSide: "central" as const,
			isFocused: true,
			host,
		});
		expect(result.current.makeRuntime(panel.views[0]!).view.isActive).toBe(
			false,
		);
		expect(result.current.makeRuntime(panel.views[1]!).view.isActive).toBe(
			true,
		);
	});
});
