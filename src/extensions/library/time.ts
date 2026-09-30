/**
 * How long ago, as briefly as a card can say it: "now", "4m", "5h", "2d",
 * then the date — "Sep 20" this year, "Sep 20, 2025" before it.
 */
export function formatLibraryTime(iso: string, now = Date.now()): string {
	const time = Date.parse(iso);
	if (Number.isNaN(time)) return "";
	const minutes = Math.max(0, Math.floor((now - time) / 60_000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	const date = new Date(time);
	const sameYear = date.getFullYear() === new Date(now).getFullYear();
	return date.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		...(sameYear ? {} : { year: "numeric" }),
	});
}
