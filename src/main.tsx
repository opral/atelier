import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { LixProvider } from "@lix-js/react-utils";
import { openLix, type Lix } from "@lix-js/sdk";
import { KeyValueProvider } from "./hooks/key-value/use-key-value";
import { KEY_VALUE_DEFINITIONS } from "./hooks/key-value/schema";
import { ErrorFallback } from "./main.error";
import { insertMarkdownSchemas } from "./lib/insert-markdown-schemas";
import { V2LayoutShell } from "./app/layout-shell";
import { ensureAgentsFile, seedMarkdownFiles } from "./seed";
import markdownPluginV2Manifest from "../lix/packages/plugin-md-v2/manifest.json";
import markdownPluginV2WasmRaw from "../lix/target/wasm32-wasip2/release/plugin_md_v2.wasm?raw";

const markdownPluginV2WasmBytes = Uint8Array.from(
	markdownPluginV2WasmRaw,
	(char) => char.charCodeAt(0),
);

// Error UI moved to ./main.error.tsx

export const AppRoot = () => {
	const [lix, setLix] = useState<Lix | null>(null);
	const [error, setError] = useState<unknown>(null);

	useEffect(() => {
		let cancelled = false;
		let current: Lix | undefined;
		(async () => {
			try {
				const instance = await openLix();
				await instance.installPlugin({
					manifestJson: markdownPluginV2Manifest,
					wasmBytes: markdownPluginV2WasmBytes,
				});
				await insertMarkdownSchemas({ lix: instance });
				await ensureAgentsFile(instance);
				await seedMarkdownFiles(instance);
				if (cancelled) {
					await instance.close();
					return;
				}
				current = instance;
				if (!cancelled) setLix(instance);
			} catch (e) {
				if (!cancelled) setError(e);
			}
		})();
		return () => {
			cancelled = true;
			setLix(null);
			void (async () => {
				if (current) await current.close();
			})();
		};
	}, []);

	if (error) return <ErrorFallback error={error} />;
	if (!lix)
		return (
			<div className="min-h-dvh w-full flex items-center justify-center p-6 text-sm text-muted-foreground">
				Loading…
			</div>
		);

	return (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
				<V2LayoutShell />
			</KeyValueProvider>
		</LixProvider>
	);
};

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<AppRoot />
	</StrictMode>,
);

// Register the offline shell in production and force new workers to activate immediately.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker
			.register("/sw.js")
			.then((registration) => {
				registration.addEventListener("updatefound", () => {
					const worker = registration.installing;
					if (!worker) return;
					worker.addEventListener("statechange", () => {
						if (
							worker.state === "installed" &&
							navigator.serviceWorker.controller
						) {
							// Service worker messaging doesn't use targetOrigin; suppress lint warning.
							// eslint-disable-next-line unicorn/require-post-message-target-origin
							worker.postMessage("SKIP_WAITING");
						}
					});
				});
			})
			.catch(() => {
				// Ignore registration errors; app continues without offline shell.
			});
	});
}
