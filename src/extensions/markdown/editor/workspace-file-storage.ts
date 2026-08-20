export function createWorkspaceFileId(): string {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}
	// Lix requires canonical UUID file ids, so the fallback must keep the shape.
	const bytes = new Uint8Array(16);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Math.floor(Math.random() * 256);
	}
	bytes[6] = (bytes[6]! & 0x0f) | 0x40;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = [...bytes]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function isWorkspacePathCollision(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const candidate = error as {
		readonly code?: unknown;
		readonly name?: unknown;
		readonly message?: unknown;
	};
	return [candidate.code, candidate.name, candidate.message].some((value) =>
		String(value ?? "")
			.toUpperCase()
			.includes("LIX_ERROR_UNIQUE"),
	);
}
