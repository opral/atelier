import { useEffect, useRef, useState } from "react";
import { useAtelierRenderContext } from "../atelier-render-context";
import {
	renderPdfPreview,
	type PdfPreviewController,
} from "../extensions/pdf/pdf-preview";

/** Native document before hydration; URL-backed PDF.js afterward, without Lix I/O. */
export function PreparedPdf({
	src,
	label,
	enhance = true,
}: {
	src: string;
	label: string;
	enhance?: boolean;
}) {
	const { hydrated } = useAtelierRenderContext();
	const container = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<"native" | "loading" | "ready" | "error">(
		"native",
	);
	useEffect(() => {
		if (!enhance || !hydrated || !container.current) return;
		const abort = new AbortController();
		let renderer: PdfPreviewController | undefined;
		setState("loading");
		void renderPdfPreview({
			src,
			container: container.current,
			layout: "fit-page",
			signal: abort.signal,
			onError: () => {
				if (!abort.signal.aborted) setState("error");
			},
		})
			.then((result) => {
				if (abort.signal.aborted) result.destroy();
				else {
					renderer = result;
					setState("ready");
				}
			})
			.catch(() => {
				if (!abort.signal.aborted) setState("error");
			});
		return () => {
			abort.abort();
			renderer?.destroy();
		};
	}, [src, hydrated, enhance]);
	return (
		<div
			className="relative flex min-h-96 min-w-0 flex-1 flex-col"
			data-atelier-url-pdf=""
			data-pdf-state={state}
		>
			{state === "native" ? (
				<object
					className="h-full min-h-96 w-full"
					type="application/pdf"
					data={src}
					aria-label={label}
				>
					<p>PDF preview</p>
				</object>
			) : null}
			<div
				ref={container}
				className="atelier-pdf-document relative min-h-96 flex-1"
				style={{
					display: state === "native" || state === "error" ? "none" : undefined,
				}}
			/>
			{state === "loading" ? <p role="status">Loading PDF…</p> : null}
			{state === "error" ? (
				<p role="alert">Unable to preview this PDF.</p>
			) : null}
			<a href={src} download={label.split("/").at(-1)}>
				Download {label}
			</a>
		</div>
	);
}
