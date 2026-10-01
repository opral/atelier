import type { LibraryKind } from "./kinds";

export type LibraryNavKind = LibraryKind | "database";

/** Each section's tint; Files wears the folder blue, Other stays neutral. */
const KIND_TINT: Record<LibraryNavKind, string> = {
	home: "atw:text-fg-muted",
	all: "atw:text-fg-muted",
	files: "atw:text-folder",
	pages: "atw:text-kind-pages",
	tables: "atw:text-kind-tables",
	drawings: "atw:text-kind-drawings",
	media: "atw:text-kind-media",
	database: "atw:text-kind-database",
	other: "atw:text-fg-subtle",
};

/**
 * The glyph for a kind of thing — not a file icon: a page, a table, a
 * stroke, a picture, a database. Drawn as one outline family so the sidebar
 * reads as a list of kinds rather than a list of files.
 */
export function KindIcon({
	kind,
	className = "atw:size-3.5",
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
			className={`atw:shrink-0 ${KIND_TINT[kind]} ${className}`}
		>
			{kind === "home" ? (
				<>
					<path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
					<path d="M9.5 20.5v-6h5v6" />
				</>
			) : kind === "all" ? (
				<>
					<rect x="4" y="4" width="7" height="7" rx="1.5" />
					<rect x="13" y="4" width="7" height="7" rx="1.5" />
					<rect x="4" y="13" width="7" height="7" rx="1.5" />
					<rect x="13" y="13" width="7" height="7" rx="1.5" />
				</>
			) : kind === "files" ? (
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
					<path d="M8.3 10a.7.7 0 0 1-.63-1.08L11.4 3a.7.7 0 0 1 1.2-.04L16.3 8.9a.7.7 0 0 1-.57 1.1Z" />
					<rect x="3" y="14" width="7" height="7" rx="1.5" />
					<circle cx="17.5" cy="17.5" r="3.5" />
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
