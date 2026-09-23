import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useState } from "react";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Composer, emptyCommentDocument } from "./comment-composer";
import { CommentThread, type ThreadComment } from "./comment-thread";

function comment(
	id: string,
	author: string,
	children: unknown[],
	markDefs: unknown[] = [],
): ThreadComment {
	return {
		id,
		author_name: author,
		// Far apart, so every comment has its own header.
		lixcol_created_at: new Date(
			Date.UTC(2026, 0, 1, Number(id.replace(/\D/g, "")) || 0),
		).toISOString(),
		body: {
			_type: "zettel_doc",
			blocks: [
				{
					_type: "zettel_block",
					_key: `${id}-b`,
					style: "normal",
					markDefs,
					children,
				},
			],
		},
	};
}

const span = (key: string, text: string, marks: string[] = []) => ({
	_type: "zettel_span",
	_key: key,
	text,
	marks,
});

describe("CommentThread links", () => {
	const linked = comment(
		"c1",
		"Nils",
		[
			span("a", "web", ["l1"]),
			span("b", " "),
			span("c", "mail", ["l2"]),
			span("d", " "),
			span("e", "app", ["l3"]),
			span("f", " "),
			span("g", "anchor", ["l4"]),
		],
		[
			{ _type: "zettel_link", _key: "l1", href: "https://example.com/doc" },
			{ _type: "zettel_link", _key: "l2", href: "mailto:nils@example.com" },
			{ _type: "zettel_link", _key: "l3", href: "/files/readme.md" },
			{ _type: "zettel_link", _key: "l4", href: "#top" },
		],
	);

	test("web and mail links open in a new tab without an opener", () => {
		render(<CommentThread comments={[linked]} />);
		for (const name of ["web", "mail"]) {
			const link = screen.getByText(name).closest("a")!;
			expect(link).toHaveAttribute("target", "_blank");
			expect(link).toHaveAttribute("rel", "noopener noreferrer");
		}
	});

	test("a relative or # link is text, and clicking it does not navigate the app", () => {
		render(<CommentThread comments={[linked]} />);
		for (const name of ["app", "anchor"]) {
			const link = screen.getByText(name).closest("a")!;
			expect(link).not.toHaveAttribute("href");
			// fireEvent returns false when the default was prevented; a link
			// without href has no default, so the guard is checked with one.
			link.setAttribute("href", "/elsewhere");
			expect(fireEvent.click(link)).toBe(false);
		}
	});
});

describe("CommentThread whitespace", () => {
	test("keeps runs of spaces in the posted text", () => {
		render(
			<CommentThread
				comments={[comment("c1", "Nils", [span("a", "a  b    c")])]}
			/>,
		);
		expect(
			screen.getByText("a  b    c", { normalizer: (text) => text }),
		).toBeInTheDocument();
	});

	test("the posted body is laid out with pre-wrap, like the field", () => {
		// happy-dom does not apply the stylesheet; the rule itself is the contract.
		const css = readFileSync(join(__dirname, "comments.css"), "utf8");
		expect(css).toMatch(
			/\.comment-body \.zettel_block \{\s*white-space: pre-wrap;/,
		);
	});
});

describe("CommentThread foldWithin", () => {
	const thread = (count: number) =>
		Array.from({ length: count }, (_, index) =>
			comment(`c${index + 1}`, index % 2 ? "Nils" : "Samuel", [
				span(`s${index}`, `comment ${index + 1}`),
			]),
		);

	test("comments past the count never fold", () => {
		render(<CommentThread comments={thread(6)} foldWithin={2} />);
		const list = screen.getByRole("list", { name: "Comments" });
		expect(within(list).queryByRole("button")).toBeNull();
		expect(within(list).getByText("comment 6")).toBeInTheDocument();
		expect(within(list).getByText("comment 3")).toBeInTheDocument();
	});

	test("a thread that was long when opened folds its middle and shows what came after", () => {
		render(<CommentThread comments={thread(7)} foldWithin={5} />);
		const list = screen.getByRole("list", { name: "Comments" });
		expect(
			within(list).getByRole("button", { name: /Show 2 more comments/ }),
		).toBeInTheDocument();
		expect(within(list).queryByText("comment 2")).toBeNull();
		for (const text of [
			"comment 1",
			"comment 4",
			"comment 5",
			"comment 6",
			"comment 7",
		])
			expect(within(list).getByText(text)).toBeInTheDocument();
	});

	test("unfolding hands focus to the first comment it revealed", () => {
		render(<CommentThread comments={thread(6)} />);
		const list = screen.getByRole("list", { name: "Comments" });
		const fold = within(list).getByRole("button", {
			name: /Show 3 more comments/,
		});
		fold.focus();
		fireEvent.click(fold);
		expect(within(list).queryByRole("button")).toBeNull();
		const revealed = within(list).getByText("comment 2").closest("li");
		expect(document.activeElement).toBe(revealed);
		expect(revealed).toHaveAttribute("tabindex", "-1");
	});
});

describe("CommentThread delete", () => {
	const ME = "account-me";
	const own = (id: string, text: string): ThreadComment => ({
		...comment(id, "Peter", [span(`${id}-s`, text)]),
		author_id: ME,
	});
	const theirs = (id: string, text: string): ThreadComment => ({
		...comment(id, "Mara", [span(`${id}-s`, text)]),
		author_id: "account-mara",
	});
	const actionsIn = (text: string) =>
		within(screen.getByText(text).closest("li")!).queryByRole("button", {
			name: "Comment actions",
		});

	/** A thread and its reply field, deleting as the app would. */
	function Surface({
		initial,
		onDeleted = () => {},
	}: {
		readonly initial: readonly ThreadComment[];
		readonly onDeleted?: (comment: ThreadComment) => void;
	}) {
		const [comments, setComments] = useState(initial);
		const [draft, setDraft] = useState(emptyCommentDocument);
		return (
			<div>
				<CommentThread
					comments={comments}
					accountId={ME}
					onDelete={async (gone) => {
						onDeleted(gone);
						setComments((current) =>
							current.filter((candidate) => candidate.id !== gone.id),
						);
					}}
				/>
				<Composer
					label="Reply"
					placeholder="Reply"
					value={draft}
					onChange={setDraft}
					onSubmit={async () => {}}
				/>
			</div>
		);
	}

	/** A fresh Enter on the item: its keydown, then the click it makes. */
	async function pressEnter(item: HTMLElement, repeat = false) {
		fireEvent.keyDown(item, { key: "Enter", repeat });
		await act(async () => {
			fireEvent.click(item);
		});
	}

	async function deleteByKeyboard(text: string) {
		const trigger = actionsIn(text)!;
		act(() => trigger.focus());
		fireEvent.keyDown(trigger, { key: "ArrowDown" });
		const item = screen.getByRole("menuitem", { name: /Delete comment/ });
		expect(document.activeElement).toBe(item);
		await pressEnter(item);
	}

	test("only the reader's own comments offer Delete, and only where writing is allowed", () => {
		const comments = [theirs("c1", "Hers"), own("c2", "Mine")];
		const { rerender } = render(
			<CommentThread
				comments={comments}
				accountId={ME}
				onDelete={async () => {}}
			/>,
		);
		expect(actionsIn("Hers")).toBeNull();
		expect(actionsIn("Mine")).not.toBeNull();
		// Read-only: no onDelete.
		rerender(<CommentThread comments={comments} accountId={ME} />);
		expect(screen.queryByRole("button", { name: "Comment actions" })).toBe(
			null,
		);
		// The account not known yet.
		rerender(
			<CommentThread
				comments={comments}
				accountId={null}
				onDelete={async () => {}}
			/>,
		);
		expect(screen.queryByRole("button", { name: "Comment actions" })).toBe(
			null,
		);
	});

	test("Delete comment deletes at once, with no question in between", async () => {
		const onDelete = vi.fn(async () => {});
		render(
			<CommentThread
				comments={[own("c1", "Mine")]}
				accountId={ME}
				onDelete={onDelete}
			/>,
		);
		const trigger = actionsIn("Mine")!;
		fireEvent.click(trigger);
		expect(trigger).toHaveAttribute("aria-expanded", "true");
		const item = screen.getByRole("menuitem", { name: /Delete comment/ });
		expect(document.activeElement).toBe(item);
		fireEvent.pointerDown(item);
		await act(async () => {
			fireEvent.click(item);
		});
		expect(onDelete).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("menu")).toBeNull();
	});

	test("the Enter that opened the menu, held and repeating, does not delete", async () => {
		const onDelete = vi.fn(async () => {});
		render(
			<CommentThread
				comments={[own("c1", "Mine")]}
				accountId={ME}
				onDelete={onDelete}
			/>,
		);
		const trigger = actionsIn("Mine")!;
		act(() => trigger.focus());
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(trigger);
		const item = screen.getByRole("menuitem", { name: /Delete comment/ });
		expect(document.activeElement).toBe(item);
		// The repeat lands on the item it focused: not a press.
		expect(fireEvent.keyDown(item, { key: "Enter", repeat: true })).toBe(false);
		await act(async () => {
			fireEvent.click(item);
		});
		expect(onDelete).not.toHaveBeenCalled();
		// A fresh Enter deletes.
		await pressEnter(item);
		expect(onDelete).toHaveBeenCalledTimes(1);
	});

	test("Esc closes the menu and goes no further", () => {
		render(
			<CommentThread
				comments={[own("c1", "Mine")]}
				accountId={ME}
				onDelete={async () => {}}
			/>,
		);
		const outside = vi.fn((event: KeyboardEvent) => event.key);
		document.addEventListener("keydown", outside);
		try {
			const trigger = actionsIn("Mine")!;
			act(() => trigger.focus());
			fireEvent.keyDown(trigger, { key: "ArrowDown" });
			const menu = screen.getByRole("menu");
			const item = screen.getByRole("menuitem", { name: /Delete comment/ });
			expect(document.activeElement).toBe(item);
			// One item: the arrows keep it.
			fireEvent.keyDown(item, { key: "ArrowDown" });
			expect(document.activeElement).toBe(item);
			fireEvent.keyDown(menu, { key: "Escape" });
			expect(screen.queryByRole("menu")).toBeNull();
			expect(document.activeElement).toBe(trigger);
			// The card, the checkpoint and the review never saw it.
			expect(outside.mock.results.map((result) => result.value)).not.toContain(
				"Escape",
			);
		} finally {
			document.removeEventListener("keydown", outside);
		}
	});

	test("after a delete the keyboard goes on to the next comment", async () => {
		const onDeleted = vi.fn();
		render(
			<Surface
				initial={[own("c1", "First"), theirs("c2", "Second")]}
				onDeleted={onDeleted}
			/>,
		);
		await deleteByKeyboard("First");
		expect(onDeleted).toHaveBeenCalledWith(
			expect.objectContaining({ id: "c1" }),
		);
		expect(screen.queryByText("First")).toBeNull();
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByText("Second").closest("li"),
			),
		);
	});

	test("after deleting the last comment the keyboard goes to the reply field", async () => {
		render(<Surface initial={[theirs("c1", "Hers"), own("c2", "Mine")]} />);
		await deleteByKeyboard("Mine");
		expect(screen.queryByText("Mine")).toBeNull();
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("textbox", { name: "Reply" }),
			),
		);
	});

	test("a failed delete is said in the menu and the comment stays", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			render(
				<CommentThread
					comments={[own("c1", "Mine")]}
					accountId={ME}
					onDelete={() => Promise.reject(new Error("offline"))}
				/>,
			);
			fireEvent.click(actionsIn("Mine")!);
			await pressEnter(
				screen.getByRole("menuitem", { name: /Delete comment/ }),
			);
			expect(screen.getByRole("alert")).toHaveTextContent(
				"Could not delete the comment.",
			);
			expect(screen.getByText("Mine")).toBeInTheDocument();
		} finally {
			error.mockRestore();
		}
	});

	test("the actions are hidden at rest, so a thread looks as designed", () => {
		const css = readFileSync(join(__dirname, "comments.css"), "utf8");
		expect(css).toMatch(/\.comment-actions \{[^}]*opacity: 0;/);
		expect(css).toMatch(
			/\.comment-row:is\(:hover, :focus-within\) > \.comment-actions/,
		);
	});
});
