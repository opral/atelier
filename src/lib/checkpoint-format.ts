const checkpointDateFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

export function formatCheckpointCreatedAt(createdAt: string): string {
	const date = new Date(createdAt);
	return Number.isNaN(date.getTime())
		? createdAt
		: checkpointDateFormatter.format(date);
}

export function formatCheckpointRelativeTime(
	createdAt: string,
	now = Date.now(),
): string {
	const date = new Date(createdAt);
	if (Number.isNaN(date.getTime())) return createdAt;
	const elapsedSeconds = Math.max(
		0,
		Math.floor((now - date.getTime()) / 1_000),
	);
	if (elapsedSeconds < 60) return "just now";
	const elapsedMinutes = Math.floor(elapsedSeconds / 60);
	if (elapsedMinutes < 60) {
		return `${elapsedMinutes} ${elapsedMinutes === 1 ? "minute" : "minutes"} ago`;
	}
	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 24) {
		return `${elapsedHours} ${elapsedHours === 1 ? "hour" : "hours"} ago`;
	}
	const elapsedDays = Math.floor(elapsedHours / 24);
	if (elapsedDays < 7) {
		return `${elapsedDays} ${elapsedDays === 1 ? "day" : "days"} ago`;
	}
	return formatCheckpointCreatedAt(createdAt);
}

export function shortCheckpointId(commitId: string): string {
	// Commit ids are UUIDv7, so nearby checkpoints often share the same prefix.
	return commitId.slice(-8);
}
