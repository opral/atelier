import { LoaderCircle } from "lucide-react";

/** Visible feedback shared by document discovery, loading, and editor hydration. */
export function DocumentLoading({
	label = "Opening document…",
}: {
	readonly label?: string;
}) {
	return (
		<div
			role="status"
			aria-live="polite"
			className="flex min-h-32 flex-1 items-center justify-center gap-2 p-6 text-sm text-fg-subtle"
			data-atelier-document-loading=""
		>
			<LoaderCircle
				aria-hidden="true"
				className="size-4 motion-safe:animate-spin"
			/>
			<span>{label}</span>
		</div>
	);
}
