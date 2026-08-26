import type { ReactNode } from "react";
import type { AtelierFilePreviewProps } from "./extension-api";
import { BUILTIN_EXTENSION_DEFINITIONS } from "./extension-runtime/builtin-extension-registry";
import { LixProvider } from "./lib/lix-react";

/**
 * Quick Look for workspace files: renders a file — live, at a commit, or as
 * a change — through the extension that owns its file type, resolved by the
 * same registry that routes opening files. Previews are chromeless by
 * contract (see [`AtelierFilePreviewProps`]); the host owns the frame.
 *
 * @example
 * <AtelierFilePreview lix={lix} fileId={id} filePath="/README.md" />
 * <AtelierFilePreview lix={lix} fileId={id} filePath="/README.md"
 *   diff={{ baseCommitId }} />
 */
export function AtelierFilePreview({
	fallback = null,
	...props
}: AtelierFilePreviewProps & {
	/** Rendered when no extension previews this file type. */
	readonly fallback?: ReactNode;
}) {
	const extension = fileExtensionOf(props.filePath);
	const definition = extension
		? BUILTIN_EXTENSION_DEFINITIONS.find((candidate) =>
				candidate.fileExtensions?.includes(extension),
			)
		: undefined;
	const Preview = definition?.filePreview;
	if (!Preview) return <>{fallback}</>;
	return (
		<LixProvider lix={props.lix}>
			<Preview {...props} />
		</LixProvider>
	);
}

function fileExtensionOf(path: string): string | null {
	const name = path.split("/").filter(Boolean).at(-1) ?? "";
	const dotIndex = name.lastIndexOf(".");
	if (dotIndex <= 0 || dotIndex === name.length - 1) return null;
	return name.slice(dotIndex + 1).toLowerCase();
}
