const textDecoder = new TextDecoder();

export function decodeFileDataToBytes(value: unknown): Uint8Array {
	if (value === null || value === undefined) return new Uint8Array();
	if (typeof value === "string") return new TextEncoder().encode(value);
	if (value instanceof Uint8Array) return value;
	return new Uint8Array();
}

export function decodeFileDataToText(value: unknown): string {
	return textDecoder.decode(decodeFileDataToBytes(value));
}
