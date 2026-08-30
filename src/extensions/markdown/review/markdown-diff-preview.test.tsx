import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { AtelierFilePreviewProps } from "@/extension-api";
import { MarkdownFilePreview } from "./markdown-diff-preview";

describe("MarkdownFilePreview", () => {
	test("fails closed for the removed base-to-implicit-live contract", () => {
		const legacyProps = {
			lix: {},
			fileId: "file",
			filePath: "/file.md",
			diff: { baseCommitId: "base" },
		} as unknown as AtelierFilePreviewProps;

		render(<MarkdownFilePreview {...legacyProps} />);

		expect(screen.getByRole("alert")).toHaveTextContent(
			/current, certified diff/i,
		);
	});
});

// The public contract must make both sides of every diff explicit.
const workingPreview: AtelierFilePreviewProps = {
	lix: {} as AtelierFilePreviewProps["lix"],
	fileId: "file",
	filePath: "/file.md",
	diff: {
		workingEpoch: { beforeCommitId: "before", afterCommitId: "after" },
	},
};
void workingPreview;

// @ts-expect-error A historical base may not be paired with implicit live state.
const implicitLiveDiff: AtelierFilePreviewProps = {
	lix: {} as AtelierFilePreviewProps["lix"],
	fileId: "file",
	filePath: "/file.md",
	diff: { baseCommitId: "base" },
};
void implicitLiveDiff;
