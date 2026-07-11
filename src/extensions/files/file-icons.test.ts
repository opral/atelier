import { describe, expect, it } from "vitest";
import {
	FILE_ICON_GROUPS,
	fileGenericIconUrl,
	fileIconUrl,
} from "./file-icons";

describe("fileIconUrl", () => {
	it.each(
		FILE_ICON_GROUPS.flatMap(({ extensions, iconUrl }) =>
			extensions.map((extension) => [extension, iconUrl] as const),
		),
	)("uses the matching colored icon for .%s", (extension, iconUrl) => {
		expect(fileIconUrl(`/file.${extension}`)).toBe(iconUrl);
	});

	it("matches extensions case-insensitively", () => {
		expect(fileIconUrl("/config.JSONC")).toBe(fileIconUrl("/config.jsonc"));
	});

	it("uses a colored generic icon for unknown file types", () => {
		expect(fileIconUrl("/archive.custom")).toBe(fileGenericIconUrl);
	});
});
