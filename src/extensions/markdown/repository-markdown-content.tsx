import { useAtelierRenderContext } from "../../atelier-render-context";
import { documentLinkPath } from "./editor/document-links";
import { MarkdownContent } from "./markdown-content";

export function RepositoryMarkdownContent({
	content,
	path,
	branchId,
	commitId,
	className,
}: {
	readonly content: string;
	readonly path: string;
	readonly branchId: string;
	readonly commitId?: string;
	readonly className?: string;
}) {
	const { navigation, initialState } = useAtelierRenderContext();
	// A prepared document may remain visible while another tab or revision
	// loads. Only borrow the snapshot epoch if it contains this exact document.
	const preparedCommitId =
		initialState?.branchId === branchId &&
		Object.values(initialState.views).some(({ data }) => {
			if (!data || typeof data !== "object" || Array.isArray(data))
				return false;
			const file = data as Record<string, unknown>;
			return file.path === path && file.content === content;
		})
			? (initialState.commitId ?? undefined)
			: undefined;
	return (
		<MarkdownContent
			content={content}
			className={className}
			href={(href) => {
				const target = documentLinkPath(href, path);
				if (!target || !navigation) return href;
				return withSourceSuffix(
					navigation.href({ path: target, branchId }),
					href,
				);
			}}
			src={(src) => {
				if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) return src;
				const target = documentLinkPath(src, path);
				if (!target || !navigation?.fileHref) return undefined;
				const destination = navigation.fileHref({
					path: target,
					branchId,
					...((commitId ?? preparedCommitId)
						? { commitId: commitId ?? preparedCommitId }
						: {}),
				});
				return destination ? withSourceSuffix(destination, src) : undefined;
			}}
		/>
	);
}

function withSourceSuffix(destination: string, source: string): string {
	const suffix = source.match(/[?#].*$/)?.[0];
	if (!suffix) return destination;
	const sourceUrl = new URL(suffix, "https://atelier.invalid/");
	const targetUrl = new URL(destination, "https://atelier.invalid/");
	for (const [key, value] of sourceUrl.searchParams) {
		// Preserve the host's branch/revision and any other routing parameters.
		if (!targetUrl.searchParams.has(key))
			targetUrl.searchParams.append(key, value);
	}
	if (sourceUrl.hash) targetUrl.hash = sourceUrl.hash;
	return `${destination.split(/[?#]/, 1)[0]}${targetUrl.search}${targetUrl.hash}`;
}
