import { useRef } from "react";
import type { Editor } from "@tiptap/core";
import { act, render } from "@testing-library/react";
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
