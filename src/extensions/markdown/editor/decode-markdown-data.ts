const textDecoder = new TextDecoder();

export function decodeMarkdownData(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (value instanceof Uint8Array) return textDecoder.decode(value);
	return "";
}
