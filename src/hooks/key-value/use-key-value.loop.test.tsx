import React, { StrictMode, useEffect } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

const executeMock = vi.fn(async () => undefined);

vi.mock("@/lib/lix-react", () => ({
	useLix: () => ({}) as any,
	useQuery: () => [{ value: "file-initial" }],
}));

vi.mock("@/lib/lix-kysely", () => ({
	qb: () => ({
		insertInto: () => ({
			values: () => ({
				onConflict: (_fn: any) => ({
					execute: executeMock,
				}),
				execute: executeMock,
			}),
		}),
		selectFrom: () => ({
			select: () => ({
				executeTakeFirstOrThrow: async () => ({ branch_id: "global" }),
			}),
		}),
	}),
}));

import { KeyValueProvider, useKeyValue } from "./use-key-value";
import { KEY_VALUE_DEFINITIONS } from "./schema";

const branchSession = {
	getSnapshot: () => "main",
	subscribe: () => () => undefined,
	switchBranch: async () => undefined,
};

function Writer() {
	const [, setValue] = useKeyValue("atelier_test_tracked_external");
	useEffect(() => {
		void setValue("file-123" as any);
	}, [setValue]);
	return null;
}

function Reader() {
	useKeyValue("atelier_test_tracked_external");
	return null;
}

afterEach(() => {
	executeMock.mockClear();
});

test("does not hit maximum update depth when optimistic value clears across many subscribers", async () => {
	const consoleError = vi
		.spyOn(console, "error")
		.mockImplementation(() => undefined);

	render(
		<StrictMode>
			<KeyValueProvider
				defs={KEY_VALUE_DEFINITIONS as any}
				branchSession={branchSession}
			>
				<Writer />
				{Array.from({ length: 40 }, (_, i) => (
					<Reader key={`reader-${i}`} />
				))}
			</KeyValueProvider>
		</StrictMode>,
	);

	await waitFor(() => {
		expect(executeMock).toHaveBeenCalled();
	});

	await new Promise((resolve) => setTimeout(resolve, 0));

	const sawMaxDepth = consoleError.mock.calls.some((call) =>
		String(call[0]).includes("Maximum update depth exceeded"),
	);
	expect(sawMaxDepth).toBe(false);
	consoleError.mockRestore();
});
