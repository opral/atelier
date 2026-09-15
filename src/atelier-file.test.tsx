import { render, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { AtelierFile } from "./atelier-file";
import { openLix } from "./test-utils/node-lix-sdk";
import { createCheckpoint } from "./lib/lix-diff-commands";
import { selectWorkingFileDiffSnapshot } from "./queries";

test("inline file uses the declarative renderer without workspace chrome and stays pinned during edits", async () => {
	const lix = await openLix();
	let view: ReturnType<typeof render> | undefined;
	try {
		await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ('/inline.md', $1)",
			[new TextEncoder().encode("# Before")],
		);
		const result = await lix.execute(
			"SELECT id FROM lix_file WHERE path = '/inline.md'",
		);
		const fileId = result.rows[0]!.id as string;
		const checkpoint = await createCheckpoint(lix);
		await lix.execute("UPDATE lix_file SET content = $1 WHERE id = $2", [
			new TextEncoder().encode("# After"),
			fileId,
		]);
		const epoch = await selectWorkingFileDiffSnapshot(lix);
		view = render(
			<AtelierFile
				lix={lix}
				fileId={fileId}
				filePath="/inline.md"
				readOnly
				diff={{
					workingEpoch: {
						beforeCommitId: checkpoint.commitId,
						afterCommitId: epoch.afterCommitId,
					},
				}}
			/>,
		);
		await waitFor(() =>
			expect(view!.container.querySelector(".markdown-review")).not.toBeNull(),
		);
		expect(
			view.container.querySelector("[data-atelier-part='top-bar']"),
		).toBeNull();
		await lix.execute("UPDATE lix_file SET content = $1 WHERE id = $2", [
			new TextEncoder().encode("# Later"),
			fileId,
		]);
		await waitFor(() => expect(view!.container.textContent).toContain("After"));
		expect(view.container.textContent).not.toContain("Later");
	} finally {
		view?.unmount();
		await lix.close();
	}
});

test("a host URL for a file of this workspace opens in place, not in a browser tab", async () => {
	const lix = await openLix();
	let view: ReturnType<typeof render> | undefined;
	const browserTabs: string[] = [];
	const realOpen = window.open;
	window.open = ((url?: string | URL) => {
		browserTabs.push(String(url));
		return null;
	}) as typeof window.open;
	const opened: string[] = [];
	try {
		await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ('/target.md', $1)",
			[new TextEncoder().encode("# Target")],
		);
		await lix.execute(
			"INSERT INTO lix_file (path, content) VALUES ('/readme.md', $1)",
			[
				new TextEncoder().encode(
					"[Target](https://example.test/@who/what/file/abc/target.md)",
				),
			],
		);
		const result = await lix.execute(
			"SELECT id FROM lix_file WHERE path = '/readme.md'",
		);
		const fileId = result.rows[0]!.id as string;
		view = render(
			<AtelierFile
				lix={lix}
				fileId={fileId}
				filePath="/readme.md"
				readOnly
				documentLinks={{
					resolve: (href) =>
						href.startsWith("https://example.test/")
							? { path: "/target.md" }
							: null,
				}}
				onOpenFile={(path) => {
					opened.push(path);
				}}
			/>,
		);
		// The link wears the file-type icon that marks a file of this repository.
		await waitFor(() =>
			expect(
				view!.container.querySelector(".markdown-document-link-icon"),
			).not.toBeNull(),
		);
		// The editor replaces its DOM as it loads, so read the anchor now.
		const link = view.container.querySelector("a[href]") as HTMLAnchorElement;
		link.dispatchEvent(
			new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
		);
		await waitFor(() => expect(opened).toEqual(["/target.md"]));
		expect(browserTabs).toEqual([]);
	} finally {
		window.open = realOpen;
		view?.unmount();
		await lix.close();
	}
});
