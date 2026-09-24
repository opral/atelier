import claudeAvatarUrl from "./claude-avatar.png";

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
	size = "md",
}: {
	readonly name: string;
	readonly size?: "sm" | "md" | "lg" | "xl" | "2xl";
}) {
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
