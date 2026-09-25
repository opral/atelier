import { afterEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CommentAvatar, profileAvatarUrl } from "./comment-avatar";

afterEach(() => vi.unstubAllGlobals());

test("reads a JSContact profile photo relative to the card URL", () => {
	expect(
		profileAvatarUrl(
			{
				"@type": "Card",
				version: "2.0",
				media: { avatar: { kind: "photo", uri: "./avatar.png" } },
			},
			"https://profiles.example/people/alex/card.json",
		),
	).toBe("https://profiles.example/people/alex/avatar.png");
	expect(
		profileAvatarUrl(
			{
				"@type": "Card",
				version: "2.0",
				media: { avatar: { kind: "photo", uri: "javascript:alert(1)" } },
			},
			"https://profiles.example/people/alex/card.json",
		),
	).toBeNull();
});

test("shows the account photo when its public profile loads", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			ok: true,
			url: "https://profiles.example/people/alex/card.json",
			json: async () => ({
				"@type": "Card",
				version: "2.0",
				media: { avatar: { kind: "photo", uri: "./avatar.png" } },
			}),
		})),
	);
	render(
		<CommentAvatar
			name="Alex"
			profileUri="https://profiles.example/people/alex/card.json"
		/>,
	);
	await waitFor(() =>
		expect(
			document.querySelector('[data-comment-avatar="profile"]'),
		).toHaveAttribute("src", "https://profiles.example/people/alex/avatar.png"),
	);
});

test("keeps initials when the account profile is unavailable", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: false })),
	);
	render(
		<CommentAvatar
			name="Alex"
			profileUri="https://profiles.example/people/alex/card.json"
		/>,
	);
	await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
	expect(screen.getByText("A")).toBeInTheDocument();
});
