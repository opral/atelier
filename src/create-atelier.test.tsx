import type { Lix } from "@lix-js/sdk";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const rootMocks = vi.hoisted(() => ({
	createRoot: vi.fn(),
	render: vi.fn(),
	unmount: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
	createRoot: rootMocks.createRoot,
}));

import {
	Atelier,
	createAtelier,
	type AtelierProps,
	type AtelierSlots,
} from "./create-atelier";

describe("createAtelier", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rootMocks.createRoot.mockReturnValue({
			render: rootMocks.render,
			unmount: rootMocks.unmount,
		});
	});

	test("mounts the React component with host slots", () => {
		const element = document.createElement("div");
		const lix = {} as Lix;
		const slots: AtelierSlots = {
			navbarStart: <a href="/">Host home</a>,
			navbarEnd: ({ currentFile }) => currentFile,
		};

		createAtelier({ element, lix, slots });

		expect(rootMocks.createRoot).toHaveBeenCalledWith(element);
		const rendered = rootMocks.render.mock
			.calls[0]?.[0] as ReactElement<AtelierProps>;
		expect(rendered.type).toBe(Atelier);
		expect(rendered.props).toEqual({ lix, slots });
	});

	test("returns an idempotent dispose handle", () => {
		const handle = createAtelier({
			element: document.createElement("div"),
			lix: {} as Lix,
		});

		handle.dispose();
		handle.dispose();

		expect(rootMocks.unmount).toHaveBeenCalledTimes(1);
	});

	test("rejects a missing mount element", () => {
		expect(() =>
			createAtelier({
				element: null as unknown as HTMLElement,
				lix: {} as Lix,
			}),
		).toThrowError("createAtelier() requires an HTMLElement");
	});
});
