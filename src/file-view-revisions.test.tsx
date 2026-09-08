import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { fakeUuid } from "@/test-utils/fake-uuid";
import { createCheckpoint } from "@/lib/lix-diff-commands";
import { selectWorkingFileDiffSnapshot } from "@/queries";
import { render, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { MarkdownView } from "@/extensions/markdown";

test("an added file renders as a diff without disabled formatting chrome", async () => {
	const lix = await openLix();
	const fileId = fakeUuid("added-file-preview");
	let view: ReturnType<typeof render> | undefined;
	try {
		await lix.execute(
			"INSERT INTO lix_file(id,path,content) VALUES ($1,$2,$3)",
			[fileId, "/added.md", new TextEncoder().encode("# Added document")],
		);
		const epoch = await selectWorkingFileDiffSnapshot(lix);
		view = render(
			<LixProvider lix={lix}>
				<MarkdownView
					fileId={fileId}
					filePath="/added.md"
					readOnly
					beforeCommitId={epoch.beforeCommitId}
					afterCommitId={epoch.afterCommitId}
					beforeExists={false}
				/>
			</LixProvider>,
		);
		await view.findByRole("heading", { name: "Added document" });
		expect(view.container.querySelector(".markdown-review")).not.toBeNull();
		expect(
			view.queryByRole("toolbar", { name: "Formatting toolbar" }),
		).toBeNull();
	} finally {
		view?.unmount();
		await lix.close();
	}
});

test.each(["working", "historical"] as const)(
	"%s preview loads workspace images from the captured commit",
	async (kind) => {
		const lix = await openLix();
		const encoder = new TextEncoder();
		const fileId = fakeUuid(`preview-${kind}`);
		const imageId = fakeUuid(`preview-image-${kind}`);
		const blobs: Blob[] = [];
		const createDescriptor = Object.getOwnPropertyDescriptor(
			URL,
			"createObjectURL",
		);
		const revokeDescriptor = Object.getOwnPropertyDescriptor(
			URL,
			"revokeObjectURL",
		);
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: (blob: Blob) => {
				blobs.push(blob);
				return `blob:preview-${blobs.length}`;
			},
		});
		Object.defineProperty(URL, "revokeObjectURL", {
			configurable: true,
			value: () => {},
		});
		let view: ReturnType<typeof render> | undefined;
		try {
			await lix.execute(
				"INSERT INTO lix_file (id,path,content) VALUES ($1,$2,$3)",
				[fileId, "/file.md", encoder.encode("# Before")],
			);
			await createCheckpoint(lix);
			await lix.execute(
				"INSERT INTO lix_file (id,path,content) VALUES ($1,$2,$3)",
				[imageId, "/image.png", encoder.encode("reviewed image")],
			);
			await lix.execute("UPDATE lix_file SET content=$1 WHERE id=$2", [
				encoder.encode("![Image](./image.png)"),
				fileId,
			]);
			const epoch = await selectWorkingFileDiffSnapshot(lix);
			await lix.execute("UPDATE lix_file SET content=$1 WHERE id=$2", [
				encoder.encode("newer image"),
				imageId,
			]);
			view = render(
				<LixProvider lix={lix}>
					<MarkdownView
						fileId={fileId}
						filePath="/file.md"
						readOnly
						beforeCommitId={
							kind === "working" ? epoch.beforeCommitId : undefined
						}
						afterCommitId={epoch.afterCommitId}
					/>
				</LixProvider>,
			);
			await waitFor(() => expect(blobs.length).toBeGreaterThan(0));
			for (const blob of blobs)
				expect(await blob.text()).toBe("reviewed image");
		} finally {
			view?.unmount();
			await lix.close();
			if (createDescriptor)
				Object.defineProperty(URL, "createObjectURL", createDescriptor);
			else Reflect.deleteProperty(URL, "createObjectURL");
			if (revokeDescriptor)
				Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor);
			else Reflect.deleteProperty(URL, "revokeObjectURL");
		}
	},
);
