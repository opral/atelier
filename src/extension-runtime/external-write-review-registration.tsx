import { useEffect } from "react";
import type { ExternalWriteReview } from "./external-write-review";

export type ExternalWriteReviewRegistrar = (
	review: ExternalWriteReview,
) => () => void;

/** Keeps a live file review registered with the extension host. */
export function ExternalWriteReviewRegistration({
	review,
	register,
}: {
	readonly review: ExternalWriteReview | null;
	readonly register?: ExternalWriteReviewRegistrar;
}) {
	useEffect(() => {
		if (!review) return;
		return register?.(review);
	}, [register, review]);
	return null;
}
