import { fileIconUrl as resolveFileIconUrl } from "./extensions/files/file-icons";

/**
 * Resolve the canonical Atelier icon for a workspace file path.
 *
 * Unknown extensions use Atelier's generic file icon.
 */
export function fileIconUrl(path: string): string {
	return resolveFileIconUrl(path);
}
