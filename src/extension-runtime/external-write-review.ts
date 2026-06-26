export type ExternalWriteReview = {
	readonly fileId: string;
	readonly path: string;
	readonly reviewId: string;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly agentTurnRangeIds: readonly string[];
};

export type ExternalWriteReviewData = {
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
};
