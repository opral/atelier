import { describe, expect, test } from "vitest";
import { createAtelierKeyValueDefinitions } from "./create-atelier";

describe("createAtelierKeyValueDefinitions", () => {
	test("uses host side-panel defaults when no persisted UI state exists", () => {
		const defs = createAtelierKeyValueDefinitions(["right"]);

		expect(defs.atelier_ui_state.defaultValue.layout?.sizes).toEqual({
			left: 0,
			central: 80,
			right: 20,
		});
	});
});
