import { expect, test } from "vitest";
import { cn } from "./utils";

test("private utility conflicts merge without consuming host classes", () => {
	expect(
		cn("atw:flex atw:px-2", "atw:grid atw:px-4", "flex px-8 host-panel"),
	).toBe("atw:grid atw:px-4 flex px-8 host-panel");
});

test("private state and arbitrary utilities retain Tailwind merge behavior", () => {
	expect(
		cn("atw:hover:bg-panel atw:w-[12px]", "atw:hover:bg-bg atw:w-[24px]"),
	).toBe("atw:hover:bg-bg atw:w-[24px]");
});

test("Atelier typography and foreground roles are independent", () => {
	expect(
		cn("atw:text-ui-sm atw:text-fg-muted", "atw:text-ui-lg atw:text-fg"),
	).toBe("atw:text-ui-lg atw:text-fg");
});
