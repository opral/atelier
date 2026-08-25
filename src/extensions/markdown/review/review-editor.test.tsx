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

	expect(
		await screen.findByRole("group", { name: "Review change 1 of 2" }),
	).toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Undo change" })).toHaveAttribute(
		"data-attr",
		"review-change-undo",
	);
	expect(screen.getByRole("button", { name: "Keep change" })).toHaveAttribute(
		"data-attr",
		"review-change-keep",
	);
	// S2: change-level verbs live inline on the change; there is no in-file
	// "Keep all" — the workspace float owns that verb.
	expect(
		screen.queryByRole("button", { name: /Keep all/ }),
	).not.toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Keep change" })).toHaveAttribute(
		"aria-keyshortcuts",
		individualShortcut(),
	);
	await waitFor(() => {
		expect(
			view!.container.querySelectorAll('[data-review-active="true"]').length,
		).toBeGreaterThan(0);
	});

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Keep change" }));
	});
	expect(
		await screen.findByRole("group", { name: "Review change 2 of 2" }),
	).toBeInTheDocument();
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

	await screen.findByRole("group", { name: "Review change 1 of 2" });
	const proseMirror = view!.container.querySelector(".ProseMirror");
	expect(proseMirror).not.toBeNull();

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Keep change" }));
	});

	expect(
		await screen.findByRole("group", { name: "Review change 2 of 2" }),
	).toBeInTheDocument();
	await waitFor(() => {
		expect(view!.container).not.toHaveTextContent("First old.");
		expect(view!.container).toHaveTextContent("First new.");
	});
	expect(view!.container.querySelector(".ProseMirror")).toBe(proseMirror);
	expect(proseMirror?.isConnected).toBe(true);

	await act(async () => view?.unmount());
});

test("does not access an owned editor after replacing its commit-scoped resource", async () => {
	lix = await openLix();
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	let view: ReturnType<typeof render> | undefined;
	const renderReview = (afterCommitId: string) => (
		<LixProvider lix={lix!}>
			<MarkdownReviewEditor
				reviewDiff={{
					beforeMarkdown: "Before.\n",
					afterMarkdown: "After.\n",
				}}
				sourceFilePath="/review.md"
				afterCommitId={afterCommitId}
				reviewEnabled
			/>
		</LixProvider>
	);

	try {
		await act(async () => {
			view = render(renderReview("commit-a"));
		});
		await screen.findByRole("group", { name: "Review change 1 of 1" });
		const firstEditor = view!.container.querySelector(".ProseMirror");
		expect(firstEditor).not.toBeNull();

		await act(async () => view!.rerender(renderReview("commit-b")));
		await waitFor(() => {
			const replacement = view!.container.querySelector(".ProseMirror");
			expect(replacement).not.toBe(firstEditor);
			expect(replacement?.isConnected).toBe(true);
		});
		expect(consoleError).not.toHaveBeenCalled();
	} finally {
		await act(async () => view?.unmount());
		consoleError.mockRestore();
	}
});

test("keeps all unresolved changes without overriding earlier decisions", async () => {
	lix = await openLix();
	const onComplete = vi.fn(async () => {});
	let view: ReturnType<typeof render> | undefined;
	await act(async () => {
		view = render(
			<LixProvider lix={lix!}>
				<MarkdownReviewEditor
					reviewDiff={{
						beforeMarkdown: "First old.\n\nSecond old.\n\nThird old.\n",
						afterMarkdown: "First new.\n\nSecond new.\n\nThird new.\n",
					}}
					sourceFilePath="/review.md"
					reviewEnabled
					onComplete={onComplete}
				/>
			</LixProvider>,
		);
	});

	await screen.findByRole("group", { name: "Review change 1 of 3" });

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Undo change" }));
	});
	expect(
		await screen.findByRole("group", { name: "Review change 2 of 3" }),
	).toBeInTheDocument();

	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Keep change" }));
	});
	await screen.findByRole("group", { name: "Review change 3 of 3" });
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Keep change" }));
	});
	await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
	expect(onComplete).toHaveBeenCalledWith(
		"First old.\n\nSecond new.\n\nThird new.\n",
	);

	await act(async () => view?.unmount());
});

test("keeps the current change with Shift+⌘⏎ and leaves plain ⌘⏎ to the float", async () => {
	lix = await openLix();
	const onComplete = vi.fn(async () => {});
	let view: ReturnType<typeof render> | undefined;
	await act(async () => {
		view = render(
			<LixProvider lix={lix!}>
				<MarkdownReviewEditor
					reviewDiff={{
						beforeMarkdown: "First old.\n\nSecond old.\n\nThird old.\n",
						afterMarkdown: "First new.\n\nSecond new.\n\nThird new.\n",
					}}
					sourceFilePath="/review.md"
					reviewEnabled
					isActive
					onComplete={onComplete}
				/>
			</LixProvider>,
		);
	});

	await screen.findByRole("group", { name: "Review change 1 of 3" });
	const input = document.createElement("input");
	document.body.append(input);
	const blockedWhileTyping = new KeyboardEvent("keydown", {
		key: "Enter",
		...primaryModifier(),
		shiftKey: true,
		bubbles: true,
		cancelable: true,
	});
	await act(async () => input.dispatchEvent(blockedWhileTyping));
	expect(blockedWhileTyping.defaultPrevented).toBe(false);
	expect(
		screen.getByRole("group", { name: "Review change 1 of 3" }),
	).toBeInTheDocument();
	input.remove();

	// Plain ⌘⏎ is the workspace float's verb (Keep all) — the review editor
	// must not swallow it.
	const floatShortcut = new KeyboardEvent("keydown", {
		key: "Enter",
		...primaryModifier(),
		bubbles: true,
		cancelable: true,
	});
	await act(async () => window.dispatchEvent(floatShortcut));
	expect(floatShortcut.defaultPrevented).toBe(false);
	expect(
		screen.getByRole("group", { name: "Review change 1 of 3" }),
	).toBeInTheDocument();
	expect(onComplete).not.toHaveBeenCalled();

	const keepCurrent = new KeyboardEvent("keydown", {
		key: "Enter",
		...primaryModifier(),
		shiftKey: true,
		bubbles: true,
		cancelable: true,
	});
	await act(async () => window.dispatchEvent(keepCurrent));
	expect(keepCurrent.defaultPrevented).toBe(true);
	expect(
		await screen.findByRole("group", { name: "Review change 2 of 3" }),
	).toBeInTheDocument();
	expect(onComplete).not.toHaveBeenCalled();

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

test("does not consume an expired external editor lease", async () => {
	lix = await openLix();
	const editor = createEditor({
		lix,
		initialMarkdown: "# Authoritative",
		additionalExtensions: MarkdownReviewExtensions,
		persistState: false,
	});
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	let view: ReturnType<typeof render> | undefined;
	const renderReview = (afterMarkdown: string) => (
		<LixProvider lix={lix!}>
			<MarkdownReviewEditor
				externalEditor={editor}
				reviewDiff={{
					beforeMarkdown: "# Authoritative",
					afterMarkdown,
				}}
				sourceFilePath="/review.md"
				reviewEnabled
			/>
		</LixProvider>
	);

	try {
		await act(async () => {
			view = render(renderReview("# Projected"));
		});
		editor.destroy();
		await act(async () => view!.rerender(renderReview("# New projection")));
		expect(consoleError).not.toHaveBeenCalled();
	} finally {
		await act(async () => view?.unmount());
		consoleError.mockRestore();
	}
});

test("applies semantic identity hints that arrive before review starts", async () => {
	lix = await openLix();
	let view: ReturnType<typeof render> | undefined;
	const beforeMarkdown = "Alpha.\n\nBeta.\n";
	const afterMarkdown = "Beta.\n\nAlpha.\n";
	const editor = createEditor({
		lix,
		initialMarkdown: beforeMarkdown,
		additionalExtensions: MarkdownReviewExtensions,
		persistState: false,
	});

	await act(async () => {
		view = render(
			<LixProvider lix={lix!}>
				<MarkdownReviewEditor
					externalEditor={editor}
					reviewDiff={{ beforeMarkdown, afterMarkdown }}
					sourceFilePath="/review.md"
					reviewEnabled
				/>
			</LixProvider>,
		);
	});
	expect(
		await screen.findByRole("group", { name: "Review change 1 of 2" }),
	).toBeInTheDocument();

	await act(async () => {
		view!.rerender(
			<LixProvider lix={lix!}>
				<MarkdownReviewEditor
					externalEditor={editor}
					reviewDiff={{
						beforeMarkdown,
						afterMarkdown,
						beforeBlocks: [
							{ id: "alpha", orderKey: "a", block: "Alpha.\n" },
							{ id: "beta", orderKey: "b", block: "Beta.\n" },
						],
						afterBlocks: [
							{ id: "beta", orderKey: "a", block: "Beta.\n" },
							{ id: "alpha", orderKey: "b", block: "Alpha.\n" },
						],
					}}
					sourceFilePath="/review.md"
					reviewEnabled
				/>
			</LixProvider>,
		);
	});

	await waitFor(() => {
		expect(
			screen.getByRole("group", { name: "Review change 1 of 1" }),
		).toBeInTheDocument();
	});
	await act(async () => view?.unmount());
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

	await screen.findByRole("group", { name: "Review change 1 of 2" });
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
	expect(
		await screen.findByRole("group", { name: "Review change 2 of 2" }),
	).toBeInTheDocument();
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

	await screen.findByRole("group", { name: "Review change 1 of 2" });
	const escape = new KeyboardEvent("keydown", {
		key: "Escape",
		bubbles: true,
		cancelable: true,
	});
	await act(async () => window.dispatchEvent(escape));
	expect(escape.defaultPrevented).toBe(false);
	expect(
		screen.getByRole("group", { name: "Review change 1 of 2" }),
	).toBeInTheDocument();

	const backspace = new KeyboardEvent("keydown", {
		key: "Backspace",
		bubbles: true,
		cancelable: true,
	});
	await act(async () => window.dispatchEvent(backspace));
	expect(backspace.defaultPrevented).toBe(true);
	expect(
		await screen.findByRole("group", { name: "Review change 2 of 2" }),
	).toBeInTheDocument();
	await waitFor(() => {
		expect(view!.container).toHaveTextContent("First old.");
		expect(view!.container).not.toHaveTextContent("First new.");
	});

	await act(async () => view?.unmount());
});

function primaryModifier(): { metaKey: true } | { ctrlKey: true } {
	return isMacTestPlatform() ? { metaKey: true } : { ctrlKey: true };
}

function individualShortcut(): "Meta+Shift+Enter" | "Control+Shift+Enter" {
	return isMacTestPlatform() ? "Meta+Shift+Enter" : "Control+Shift+Enter";
}

function isMacTestPlatform(): boolean {
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
