export type ExternalWriteReview = {
	readonly fileId: string;
	readonly path: string;
	readonly reviewId: string;
	readonly mode?: "agent-turn" | "working-changes";
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly agentTurnRangeIds: readonly string[];
};

export type ExternalWriteReviewData = {
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
};

export type ResolveExternalWriteReviewArgs = {
	readonly fileId: string;
	readonly reviewId: string;
	readonly review?: ExternalWriteReview;
	readonly data: Uint8Array;
};

export type ExternalWriteReviewNavigation = {
	readonly fileName: string;
	readonly activeIndex: number;
	readonly fileCount: number;
	readonly onPrevious?: () => void;
	readonly onNext?: () => void;
};
