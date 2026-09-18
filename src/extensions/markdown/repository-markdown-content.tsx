import { useEffect, useState } from "react";
import { useLix } from "../../lib/lix-react";
import {
	loadMarkdownAsset,
	type LoadedMarkdownAsset,
} from "./editor/markdown-asset";
import { parseMarkdown } from "./editor/markdown";
import { astToTiptapDoc } from "./editor/tiptap-markdown-bridge/mdwc-to-tiptap";
import { useAtelierRenderContext } from "../../atelier-render-context";
import { documentLinkPath } from "./editor/document-links";
import { MarkdownContent } from "./markdown-content";

type Props = {
	readonly content: string;
	readonly path: string;
	readonly branchId: string;
	readonly commitId?: string;
	readonly className?: string;
};

export function RepositoryMarkdownContent(props: Props) {
	const { navigation } = useAtelierRenderContext();
	return !navigation?.fileHref ? (
		<ConnectedMarkdownContent {...props} />
	) : (
		<RepositoryMarkdownBody {...props} />
	);
}

/** A standalone AtelierFile has a client, but no host-provided media URLs.
 * Resolve its images with the same loader used by the interactive editor. */
function ConnectedMarkdownContent(props: Props) {
	const lix = useLix();
	const { content, path, branchId, commitId } = props;
	const key = JSON.stringify([content, path, branchId, commitId]);
	const [assets, setAssets] = useState<{
		key: string;
		sources: Record<string, string>;
	}>();
	useEffect(() => {
		let active = true;
		const owned: LoadedMarkdownAsset[] = [];
		const sources = new Set<string>();
		const visit = (node: {
			type: string;
			attrs?: Record<string, unknown>;
			content?: readonly unknown[];
		}) => {
			if (
				(node.type === "image" || node.type === "imageBlock") &&
				typeof node.attrs?.src === "string" &&
				!/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(node.attrs.src)
			)
				sources.add(node.attrs.src);
			for (const child of node.content ?? [])
				visit(child as Parameters<typeof visit>[0]);
		};
		visit(astToTiptapDoc(parseMarkdown(content)));
		void Promise.all(
			[...sources].map(async (src) => {
				try {
					const asset = await loadMarkdownAsset({
						lix,
						sourceFilePath: path,
						sourceCommitId: commitId,
						src,
					});
					if (!asset) return null;
					if (!active) {
						asset.dispose?.();
						return null;
					}
					owned.push(asset);
					return [src, asset.src] as const;
				} catch {
					return null;
				}
			}),
		).then((entries) => {
			if (active)
				setAssets({
					key,
					sources: Object.fromEntries(
						entries.filter((entry) => entry !== null),
					),
				});
		});
		return () => {
			active = false;
			for (const asset of owned) asset.dispose?.();
		};
	}, [lix, content, path, commitId, key]);
	return (
		<RepositoryMarkdownBody
			{...props}
			assetSources={assets?.key === key ? assets.sources : undefined}
		/>
	);
}

function RepositoryMarkdownBody({
	content,
	path,
	branchId,
	commitId,
	className,
	assetSources,
}: Props & { assetSources?: Record<string, string> }) {
	const { navigation } = useAtelierRenderContext();
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
				if (!target || !navigation?.fileHref) return assetSources?.[src];
				const destination = navigation.fileHref({
					path: target,
					branchId,
					...(commitId ? { commitId } : {}),
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
