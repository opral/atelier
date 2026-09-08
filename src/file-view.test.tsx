import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { File } from "lucide-react";
import { Atelier } from "./atelier";
import { loadAtelier } from "./load-atelier";
import { openLix } from "./test-utils/node-lix-sdk";
import type { AtelierExtensionRegistration } from "./extension-api";

describe("Atelier file locations", () => {
	test("server and browser render formatted read-only Markdown without changing the file", async () => {
		const lix = await openLix();
		const content = new TextEncoder().encode(
			"# Published heading\n\nA **formatted** paragraph.",
		);
		await lix.execute("INSERT INTO lix_file (path, content) VALUES ($1, $2)", [
			"/readme.md",
			content,
		]);
		let view: ReturnType<typeof render> | undefined;
		try {
			const initialState = await loadAtelier({
				lix,
				location: { path: "/readme.md" },
				readOnly: true,
			});
			const html = renderToStaticMarkup(
				<Atelier initialState={initialState} />,
			);
			expect(html).toContain("Published heading");
			expect(html).toContain("<strong>formatted</strong>");
			view = render(<Atelier lix={lix} initialState={initialState} readOnly />);
			expect(
				await screen.findByRole("heading", { name: "Published heading" }),
			).toBeVisible();
			await waitFor(() =>
				expect(view?.container.querySelector(".ProseMirror")).toHaveAttribute(
					"contenteditable",
					"false",
				),
			);
			const unchanged = await lix.execute(
				"SELECT content FROM lix_file WHERE path = $1",
				["/readme.md"],
			);
			expect(unchanged.rows[0]?.content).toEqual(content);
		} finally {
			await act(async () => view?.unmount());
			await lix.close();
		}
	});
	test("renders host file extensions and updates access mode without losing the borrowed connection", async () => {
		const lix = await openLix();
		await lix.execute("INSERT INTO lix_file (path, content) VALUES ($1, $2)", [
			"/file.custom",
			new Uint8Array([1]),
		]);
		const dispose = vi.fn();
		const extension: AtelierExtensionRegistration = {
			id: "custom",
			name: "Custom",
			fileExtensions: ["custom"],
			placement: ["central"],
			icon: File,
			Component: function Custom({ atelier }) {
				useEffect(() => () => dispose(), []);
				return (
					<p>
						{atelier.readOnly
							? "Read-only custom file"
							: "Editable custom file"}
					</p>
				);
			},
		};
		const extensions = [extension];
		let view: ReturnType<typeof render> | undefined;
		try {
			view = render(
				<Atelier
					lix={lix}
					location={{ path: "/file.custom" }}
					readOnly
					extensions={extensions}
				/>,
			);
			expect(await screen.findByText("Read-only custom file")).toBeVisible();
			view.rerender(
				<Atelier
					lix={lix}
					location={{ path: "/file.custom" }}
					readOnly={false}
					extensions={extensions}
				/>,
			);
			expect(await screen.findByText("Editable custom file")).toBeVisible();
			expect(dispose).not.toHaveBeenCalled();
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
