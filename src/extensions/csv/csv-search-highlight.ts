/** Literal, case-insensitive matches with offsets into the original display text. */
export function csvSearchMatches(
	text: string,
	query: string,
): { start: number; end: number }[] {
	if (!query) return [];
	const pattern = new RegExp(
		query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		"gi",
	);
	return Array.from(text.matchAll(pattern), (match) => ({
		start: match.index,
		end: match.index + match[0].length,
	}));
}

/** Draw behind glyphs, preserving the grid renderer's canvas state. */
export function drawCsvSearchHighlights(
	ctx: CanvasRenderingContext2D,
	text: string,
	query: string,
	x: number,
	y: number,
	maxWidth: number,
	height = 18,
	color = "#fef08a",
) {
	if (!query || maxWidth <= 0) return;
	const matches = csvSearchMatches(text, query);
	if (!matches.length) return;
	ctx.save();
	ctx.beginPath();
	ctx.rect(x, y - height / 2, maxWidth, height);
	ctx.clip();
	ctx.fillStyle = color;
	for (const match of matches) {
		const left = ctx.measureText(text.slice(0, match.start)).width;
		const right = ctx.measureText(text.slice(0, match.end)).width;
		if (left >= maxWidth) break;
		ctx.fillRect(x + left, y - height / 2, right - left, height);
	}
	ctx.restore();
}
