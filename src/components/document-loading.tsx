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
			className="atw:flex atw:min-h-32 atw:flex-1 atw:items-center atw:justify-center atw:gap-2 atw:p-6 atw:text-sm atw:text-fg-subtle"
			data-atelier-document-loading=""
		>
			<LoaderCircle
				aria-hidden="true"
				className="atw:size-4 atw:motion-safe:animate-spin"
			/>
			<span>{label}</span>
		</div>
	);
}
