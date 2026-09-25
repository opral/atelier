import { useEffect, useState } from "react";
import claudeAvatarUrl from "./claude-avatar.png";

function webUrl(value: unknown, base?: string): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value, base);
		return url.protocol === "https:" || url.protocol === "http:"
			? url.href
			: null;
	} catch {
		return null;
	}
}

/** `lix_account.profile_uri` points to a JSContact Card, not to the image. */
export function profileAvatarUrl(
	card: unknown,
	profileUri: string,
): string | null {
	if (!card || typeof card !== "object") return null;
	const profile = card as Record<string, unknown>;
	if (profile["@type"] !== "Card" || profile.version !== "2.0") return null;
	if (!profile.media || typeof profile.media !== "object") return null;
	const media = profile.media as Record<string, unknown>;
	const photos = [media.avatar, ...Object.values(media)].filter(
		(value): value is Record<string, unknown> =>
			!!value && typeof value === "object" && !Array.isArray(value),
	);
	const photo = photos.find((value) => value.kind === "photo");
	return webUrl(photo?.uri, profileUri);
}

/**
 * Author colours reuse the tag palette: each pair is already a tinted fill
 * with a text colour that passes on it. The name picks the pair, so one
 * author keeps one colour across threads and reloads.
 */
const AVATAR_TONES = [
	"orange",
	"pink",
	"green",
	"purple",
	"yellow",
	"blue",
	"red",
	"brown",
] as const;

export function avatarTone(name: string): (typeof AVATAR_TONES)[number] {
	let hash = 0;
	for (const character of name) {
		hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
	}
	return AVATAR_TONES[hash % AVATAR_TONES.length]!;
}

export function isClaudeAuthor(name: string | null | undefined): boolean {
	return name?.trim().toLowerCase() === "claude";
}

/**
 * An 18px initial (design 4a), 14px inside the fold row's stack, 20px in a
 * document's margin card, 22px beside a document's new comment (Turn 7) and
 * 24px in the conversation view's reading column ("2xl").
 * Claude is drawn with its mark rather than a letter.
 */
export function CommentAvatar({
	name,
	profileUri,
	size = "md",
}: {
	readonly name: string;
	readonly profileUri?: string | null;
	readonly size?: "sm" | "md" | "lg" | "xl" | "2xl";
}) {
	const [photo, setPhoto] = useState<{
		profileUri: string;
		url: string | null;
	} | null>(null);
	useEffect(() => {
		const url = webUrl(profileUri);
		if (!url) return;
		const controller = new AbortController();
		void fetch(url, { credentials: "omit", signal: controller.signal })
			.then(async (response) => {
				if (!response.ok) return null;
				return profileAvatarUrl(await response.json(), response.url);
			})
			.then((avatarUrl) => {
				if (!controller.signal.aborted)
					setPhoto({ profileUri: url, url: avatarUrl });
			})
			.catch(() => {
				if (!controller.signal.aborted)
					setPhoto({ profileUri: url, url: null });
			});
		return () => controller.abort();
	}, [profileUri]);
	const dimensions =
		size === "sm"
			? "size-3.5 text-[6px]"
			: size === "lg"
				? "size-5 text-[9px]"
				: size === "xl"
					? "size-5.5 text-[10px]"
					: size === "2xl"
						? "size-6 text-[10px]"
						: "size-4.5 text-[8px]";
	const profileUrl = webUrl(profileUri);
	if (profileUrl && photo?.profileUri === profileUrl && photo.url) {
		return (
			<img
				src={photo.url}
				alt=""
				aria-hidden="true"
				data-comment-avatar="profile"
				className={`${dimensions} shrink-0 rounded-full object-cover`}
				onError={() => setPhoto({ profileUri: profileUrl, url: null })}
			/>
		);
	}
	if (isClaudeAuthor(name)) {
		return (
			<img
				src={claudeAvatarUrl}
				alt=""
				aria-hidden="true"
				data-comment-avatar="claude"
				className={`${dimensions} shrink-0 rounded-full`}
			/>
		);
	}
	const tone = avatarTone(name);
	return (
		<span
			aria-hidden="true"
			data-comment-avatar={tone}
			className={`comment-avatar comment-avatar-${tone} flex ${dimensions} shrink-0 items-center justify-center rounded-full font-bold`}
		>
			{initial(name)}
		</span>
	);
}

function initial(name: string): string {
	const first = [...name.trim()][0];
	return first ? first.toUpperCase() : "?";
}
