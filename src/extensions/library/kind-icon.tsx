import type { LibraryKind } from "./kinds";

/** "file": a file no kind claims, where one is listed (Recent). */
export type LibraryNavKind = LibraryKind | "database" | "file";

/**
 * The glyph for a kind of thing — not a file icon: a document, a table, a
 * pen, a picture, a database. One monochrome outline family in the text's
 * own colour, so the sidebar reads as a calm list of kinds rather than a
 * list of files.
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
			strokeWidth={1.75}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			data-kind-icon={kind}
			className={`atw:shrink-0 ${className}`}
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
					<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
					<path d="M14 3v5h5M9 13h6M9 17h6" />
				</>
			) : kind === "file" ? (
				<>
					<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
					<path d="M14 3v5h5" />
				</>
			) : kind === "tables" ? (
				<>
					<rect x="3.5" y="4.5" width="17" height="15" rx="2" />
					<path d="M3.5 9.5h17M9 9.5v10" />
				</>
			) : kind === "drawings" ? (
				<>
					<path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
					<path d="m13.5 6.5 3 3" />
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
