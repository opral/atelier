import { render, act } from "@testing-library/react";
import { StrictMode } from "react";
import { expect, test, vi } from "vitest";
import type { Lix } from "@lix-js/sdk";
import { Atelier, type AtelierHandle } from "./create-atelier";
vi.mock("./shell/layout-shell", () => ({
	V2LayoutShell: () => <main>Pending view</main>,
}));
const branchSession = { getSnapshot: () => null, subscribe: () => () => {} };

test("unmount rejects commands queued before shell binding and later stale-handle calls", async () => {
	let handle!: AtelierHandle;
	const close = vi.fn();
	const view = render(
		<Atelier
			lix={{ close } as unknown as Lix}
			branchSession={branchSession}
			onReady={(value) => {
				if (value) handle = value;
			}}
		/>,
	);
	const pending = handle.documents.open("/pending.md");
	const result = expect(pending).rejects.toMatchObject({ name: "AbortError" });
	view.unmount();
	await result;
	await expect(handle.views.open("home")).rejects.toMatchObject({
		name: "AbortError",
	});
	expect(close).not.toHaveBeenCalled();
});

test("StrictMode effect reconnect does not dispose the mounted runtime", async () => {
	let handle!: AtelierHandle;
	const view = render(
		<StrictMode>
			<Atelier
				lix={{} as Lix}
				branchSession={branchSession}
				onReady={(value) => {
					if (value) handle = value;
				}}
			/>
		</StrictMode>,
	);
	await act(async () => {
		await Promise.resolve();
	});
	const rejected = vi.fn();
	const pending = handle.documents.open("/pending.md").catch(rejected);
	await act(async () => {
		await Promise.resolve();
	});
	expect(rejected).not.toHaveBeenCalled();
	view.unmount();
	await pending;
	expect(rejected).toHaveBeenCalledWith(
		expect.objectContaining({ name: "AbortError" }),
	);
});

test("disposing the runtime rejects an active unresolved command", async () => {
	const { createAtelier, bindAtelierDocumentsRuntime, disposeAtelierRuntime } =
		await import("./atelier-instance");
	const instance = createAtelier({ lix: {} as Lix, branchSession });
	const open = vi.fn(() => new Promise<void>(() => {}));
	bindAtelierDocumentsRuntime(
		instance,
		{
			open,
			startNew: () => {},
			closeActive: () => {},
			close: () => {},
			closeAll: () => {},
			openView: () => {},
		},
		{ activePath: null, openPaths: [], activeViewInstance: null },
	);
	const pending = instance.documents.open("/pending.md");
	const result = expect(pending).rejects.toMatchObject({ name: "AbortError" });
	expect(open).toHaveBeenCalled();
	disposeAtelierRuntime(instance);
	await result;
});
