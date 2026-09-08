export type ExternalWriteReview = {
	readonly fileId: string;
	readonly path: string;
	readonly reviewId: string;
	readonly beforeCommitId: string;
	readonly afterCommitId: string;
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
	/** Null when no changed file is on screen: the bar never names a file it isn't showing. */
	readonly fileName: string | null;
	readonly activeIndex: number | null;
	readonly fileCount: number;
	readonly onPrevious?: () => void;
	readonly onNext?: () => void;
};
