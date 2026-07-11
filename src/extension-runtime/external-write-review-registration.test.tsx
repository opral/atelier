import { render } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ExternalWriteReview } from "./external-write-review";
import { ExternalWriteReviewRegistration } from "./external-write-review-registration";

const review = (reviewId: string): ExternalWriteReview => ({
	fileId: "file-1",
	path: "/readme.md",
	reviewId,
	beforeCommitId: "before",
	afterCommitId: "after",
	agentTurnRangeIds: [],
});

describe("ExternalWriteReviewRegistration", () => {
	test("moves registration when the current review changes and cleans up", () => {
		const cleanups = [vi.fn(), vi.fn()];
		const register = vi
			.fn()
			.mockReturnValueOnce(cleanups[0])
			.mockReturnValueOnce(cleanups[1]);
		const firstReview = review("review-1");
		const secondReview = review("review-2");
		const view = render(
			<ExternalWriteReviewRegistration
				review={firstReview}
				register={register}
			/>,
		);

		expect(register).toHaveBeenCalledWith(firstReview);
		view.rerender(
			<ExternalWriteReviewRegistration
				review={secondReview}
				register={register}
			/>,
		);

		expect(cleanups[0]).toHaveBeenCalledOnce();
		expect(register).toHaveBeenLastCalledWith(secondReview);
		view.unmount();
		expect(cleanups[1]).toHaveBeenCalledOnce();
	});
});
