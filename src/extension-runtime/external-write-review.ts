export type ExternalWriteReview = {
	readonly fileId: string;
	readonly path: string;
	readonly reviewId: string;
	readonly beforeData: Uint8Array;
	readonly afterData: Uint8Array;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
	readonly agentTurnRangeId: string;
};
