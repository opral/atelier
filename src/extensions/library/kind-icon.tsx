import type { LibraryKind } from "./kinds";

export type LibraryNavKind = LibraryKind | "database";

/** Each section's tint; Files wears the folder blue, Other stays neutral. */
const KIND_TINT: Record<LibraryNavKind, string> = {
	files: "text-folder",
	pages: "text-kind-pages",
	tables: "text-kind-tables",
	drawings: "text-kind-drawings",
	media: "text-kind-media",
	database: "text-kind-database",
	other: "text-fg-subtle",
};

/**
 * The glyph for a kind of thing — not a file icon: a page, a table, a
 * stroke, a picture, a database. Drawn as one outline family so the sidebar
 * reads as a list of kinds rather than a list of files.
 */
export function KindIcon({
	kind,
	className = "size-3.5",
}: {
	readonly kind: LibraryNavKind;
	readonly className?: string;
}) {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.9}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			data-kind-icon={kind}
			className={`shrink-0 ${KIND_TINT[kind]} ${className}`}
		>
			{kind === "files" ? (
				<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
			) : kind === "pages" ? (
				<>
					<rect x="5" y="3" width="14" height="18" rx="2.5" />
					<path d="M9 8h6M9 12h6M9 16h3" />
				</>
			) : kind === "tables" ? (
				<>
					<rect x="3" y="4" width="18" height="16" rx="2.5" />
					<path d="M3 10h18M3 15h18M10 4v16" />
				</>
			) : kind === "drawings" ? (
				<>
					<path d="M4 20c3-1 4-4 7-9s5-6 9-7" />
					<path d="M4 20h6" />
				</>
			) : kind === "media" ? (
				<>
					<rect x="3" y="4" width="18" height="16" rx="2.5" />
					<circle cx="9" cy="10" r="1.8" />
					<path d="m21 16-5-5-9 9" />
				</>
			) : kind === "database" ? (
				<>
					<ellipse cx="12" cy="6" rx="8" ry="3" />
					<path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
				</>
			) : (
				<>
					<circle cx="6" cy="12" r="1.4" />
					<circle cx="12" cy="12" r="1.4" />
					<circle cx="18" cy="12" r="1.4" />
				</>
			)}
		</svg>
	);
}
