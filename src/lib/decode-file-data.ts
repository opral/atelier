/**
 * Reading a Lix file's bytes as text, and being explicit about the answer.
 *
 * "Is this text?" had four implementations across two repositories, and one
 * of them decoded leniently — so a PNG at a `.csv` path came back as a screen
 * of replacement characters where the others refused it. There is one strict
 * reader here and one lossy one, and the lossy one says so in its name.
 */

const lossyDecoder = new TextDecoder();

export function decodeFileDataToBytes(value: unknown): Uint8Array {
	if (value === null || value === undefined) return new Uint8Array();
	if (typeof value === "string") return new TextEncoder().encode(value);
	if (value instanceof Uint8Array) return value;
	return new Uint8Array();
}

/**
 * The file's text, or null when the bytes are not UTF-8.
 *
 * Use this anywhere refusing is an option — a view that can say "no preview"
 * rather than draw nonsense.
 */
export function fileText(value: unknown): string | null {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(
			decodeFileDataToBytes(value),
		);
	} catch {
		return null;
	}
}

/**
 * The file's text, with invalid bytes replaced rather than refused.
 *
 * For paths already committed to showing something — an open editor whose
 * document is mid-edit. Everything that can decline should call
 * {@link fileText} instead.
 */
export function decodeFileDataToText(value: unknown): string {
	return lossyDecoder.decode(decodeFileDataToBytes(value));
}
