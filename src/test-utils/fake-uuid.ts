/**
 * Deterministically derives a canonical lowercase UUID from a readable label.
 *
 * Lix requires canonical UUID primary keys for files and directories, so tests
 * map their readable ids ("notes", "next-file", …) through this helper. Equal
 * labels always produce the same UUID.
 */
export function fakeUuid(label: string): string {
	const bytes = new Uint8Array(16);
	for (let round = 0; round < 4; round += 1) {
		let hash = (0x811c9dc5 ^ Math.imul(round + 1, 0x9e3779b9)) >>> 0;
		for (let index = 0; index < label.length; index += 1) {
			hash = (hash ^ label.charCodeAt(index)) >>> 0;
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		bytes[round * 4] = (hash >>> 24) & 0xff;
		bytes[round * 4 + 1] = (hash >>> 16) & 0xff;
		bytes[round * 4 + 2] = (hash >>> 8) & 0xff;
		bytes[round * 4 + 3] = hash & 0xff;
	}
	const hex = [...bytes]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
