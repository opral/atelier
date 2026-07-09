import { describe, expect, test } from "vitest";
import {
	decodeFileDataToBytes,
	decodeFileDataToText,
} from "./decode-file-data";

describe("decode file data", () => {
	test("decodes current SDK blob values", () => {
		const data = new Uint8Array([72, 101, 108, 108, 111, 10]);

		expect(Array.from(decodeFileDataToBytes(data))).toEqual([
			72, 101, 108, 108, 111, 10,
		]);
		expect(decodeFileDataToText(data)).toBe("Hello\n");
	});

	test("decodes current SDK text values", () => {
		expect(decodeFileDataToText("Hi")).toBe("Hi");
	});
});
