import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { createEditor } from "../editor/create-editor";
import { MarkdownReviewEditor } from "./review-editor";
import { MarkdownReviewExtensions } from "./review-extension";

let lix: Lix | null = null;

afterEach(async () => {
	await lix?.close();
	lix = null;
});

test("reviews entity groups one at a time and completes with exact mixed Markdown", async () => {
	lix = await openLix();
	const onComplete = vi.fn(async () => {});
	const before = "First old.\n\nSecond old.\n";
	const after = "First new.\n\nSecond new.\n";
	let view: ReturnType<typeof render> | undefined;

	await act(async () => {
		view = render(
			<LixProvider lix={lix!}>
				<MarkdownReviewEditor
					reviewDiff={{ beforeMarkdown: before, afterMarkdown: after }}
					sourceFilePath="/review.md"
					reviewEnabled
					isActive
					onComplete={onComplete}
				/>
			</LixProvider>,
		);
	});

	expect(await screen.findByText("1 of 2")).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Undo change" })).toHaveAttribute(
		"data-attr",
		"review-change-undo",
	);
	expect(screen.getByRole("button", { name: "Keep change" })).toHaveAttribute(
		"data-attr",
		"review-change-keep",
	);
	await waitFor(() => {
		expect(
			view!.container.querySelectorAll('[data-review-active="true"]').length,
		).toBeGreaterThan(0);
	});

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Keep change" }));
	});
	expect(await screen.findByText("2 of 2")).toBeInTheDocument();
	expect(screen.getByTestId("markdown-review-editor")).toHaveAttribute(
		"data-review-resolved-count",
		"1",
	);
	await waitFor(() => {
		expect(view!.container).not.toHaveTextContent("First old.");
		expect(view!.container).toHaveTextContent("First new.");
	});

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Undo change" }));
	});
	await waitFor(() => {
		expect(onComplete).toHaveBeenCalledTimes(1);
	});
	expect(onComplete).toHaveBeenCalledWith("First new.\n\nSecond old.\n");

	await act(async () => view?.unmount());
});

test("keeps the same Tiptap editor mounted after a partial decision", async () => {
	lix = await openLix();
	let view: ReturnType<typeof render> | undefined;
	await act(async () => {
		view = render(
			<LixProvider lix={lix!}>
				<MarkdownReviewEditor
					reviewDiff={{
						beforeMarkdown: "First old.\n\nSecond old.\n",
						afterMarkdown: "First new.\n\nSecond new.\n",
					}}
					sourceFilePath="/review.md"
					reviewEnabled
				/>
			</LixProvider>,
		);
	});

	await screen.findByText("1 of 2");
	const proseMirror = view!.container.querySelector(".ProseMirror");
	expect(proseMirror).not.toBeNull();

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Keep change" }));
	});

	expect(await screen.findByText("2 of 2")).toBeInTheDocument();
	await waitFor(() => {
		expect(view!.container).not.toHaveTextContent("First old.");
		expect(view!.container).toHaveTextContent("First new.");
	});
	expect(view!.container.querySelector(".ProseMirror")).toBe(proseMirror);
	expect(proseMirror?.isConnected).toBe(true);

	await act(async () => view?.unmount());
});

test("restores an external editor when review projection unmounts", async () => {
	lix = await openLix();
	const editor = createEditor({
		lix,
		initialMarkdown: "# Authoritative",
		additionalExtensions: MarkdownReviewExtensions,
		persistState: false,
	});
	let view: ReturnType<typeof render> | undefined;

	await act(async () => {
		view = render(
			<LixProvider lix={lix!}>
				<MarkdownReviewEditor
					externalEditor={editor}
					reviewDiff={{
						beforeMarkdown: "# Authoritative",
						afterMarkdown: "# Projected",
					}}
					sourceFilePath="/review.md"
					reviewEnabled
				/>
			</LixProvider>,
		);
	});

	expect(editor.getText()).toContain("Projected");
	await act(async () => view?.unmount());
	expect(editor.getText()).toBe("Authoritative");
	editor.destroy();
});

test("clicking any marked fragment selects its whole change group", async () => {
	lix = await openLix();
	let view: ReturnType<typeof render> | undefined;
	await act(async () => {
		view = render(
			<LixProvider lix={lix!}>
				<MarkdownReviewEditor
					reviewDiff={{
						beforeMarkdown: "First old.\n\nSecond old.\n",
						afterMarkdown: "First new.\n\nSecond new.\n",
					}}
					sourceFilePath="/review.md"
					reviewEnabled
				/>
			</LixProvider>,
		);
	});

	await screen.findByText("1 of 2");
	const marked = Array.from(
		view!.container.querySelectorAll<HTMLElement>("[data-review-change-id]"),
	);
	const changeIds = [
		...new Set(marked.map((element) => element.dataset.reviewChangeId)),
	].filter((value): value is string => typeof value === "string");
	const secondChangeId = changeIds[1];
	expect(secondChangeId).toBeDefined();
	const secondFragment = marked.find(
		(element) => element.dataset.reviewChangeId === secondChangeId,
	)!;

	await act(async () => fireEvent.click(secondFragment));
	expect(await screen.findByText("2 of 2")).toBeInTheDocument();
	await waitFor(() => {
		const active = Array.from(
			view!.container.querySelectorAll<HTMLElement>(
				'[data-review-active="true"]',
			),
		);
		expect(active.length).toBeGreaterThan(0);
		expect(
			active.every(
				(element) => element.dataset.reviewChangeId === secondChangeId,
			),
		).toBe(true);
	});

	await act(async () => view?.unmount());
});

test("uses Backspace rather than Escape to undo the active change", async () => {
	lix = await openLix();
	let view: ReturnType<typeof render> | undefined;
	await act(async () => {
		view = render(
			<LixProvider lix={lix!}>
				<MarkdownReviewEditor
					reviewDiff={{
						beforeMarkdown: "First old.\n\nSecond old.\n",
						afterMarkdown: "First new.\n\nSecond new.\n",
					}}
					sourceFilePath="/docs/review.md"
					reviewEnabled
					isActive
				/>
			</LixProvider>,
		);
	});

	await screen.findByText("1 of 2");
	const escape = new KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	await act(async () => window.dispatchEvent(escape));
	expect(escape.defaultPrevented).toBe(false);
	expect(screen.getByText("1 of 2")).toBeInTheDocument();

	const backspace = new KeyboardEvent("keydown", {
		key: "Backspace",
		bubbles: true,
		cancelable: true,
	});
	await act(async () => window.dispatchEvent(backspace));
	expect(backspace.defaultPrevented).toBe(true);
	expect(await screen.findByText("2 of 2")).toBeInTheDocument();
	await waitFor(() => {
		expect(view!.container).toHaveTextContent("First old.");
		expect(view!.container).not.toHaveTextContent("First new.");
	});

	await act(async () => view?.unmount());
});
