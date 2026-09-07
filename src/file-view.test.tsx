import { act, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, test, vi } from "vitest";
import { File } from "lucide-react";
import { Atelier, type AtelierShellHandle } from "./atelier";
import { openLix } from "./test-utils/node-lix-sdk";
import type { AtelierExtensionRegistration } from "./extension-api";

describe("composable Atelier", () => {
	test("standalone and shell use the same read-only Markdown renderer without changing the file", async () => {
		const lix = await openLix();
		const content = new TextEncoder().encode(
			"# Published heading\n\nA **formatted** paragraph.",
		);
		const result = await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ($1, $2) RETURNING id",
			["/readme.md", content],
		);
		const fileId = result.rows[0]!.id as string;
		let view: ReturnType<typeof render> | undefined;
		try {
			view = render(<Atelier.FileView lix={lix} fileId={fileId} readOnly />);
			expect(
				await screen.findByRole("heading", { name: "Published heading" }),
			).toBeVisible();
			expect(screen.getByText("formatted").tagName).toBe("STRONG");
			expect(view.container.querySelector(".ProseMirror")).toHaveAttribute(
				"contenteditable",
				"false",
			);
			await act(async () => view?.unmount());
			const ref = createRef<AtelierShellHandle>();
			view = render(<Atelier.Shell lix={lix} readOnly ref={ref} />);
			await waitFor(() => expect(ref.current).not.toBeNull());
			await act(async () => {
				await ref.current!.documents.open("/readme.md");
			});
			expect(
				await screen.findByRole("heading", { name: "Published heading" }),
			).toBeVisible();
			expect(screen.getByText("formatted").tagName).toBe("STRONG");
			expect(view.container.querySelector(".ProseMirror")).toHaveAttribute(
				"contenteditable",
				"false",
			);
			const unchanged = await lix.execute(
				"SELECT path, content FROM lix_file WHERE id = $1",
				[fileId],
			);
			expect(unchanged.rows[0]?.path).toBe("/readme.md");
			expect(unchanged.rows[0]?.content).toEqual(content);
		} finally {
			await act(async () => view?.unmount());
			await lix.close();
		}
	});

	test("mounts host file extensions, propagates readOnly changes and disposes on unmount", async () => {
		const lix = await openLix();
		const result = await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ($1, $2) RETURNING id",
			["/file.custom", new Uint8Array([1])],
		);
		const dispose = vi.fn();
		const update = vi.fn();
		const extension: AtelierExtensionRegistration = {
			manifest: {
				apiVersion: 1,
				id: "custom",
				name: "Custom",
				fileExtensions: ["custom"],
				placement: ["central"],
			},
			entry: {
				icon: File,
				mount: ({ atelier, element }) => {
					element.textContent = atelier.readOnly
						? "Read-only custom file"
						: "Editable custom file";
					return { update, dispose };
				},
			},
		};
		const extensions = [extension];
		const fileId = result.rows[0]!.id as string;
		let view: ReturnType<typeof render> | undefined;
		try {
			view = render(
				<Atelier.FileView
					lix={lix}
					fileId={fileId}
					readOnly
					extensions={extensions}
				/>,
			);
			expect(await screen.findByText("Read-only custom file")).toBeVisible();
			view.rerender(
				<Atelier.FileView lix={lix} fileId={fileId} extensions={extensions} />,
			);
			await waitFor(() =>
				expect(update).toHaveBeenCalledWith(
					expect.objectContaining({
						atelier: expect.objectContaining({ readOnly: false }),
					}),
				),
			);
			await act(async () => view?.unmount());
			expect(dispose).toHaveBeenCalledTimes(1);
			expect(await lix.execute("SELECT 1 AS value")).toMatchObject({
				rows: [{ value: 1 }],
			});
		} finally {
			view?.unmount();
			await lix.close();
		}
	});
});
