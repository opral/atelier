import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";
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
});
