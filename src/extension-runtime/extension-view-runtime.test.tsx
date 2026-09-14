import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useExtensionViewRuntime } from "./extension-view-runtime";
import type { AreaState } from "./types";
import type { Lix } from "@lix-js/sdk";
import { createExtensionHostContext } from "@/test-utils/extension-host-context";

const host = createExtensionHostContext({} as Lix);

describe("useExtensionViewRuntime", () => {
	test("includes panel, instance, and focus metadata", () => {
		const area: AreaState = {
			views: [{ instance: "files-default", kind: "atelier_files" }],
			activeInstance: "files-default",
		};
		const { result } = renderHook(useExtensionViewRuntime, {
			initialProps: {
				areaState: area,
				area: "left" as const,
				isFocused: true,
				host,
			},
		});

		const runtime = result.current.makeRuntime(area.views[0]!);
		expect(runtime.view.area).toBe("left");
		expect(runtime.view.instanceId).toBe("files-default");
		expect(runtime.view.isFocused).toBe(true);
		expect(runtime.view.isActive).toBe(true);
	});

	test("marks only the active view as active", () => {
		const area: AreaState = {
			views: [
				{ instance: "alpha", kind: "custom" },
				{ instance: "beta", kind: "custom" },
			],
			activeInstance: "alpha",
		};
		const { result, rerender } = renderHook(useExtensionViewRuntime, {
			initialProps: {
				areaState: area,
				area: "main" as const,
				isFocused: true,
				host,
			},
		});

		expect(result.current.makeRuntime(area.views[0]!).view.isActive).toBe(true);
		expect(result.current.makeRuntime(area.views[1]!).view.isActive).toBe(
			false,
		);

		rerender({
			areaState: { ...area, activeInstance: "beta" },
			area: "main" as const,
			isFocused: true,
			host,
		});
		expect(result.current.makeRuntime(area.views[0]!).view.isActive).toBe(
			false,
		);
		expect(result.current.makeRuntime(area.views[1]!).view.isActive).toBe(true);
	});

	test("exposes one effective read-only signal for historical views", () => {
		const area: AreaState = {
			views: [
				{
					instance: "live",
					kind: "atelier_file",
					state: { fileId: "live-file" },
				},
				{
					instance: "historical",
					kind: "atelier_file",
					state: {
						fileId: "historical-file",
						afterCommitId: "checkpoint-1",
						sourceCommitId: "checkpoint-1",
					},
				},
			],
			activeInstance: "historical",
		};
		const { result } = renderHook(useExtensionViewRuntime, {
			initialProps: {
				areaState: area,
				area: "main" as const,
				isFocused: true,
				host,
			},
		});

		expect(result.current.makeRuntime(area.views[0]!).atelier.readOnly).toBe(
			false,
		);
		expect(result.current.makeRuntime(area.views[1]!).atelier.readOnly).toBe(
			true,
		);
		expect(host.atelier.readOnly).toBe(false);
	});
});
