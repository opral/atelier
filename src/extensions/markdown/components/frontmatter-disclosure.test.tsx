import { useRef } from "react";
import type { Editor } from "@tiptap/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { FrontmatterDisclosure } from "./frontmatter-disclosure";

test("does not access the state or view of a destroyed editor", async () => {
	const readState = vi.fn(() => {
		throw new Error("destroyed editor state was accessed");
	});
	const readView = vi.fn(() => {
		throw new Error("destroyed editor view was accessed");
	});
	const editor = {
		isDestroyed: true,
		get state() {
			return readState();
		},
		get view() {
			return readView();
		},
		on: vi.fn(),
		off: vi.fn(),
	} as unknown as Editor;

	function Harness() {
		const surfaceRef = useRef<HTMLDivElement | null>(null);
		return (
			<div ref={surfaceRef}>
				<FrontmatterDisclosure editor={editor} surfaceRef={surfaceRef} />
			</div>
		);
	}

	await act(async () => {
		render(<Harness />);
	});

	expect(readState).not.toHaveBeenCalled();
	expect(readView).not.toHaveBeenCalled();
	expect(editor.on).toHaveBeenCalledWith("transaction", expect.any(Function));
});

test("realigns with the first block when the editor surface resizes", async () => {
	let notifyResize: ResizeObserverCallback | null = null;
	class ResizeObserverMock {
		constructor(callback: ResizeObserverCallback) {
			notifyResize = callback;
		}
		observe = vi.fn();
		disconnect = vi.fn();
		unobserve = vi.fn();
	}
	vi.stubGlobal("ResizeObserver", ResizeObserverMock);

	const editor = {
		isDestroyed: false,
		state: { doc: { firstChild: { type: { name: "heading" } } } },
		on: vi.fn(),
		off: vi.fn(),
	} as unknown as Editor;

	function Harness() {
		const surfaceRef = useRef<HTMLDivElement | null>(null);
		return (
			<div ref={surfaceRef} data-testid="surface">
				<div className="ProseMirror">
					<h1>Hello</h1>
				</div>
				<FrontmatterDisclosure editor={editor} surfaceRef={surfaceRef} />
			</div>
		);
	}

	try {
		render(<Harness />);
		const surface = screen.getByTestId("surface");
		const firstBlock = surface.querySelector("h1");
		expect(firstBlock).not.toBeNull();
		vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
			left: 20,
			top: 40,
		} as DOMRect);
		vi.spyOn(firstBlock!, "getBoundingClientRect").mockReturnValue({
			left: 280,
			top: 120,
		} as DOMRect);

		await act(async () => {
			notifyResize?.([], {} as ResizeObserver);
		});

		await waitFor(() => {
			expect(
				screen.getByRole("button", { name: "Add frontmatter" }),
			).toHaveStyle({ left: "260px", top: "46px" });
		});
	} finally {
		vi.unstubAllGlobals();
	}
});
