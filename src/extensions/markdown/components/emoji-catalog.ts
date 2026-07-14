export type EmojiCatalogItem = {
	emoji: string;
	name: string;
	slug: string;
	group: string;
	aliases: readonly string[];
	popularRank: number;
};

type RawEmojiData = Record<
	string,
	{
		name: string;
		slug: string;
		group: string;
	}
>;

const POPULAR_EMOJI = [
	["😀", "grinning face", "grinning_face", ["smile"]],
	["😂", "face with tears of joy", "face_with_tears_of_joy", ["joy", "lol"]],
	["❤️", "red heart", "red_heart", ["heart", "love"]],
	["👍", "thumbs up", "thumbs_up", ["thumbsup", "+1", "yes", "approve"]],
	["👎", "thumbs down", "thumbs_down", ["thumbsdown", "-1", "no"]],
	["🎉", "party popper", "party_popper", ["tada", "celebrate"]],
	["🔥", "fire", "fire", ["lit", "hot"]],
	["🚀", "rocket", "rocket", ["launch"]],
	["👀", "eyes", "eyes", ["look", "watch"]],
	["✅", "check mark button", "check_mark_button", ["check", "done"]],
	["✨", "sparkles", "sparkles", ["sparkle", "magic"]],
	["🙏", "folded hands", "folded_hands", ["pray", "thanks", "please"]],
	["💡", "light bulb", "light_bulb", ["idea"]],
	["🙌", "raising hands", "raising_hands", ["hooray"]],
	["💯", "hundred points", "hundred_points", ["100"]],
	["🤔", "thinking face", "thinking_face", ["think"]],
	[
		"😊",
		"smiling face with smiling eyes",
		"smiling_face_with_smiling_eyes",
		[],
	],
	["🥳", "partying face", "partying_face", ["party"]],
	["👏", "clapping hands", "clapping_hands", ["clap"]],
	["💪", "flexed biceps", "flexed_biceps", ["strong"]],
	["🤝", "handshake", "handshake", ["deal"]],
	["📌", "pushpin", "pushpin", ["pin"]],
	["⚠️", "warning", "warning", ["alert"]],
	["❌", "cross mark", "cross_mark", ["x", "cancel"]],
] as const;

const aliasesByEmoji = new Map<string, readonly string[]>(
	POPULAR_EMOJI.map(([emoji, , , aliases]) => [emoji, aliases]),
);
const popularRankByEmoji = new Map<string, number>(
	POPULAR_EMOJI.map(([emoji], index) => [emoji, index]),
);

export const popularEmojiCatalog: readonly EmojiCatalogItem[] =
	POPULAR_EMOJI.map(([emoji, name, slug, aliases], popularRank) => ({
		emoji,
		name,
		slug,
		group: "Popular",
		aliases,
		popularRank,
	}));

let catalogPromise: Promise<readonly EmojiCatalogItem[]> | null = null;

export function loadEmojiCatalog(): Promise<readonly EmojiCatalogItem[]> {
	if (catalogPromise) return catalogPromise;
	catalogPromise = import("unicode-emoji-json/data-by-emoji.json").then(
		(module) =>
			Object.entries(module.default as RawEmojiData).map(
				([emoji, value]): EmojiCatalogItem => ({
					emoji,
					name: value.name,
					slug: value.slug,
					group: value.group,
					aliases: aliasesByEmoji.get(emoji) ?? [],
					popularRank: popularRankByEmoji.get(emoji) ?? Number.MAX_SAFE_INTEGER,
				}),
			),
	);
	return catalogPromise;
}

function normalized(value: string): string {
	return value.toLocaleLowerCase().replaceAll("-", "_");
}

function matchScore(item: EmojiCatalogItem, query: string): number | null {
	const slug = normalized(item.slug);
	const name = normalized(item.name);
	const aliases = item.aliases.map(normalized);
	if (slug === query || aliases.includes(query)) return 0;
	if (
		slug.startsWith(query) ||
		aliases.some((alias) => alias.startsWith(query))
	) {
		return 1;
	}
	if (name.startsWith(query)) return 2;
	if (
		name.split(/[ _]/).some((word) => word.startsWith(query)) ||
		slug.split("_").some((word) => word.startsWith(query))
	) {
		return 3;
	}
	if (
		name.includes(query) ||
		slug.includes(query) ||
		aliases.some((alias) => alias.includes(query))
	) {
		return 4;
	}
	return null;
}

export function filterEmojiCatalog(
	catalog: readonly EmojiCatalogItem[],
	query: string,
	limit = 8,
): EmojiCatalogItem[] {
	const normalizedQuery = normalized(query.trim().replace(/^:|:$/g, ""));
	if (!normalizedQuery) {
		return [...catalog]
			.sort((a, b) => a.popularRank - b.popularRank)
			.slice(0, limit);
	}

	return catalog
		.map((item) => ({ item, score: matchScore(item, normalizedQuery) }))
		.filter(
			(entry): entry is { item: EmojiCatalogItem; score: number } =>
				entry.score !== null,
		)
		.sort(
			(a, b) =>
				a.score - b.score ||
				a.item.popularRank - b.item.popularRank ||
				a.item.name.localeCompare(b.item.name),
		)
		.slice(0, limit)
		.map(({ item }) => item);
}
