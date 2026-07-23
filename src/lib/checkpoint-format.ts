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

export function shortCheckpointId(commitId: string): string {
	// Commit ids are UUIDv7, so nearby checkpoints often share the same prefix.
	return commitId.slice(-8);
}
