import type { ReactNode } from "react";

/**
 * How a workspace path reads in a list (design 12b): the file name leads, and
 * one parent folder sits before it in a muted tone so files with the same
 * name in different folders stay apart. Deeper paths collapse to "…/parent/".
 * Root files gain nothing, so the common case is unchanged.
 */
export function splitPathLabel(path: string): {
	readonly parent: string | null;
	readonly name: string;
} {
	const segments = path.split("/").filter(Boolean);
	const name = segments[segments.length - 1] ?? path;
	const directories = segments.slice(0, -1);
	if (directories.length === 0) return { parent: null, name };
	const nearest = directories[directories.length - 1]!;
	return {
		parent: directories.length === 1 ? `${nearest}/` : `…/${nearest}/`,
		name,
	};
}

/** The list label as plain text, for sizing and accessible names. */
export function pathLabelText(path: string): string {
	const { parent, name } = splitPathLabel(path);
	return `${parent ?? ""}${name}`;
}

export function PathLabel({
	path,
	parentClassName = "text-[var(--color-text-quaternary)]",
	layout = "inline",
	className = "",
}: {
	readonly path: string;
	/** Colour class for the parent; lists on dark chrome pass their own. */
	readonly parentClassName?: string;
	/**
	 * "row" lays the two parts out so the name wins the space: the parent
	 * truncates first (never past 40%), and the name ellipsizes only after.
	 */
	readonly layout?: "inline" | "row";
	readonly className?: string;
}): ReactNode {
	const { parent, name } = splitPathLabel(path);
	if (layout === "row") {
		return (
			<span className={`flex min-w-0 items-baseline ${className}`}>
				{parent ? (
					<span
						data-attr="path-parent"
						className={`max-w-[40%] flex-none truncate ${parentClassName}`}
					>
						{parent}
					</span>
				) : null}
				<span className="min-w-0 truncate">{name}</span>
			</span>
		);
	}
	return (
		<>
			{parent ? (
				<span data-attr="path-parent" className={parentClassName}>
					{parent}
				</span>
			) : null}
			{name}
		</>
	);
}
